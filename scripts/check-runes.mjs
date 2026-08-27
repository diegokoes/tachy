/**
 * Runes only exist inside files the Svelte compiler processes: `.svelte`,
 * `.svelte.ts`, `.svelte.js`. In a plain `.ts` file `$state` compiles to a
 * reference to a global that is not there, so the module throws on load and
 * the whole app mounts nothing — a blank page, with a clean typecheck, a clean
 * svelte-check and a successful build. This catches that.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const RUNES =
  /(?<![\w$.])\$(state|derived|effect|props|bindable|inspect|host)\b/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith("."))
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.[cm]?[jt]s$/.test(name) && !/\.svelte\.[cm]?[jt]s$/.test(name))
      out.push(path);
  }
  return out;
}

const bad = [];
for (const path of walk(join(ROOT, "packages"))) {
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (RUNES.test(line))
      bad.push(`${relative(ROOT, path)}:${i + 1}  ${line.trim()}`);
  });
}

if (bad.length) {
  console.error(
    "Runes used in files the Svelte compiler does not process.\n" +
      "Rename each file to *.svelte.ts, or the rune becomes an undefined\n" +
      "global at runtime and the module throws on import.\n",
  );
  for (const b of bad) console.error("  " + b);
  process.exit(1);
}
console.log("check-runes: clean");
