import DOMPurify from "dompurify";

const ADO_ATTACHMENT =
  /\/_apis\/wit\/attachments\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/i;

/**
 * An HTML field of an item, made safe to show. A picture pasted into it is an
 * attachment that needs the reader's token, so it is served through tachy;
 * any other picture is dropped rather than loaded from elsewhere.
 */
export function itemHtml(
  html: string,
  source: { slug: string; itemId: string },
): string {
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true });
  for (const image of fragment.querySelectorAll("img")) {
    const attachment = ADO_ATTACHMENT.exec(image.getAttribute("src") ?? "");
    if (!attachment) {
      image.replaceWith(image.getAttribute("alt") ?? "");
      continue;
    }
    image.setAttribute(
      "src",
      `/api/work-items/${encodeURIComponent(source.slug)}/${encodeURIComponent(source.itemId)}/attachments/${attachment[1].toLowerCase()}`,
    );
  }
  for (const anchor of fragment.querySelectorAll("a")) {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  }
  const holder = document.createElement("div");
  holder.append(fragment);
  return holder.innerHTML;
}
