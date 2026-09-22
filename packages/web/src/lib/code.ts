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
 * written in. highlight.js' core alone, one language at a time: the full build
 * is nearly two hundred grammars, every one of them in the SPA's bundle.
 *
 * Nothing is auto-detected. A guess on a three-line block is wrong often
 * enough to be noise, and an unfenced language simply stays plain.
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
    const out = hljs.highlight(code, { language: lang, ignoreIllegals: true });
    return { html: out.value, language: out.language ?? lang };
  } catch {
    return { html: esc(code), language: null };
  }
}
