import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import java from "highlight.js/lib/languages/java";
import json from "highlight.js/lib/languages/json";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Colour for fenced code, from the few grammars this product's articles are
 * written in. highlight.js' core alone, one language at a time, so the full
 * build's grammars stay out of the SPA's bundle. Nothing is auto-detected: a
 * guess on a three-line block is wrong often enough to be noise, and an
 * unfenced block stays plain.
 */
const LANGUAGES = { bash, java, json, sql, typescript, xml, yaml };
for (const [name, def] of Object.entries(LANGUAGES))
  hljs.registerLanguage(name, def);

hljs.registerAliases(["ts", "tsx", "js", "jsx", "javascript"], {
  languageName: "typescript",
});
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["sh", "shell", "console", "zsh"], {
  languageName: "bash",
});
hljs.registerAliases(["html", "svelte", "vue", "svg"], { languageName: "xml" });
hljs.registerAliases(["postgres", "postgresql", "psql"], {
  languageName: "sql",
});

const esc = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const LANGUAGE_NAMES = Object.keys(LANGUAGES);

/** Markup for one code block, and the grammar it was read with, if any. */
export function highlight(
  code: string,
  lang: string,
): { html: string; language: string | null } {
  if (!lang || !hljs.getLanguage(lang))
    return { html: esc(code), language: null };
  try {
    const highlighted = hljs.highlight(code, {
      language: lang,
      ignoreIllegals: true,
    });
    return { html: highlighted.value, language: highlighted.language ?? lang };
  } catch {
    return { html: esc(code), language: null };
  }
}

/** The grammar a file is read with, from its extension; "" when none fits. */
export function languageOf(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return hljs.getLanguage(extension) ? extension : "";
}

const SPAN_TAG_RE = /<span[^>]*>|<\/span>/g;

/**
 * One markup string per line of code. A token that runs over a line break, a
 * block comment say, is closed at the end of each line and reopened on the
 * next, so every line stands on its own in its own element.
 */
export function highlightLines(code: string, lang: string): string[] {
  const open: string[] = [];
  return highlight(code, lang)
    .html.split("\n")
    .map((line) => {
      const carried = open.join("");
      for (const tag of line.match(SPAN_TAG_RE) ?? []) {
        if (tag === "</span>") open.pop();
        else open.push(tag);
      }
      return carried + line + "</span>".repeat(open.length);
    });
}
