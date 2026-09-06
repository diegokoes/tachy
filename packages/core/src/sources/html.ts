/**
 * A fetched HTML body as text the model can read. Block-closing tags become
 * newlines rather than spaces — a ticket body run into one paragraph reads as
 * one thought, and the turn structure is most of what makes a thread legible.
 *
 * Not a sanitiser. This is for text going *to* a model, never for anything
 * rendered back to a browser; the SPA uses DOMPurify for that.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
