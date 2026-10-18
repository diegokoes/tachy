import DOMPurify from "dompurify";
import { toHtml } from "./ticketMarkdown";

const ADO_ATTACHMENT =
  /\/_apis\/wit\/attachments\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/i;

const PAINT = ["color", "background", "background-color", "background-image"];

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
  // Colours set for a white page: on the dark theme they light up the card.
  for (const element of fragment.querySelectorAll<HTMLElement>(
    "[style], [bgcolor], [color]",
  )) {
    for (const property of PAINT) element.style.removeProperty(property);
    element.removeAttribute("bgcolor");
    element.removeAttribute("color");
    if (!element.getAttribute("style")?.trim())
      element.removeAttribute("style");
  }
  // A mention links to "#"; the name is all it carries here.
  for (const mention of fragment.querySelectorAll("a[data-vss-mention]")) {
    const name = document.createElement("span");
    name.className = "mention";
    name.textContent = mention.textContent;
    mention.replaceWith(name);
  }
  for (const anchor of fragment.querySelectorAll("a")) {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  }
  const holder = document.createElement("div");
  holder.append(fragment);
  return holder.innerHTML;
}

const HTML_TAG = /<\/?[a-z][^>]*>/i;

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
};
const ENTITY = /&(?:quot|#39|lt|gt|amp);/g;

/**
 * A large text field as HTML. One saved as Markdown holds Markdown text, which
 * has no tags (https://devblogs.microsoft.com/devops/markdown-support-arrives-for-work-items/),
 * and arrives with its quotes and ampersands as entities, which hide a link's
 * title from the parser.
 */
export const fieldHtml = (value: string): string =>
  HTML_TAG.test(value)
    ? value
    : toHtml(value.replace(ENTITY, (entity) => ENTITIES[entity]));
