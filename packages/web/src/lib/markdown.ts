// Assistant replies are markdown; ticket text can flow through them verbatim,
// so the output is sanitized before hitting {@html}.
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(src: string): string {
  // No <img>: a reply quoting hostile ticket text must not load remote pixels.
  return DOMPurify.sanitize(marked.parse(src, { async: false }), { FORBID_TAGS: ["img"] });
}
