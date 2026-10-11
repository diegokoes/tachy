import { readUpload } from "@tachy/core/chat";
import { extractFile, type ExtractedFile } from "@tachy/core/files";

/**
 * A reference reaches here from a chat upload or from text a model lifted out of
 * a ticket, so it is attacker-influenced. Only chat uploads resolve, never a
 * path on the host, and inside a turn only the turn's own user's. The stored
 * content type is what the upload route found in the bytes, so it is trusted.
 */
export async function extractSource(
  ref: string,
  opts: { member?: string } = {},
): Promise<ExtractedFile> {
  const upload = await readUpload(
    ref,
    process.env.TACHY_UPLOAD_OWNER || undefined,
  );
  return extractFile(upload, opts);
}
