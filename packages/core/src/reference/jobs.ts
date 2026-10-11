import { z } from "zod";
import { ANONYMOUS_UPLOADS, readUpload } from "../chat/uploads";
import { badInput } from "../infra/errors";
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

export function defineReferenceJobs() {
  defineJob({
    kind: EXTRACT_KIND,
    title: "Complete a doc saved from a PDF",
    description:
      "Places the PDF's figures in the reference doc that was saved from its text, and reads its scanned pages with the model, on the credential of whoever saved it. Queued by that save.",
    params: paramsSchema,
    // Each page's pictures are decoded whole, which a light worker has no
    // room for beside its other runs.
    queue: "embed",
    dedupeKey: (params) => params.doc_id,
    subject: (params) => params.path.slice(params.path.lastIndexOf("/") + 1),
    outcome,
    timeout: "1h",
    run: async (ctx, params) => {
      const upload = await readUpload(
        params.path,
        params.user_id ?? ANONYMOUS_UPLOADS,
      ).catch(() => {
        throw badInput(
          "the PDF this doc was saved from is no longer held: an upload is kept for a day. Attach it again and save the doc as a new version",
        );
      });
      return {
        ...(await completeDocFromPdf({
          docId: params.doc_id,
          pdf: upload.bytes,
          userId: params.user_id,
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
