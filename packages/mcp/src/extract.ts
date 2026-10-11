import { readUpload } from "@tachy/core/chat";
import {
  archiveMember,
  extractFile,
  type ExtractedFile,
  type StoredFile,
} from "@tachy/core/files";

/**
 * The file a reference names, or with `member` one file of that archive. A
 * reference may be text a model lifted out of a ticket, so only chat uploads
 * resolve, never a path on the host, and in a turn only its own user's. The
 * stored content type is what the upload route found in the bytes.
 */
export async function openSource(
  ref: string,
  opts: { member?: string } = {},
): Promise<StoredFile> {
  const upload = await readUpload(
    ref,
    process.env.TACHY_UPLOAD_OWNER || undefined,
  );
  return opts.member ? archiveMember(upload, opts.member) : upload;
}

export async function extractSource(
  ref: string,
  opts: { member?: string } = {},
): Promise<ExtractedFile> {
  return extractFile(await openSource(ref, opts));
}
