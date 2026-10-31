import { z } from "zod";
import { parseAttachmentRef } from "@tachy/contract";
import { userSoleTeamId } from "../access/users";
import { ANONYMOUS_UPLOADS, readUpload } from "../chat/uploads";
import { redactionPolicy, type RedactionPolicy } from "../compliance/redaction";
import { effectiveSettings } from "../config/settings";
import { badInput } from "../infra/errors";
import { resolveSource } from "../sources/registry";
import { readAttachment } from "../work-items/attachments";
import { count } from "../jobs/present";
import { defineJob, hasJobKind } from "../jobs/registry";
import { enqueueRun } from "../jobs/runs";
import { completeDocFromPdf } from "./pdf-completion";

const EXTRACT_KIND = "reference.extract";

const paramsSchema = z.object({
  doc_id: z.uuid(),
  /** The upload the doc was saved from; it has to outlive the run's wait. */
  path: z.string(),
  /** Who saved it: whose upload it is and whose model credential reads scans. */
  user_id: z.uuid().nullable(),
});

function outcome(output: Record<string, unknown>): string {
  const parts = [
    count(Number(output.figures ?? 0), "figure"),
    `${count(Number(output.transcribed ?? 0), "scanned page")} read`,
  ];
  if (Number(output.scans_left ?? 0))
    parts.push(
      `${count(Number(output.scans_left), "scanned page")} left: ${String(output.scans_note ?? "not read")}`,
    );
  return parts.join(", ");
}

const GONE =
  "the PDF this doc was saved from can no longer be read: an upload is kept for a day, and a ticket's file for as long as the ticket lists it. Attach it again and save the doc as a new version";

/**
 * The PDF a doc was saved from, read again as whoever saved it: their upload,
 * or a ticket's file through their own source token. With it, the redaction
 * that applies to it: the connection's for a ticket's file, else the global
 * one, both read from the settings since a worker's environment is not kept
 * in step with them.
 */
async function savedPdf(
  path: string,
  userId: string | null,
): Promise<{ bytes: Uint8Array; policy: RedactionPolicy }> {
  const settings = await effectiveSettings();
  const globalOn = settings.redaction_global.value;
  const attachment = parseAttachmentRef(path);
  if (!attachment) {
    const upload = await readUpload(path, userId ?? ANONYMOUS_UPLOADS);
    return {
      bytes: upload.bytes,
      policy: {
        enabled: globalOn,
        images: !globalOn || settings.redaction_images.value,
      },
    };
  }
  const scope = userId
    ? { userId, teamId: (await userSoleTeamId(userId)) ?? undefined }
    : {};
  const { conn, source } = await resolveSource(attachment.source, scope);
  const file = await readAttachment(
    source,
    attachment.externalId,
    attachment.attachmentId,
  );
  return { bytes: file.bytes, policy: redactionPolicy(conn.config, globalOn) };
}

export function defineReferenceJobs() {
  defineJob({
    kind: EXTRACT_KIND,
    title: "complete a doc saved from a PDF",
    description:
      "places the PDF's figures in the reference doc that was saved from its text, and reads its scanned pages with the model, on the credential of whoever saved it. queued by that save",
    params: paramsSchema,
    // Each page's pictures are decoded whole, which a light worker has no
    // room for beside its other runs.
    queue: "embed",
    dedupeKey: (params) => params.doc_id,
    subject: (params) => params.path.slice(params.path.lastIndexOf("/") + 1),
    outcome,
    timeout: "1h",
    run: async (ctx, params) => {
      const saved = await savedPdf(params.path, params.user_id).catch(() => {
        throw badInput(GONE);
      });
      return {
        ...(await completeDocFromPdf({
          docId: params.doc_id,
          pdf: saved.bytes,
          userId: params.user_id,
          policy: saved.policy,
          signal: ctx.signal,
        })),
      };
    },
  });
}

/**
 * Queues the completion of a doc just saved from a PDF. Callable from a
 * process that registered no job kinds, such as a turn's MCP child; returns
 * null when a run for that doc is already queued or going.
 */
export async function queueDocExtraction(input: {
  docId: string;
  path: string;
  userId: string | null;
}): Promise<string | null> {
  if (!hasJobKind(EXTRACT_KIND)) defineReferenceJobs();
  return enqueueRun({
    kind: EXTRACT_KIND,
    params: { doc_id: input.docId, path: input.path, user_id: input.userId },
    trigger: "event",
    requestedBy: input.userId,
  });
}
