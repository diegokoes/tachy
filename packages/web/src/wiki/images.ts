import { onUnauthorized } from "../access/session.svelte";

/**
 * Store an image for this wiki's articles. Multipart, so it cannot go through
 * `api`, which speaks JSON; the server sniffs the bytes and answers with the
 * address the markdown should point at.
 */
export async function uploadImage(
  scope: string,
  file: File,
): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`/api/library/wiki/${scope}/assets`, {
    method: "POST",
    body: form,
  });
  if (response.status === 401) onUnauthorized();
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body?.error ?? `upload failed (${response.status})`);
  return body;
}
