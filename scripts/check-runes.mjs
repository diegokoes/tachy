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

/*
 * The same failure shape from the other side, and it only bites primitives.
 * `export const s = $state({…})` is fine: the object is a proxy, so every
 * importer shares it and mutations are reactive — which is why `session`,
 * `chat`, `themeState`, `keymap` and `router` are all objects. But
 * `export const n = $state(0)` exports the value at that instant, so no
 * importer ever sees it change, and it compiles and typechecks cleanly.
 *
 * A module-level `$effect` is the other one: it throws `effect_orphan` on
 * import, which is the same blank page the check above exists for.
 */
const REACTIVE_MODULES = [];
function walkSvelteTs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith("."))
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkSvelteTs(path, out);
    else if (/\.svelte\.[cm]?[jt]s$/.test(name)) out.push(path);
  }
  return out;
}

// A literal, or nothing at all — the cases where the export is a value rather
// than a shared proxy. An object, array, call or identifier is left alone.
const EXPORTED_PRIMITIVE =
  /^\s*export\s+(?:const|let)\s+[\w$]+\s*(?::[^=]+)?=\s*\$(?:state|derived)(?:\.raw)?(?:<[^>]*>)?\(\s*(\)|-?\d|["'`]|true\b|false\b|null\b|undefined\b)/;
const ORPHAN_EFFECT = /^\$effect[.(]/;

for (const path of walkSvelteTs(join(ROOT, "packages"))) {
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (EXPORTED_PRIMITIVE.test(line))
        REACTIVE_MODULES.push(
          `${relative(ROOT, path)}:${i + 1}  ${line.trim()}\n` +
            "      exports the value, not the signal — wrap it in an object or a getter",
        );
      if (ORPHAN_EFFECT.test(line))
        REACTIVE_MODULES.push(
          `${relative(ROOT, path)}:${i + 1}  ${line.trim()}\n` +
            "      $effect at module scope throws effect_orphan on import",
        );
    });
}

if (REACTIVE_MODULES.length) {
  console.error(
    "Reactive state that will not be reactive where it is used.\n" +
      "Both of these build cleanly and fail at runtime.\n",
  );
  for (const b of REACTIVE_MODULES) console.error("  " + b);
  process.exit(1);
}

console.log("check-runes: clean");
