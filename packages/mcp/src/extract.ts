import { parseAttachmentRef } from "@tachy/core";
import { readUpload } from "@tachy/core/chat";
import {
  globalImagesAllowed,
  globalRedactionEnabled,
  resolveRedactionPolicy,
} from "@tachy/core/compliance";
import {
  archiveMember,
  extractFile,
  type ExtractedFile,
  type StoredFile,
} from "@tachy/core/files";
import { resolveSource } from "@tachy/core/sources";
import { readAttachment } from "@tachy/core/work-items";

export interface OpenedSource {
  file: StoredFile;
  /** Whether its text is scrubbed on the way to the model. */
  redact: boolean;
  /** Whether, being an image, it may be shown to the model. */
  imagesAllowed: boolean;
}

/**
 * A chat upload: inside a turn only the turn's own user's, and the stored
 * content type is what the upload route found in the bytes.
 */
async function openUpload(ref: string): Promise<OpenedSource> {
  return {
    file: await readUpload(ref, process.env.TACHY_UPLOAD_OWNER || undefined),
    redact: globalRedactionEnabled(),
    imagesAllowed: globalImagesAllowed(),
  };
}

/**
 * The file a reference names, or with `member` one file of that archive. A
 * reference may be text a model lifted out of a ticket, so only two kinds
 * resolve, never a path on the host: a chat upload, and a file the named
 * ticket itself lists, read from its source with the caller's own token and
 * under that connection's redaction.
 */
export async function openSource(
  ref: string,
  opts: { member?: string } = {},
): Promise<OpenedSource> {
  const attachment = parseAttachmentRef(ref);
  const opened = attachment
    ? await openAttachmentRef(attachment)
    : await openUpload(ref);
  return opts.member
    ? { ...opened, file: archiveMember(opened.file, opts.member) }
    : opened;
}

async function openAttachmentRef(
  ref: NonNullable<ReturnType<typeof parseAttachmentRef>>,
): Promise<OpenedSource> {
  const { conn, source } = await resolveSource(ref.source);
  const policy = resolveRedactionPolicy(conn.config);
  return {
    file: await readAttachment(source, ref.externalId, ref.attachmentId),
    redact: policy.enabled,
    imagesAllowed: policy.images,
  };
}

export async function extractSource(
  ref: string,
  opts: { member?: string } = {},
): Promise<ExtractedFile & { redact: boolean }> {
  const { file, redact } = await openSource(ref, opts);
  return { ...(await extractFile(file)), redact };
}
