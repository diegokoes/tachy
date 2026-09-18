import { readdir, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { uploadDir } from "./env";

export const uploadTtlMs = () =>
  (Number(process.env.TACHY_UPLOAD_TTL_HOURS) || 24) * 60 * 60_000;

/**
 * Deletes uploads older than the TTL, then any owner directory left empty.
 * Uploads are only ever read within the turn that attached them, so a day is
 * generous; nothing else ever removed them.
 */
export async function sweepUploads(
  ttlMs = uploadTtlMs(),
  now = Date.now(),
): Promise<number> {
  const root = uploadDir();
  let removed = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isDirectory() && depth === 0) {
        await walk(path, 1);
        await rmdir(path).catch(() => {});
      } else if (e.isFile() || e.isSymbolicLink()) {
        const { mtimeMs } = await stat(path).catch(() => ({ mtimeMs: now }));
        if (now - mtimeMs > ttlMs) {
          await rm(path, { force: true });
          removed++;
        }
      }
    }
  };
  await walk(root, 0);
  return removed;
}
