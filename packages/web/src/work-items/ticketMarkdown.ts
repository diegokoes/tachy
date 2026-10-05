import { Marked } from "marked";
import DOMPurify from "dompurify";

/**
 * Its own instance: the app's renderer turns [[wikilinks]] and callouts into
 * markup that means nothing inside an Azure DevOps field.
 */
const md = new Marked({ gfm: true, breaks: true });

/** DOMPurify's default URI rule, plus the scheme pasted images wait under. */
const URI =
  /^(?:(?:https?|mailto|attachment):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

export const ATTACHMENT_RE = /attachment:([A-Za-z0-9_-]+)/g;

/** What an ADO HTML field is sent. Pasted images keep `attachment:<key>`. */
export function toHtml(src: string): string {
  if (!src.trim()) return "";
  return DOMPurify.sanitize(md.parse(src, { async: false }) as string, {
    ALLOWED_URI_REGEXP: URI,
  });
}

/** The same HTML with pasted images pointed at their local blobs. */
export function toPreview(src: string, urls: Map<string, string>): string {
  return toHtml(src).replace(
    ATTACHMENT_RE,
    (m, key: string) => urls.get(key) ?? m,
  );
}

export const imageMarkdown = (name: string, key: string) =>
  `![${name.replace(/[[\]]/g, "")}](attachment:${key})`;
