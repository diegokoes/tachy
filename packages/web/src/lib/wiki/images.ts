import { onUnauthorized } from "../session.svelte";

/**
 * Store an image for this wiki's articles. Multipart, so it cannot go through
 * `api`, which speaks JSON; the server sniffs the bytes and answers with the
 * address the markdown should point at.
 */
export async function uploadImage(
  scope: string,
  file: File,
): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/library/wiki/${scope}/assets`, {
    method: "POST",
    body: fd,
  });
  if (res.status === 401) onUnauthorized();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `upload failed (${res.status})`);
  return body;
}
