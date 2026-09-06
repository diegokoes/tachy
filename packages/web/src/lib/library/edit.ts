import { ApiError, api } from "../api";
import { errText } from "../resource.svelte";

/**
 * An edit to a library item, and what came back. Both detail views send the
 * version they were rendered from, so a 409 means somebody else saved in
 * between — the one outcome the caller has to offer a reload for rather than
 * just report. Shared because it was written twice, and the two had already
 * drifted to different wordings for the same situation.
 */
export type PatchOutcome =
  { ok: true } | { ok: false; conflict: boolean; message: string };

export async function patchLibraryItem(
  path: string,
  body: Record<string, unknown>,
  expectedVersion: number,
  noun: string,
): Promise<PatchOutcome> {
  try {
    await api.patch(path, { ...body, expectedVersion });
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409)
      return {
        ok: false,
        conflict: true,
        message: `someone else edited this ${noun} in the meantime — reload to get the latest version`,
      };
    return { ok: false, conflict: false, message: errText(e) };
  }
}
