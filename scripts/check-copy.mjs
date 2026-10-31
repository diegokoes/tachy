/**
 * Holds the copy rules for the SPA's own strings: every word it shows is
 * lowercase, brand names and acronyms aside, and an empty field shows nothing
 * but the value it stands for ("any", "none"). Reads what a person sees:
 * markup text, the props that carry visible words, and the object keys and
 * calls that feed them. Data and interpolated values are not read.
 *
 *   npm run copy:check [path ...]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "svelte/compiler";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname;
const SCOPE = "packages/web/src";
const CHECKED_FILE_RE = /\.(?:svelte|ts)$/;
/** Room for the listing of a checkout that holds a large untracked tree. */
const LISTING_MAX_BYTES = 64 * 1024 * 1024;

/** Words that keep their capital wherever they stand. */
const PROPER_NOUNS = new Set([
  "Anthropic",
  "Azure",
  "Claude",
  "DejaVu",
  "DevOps",
  "Docker",
  "Document360",
  "Excel",
  "Firefox",
  "Freshdesk",
  "GitHub",
  "Haiku",
  "Inter",
  "Literata",
  "Lucide",
  "Mono",
  "Opus",
  "Plex",
  "Postgres",
  "Sans",
  "Serif",
  "Sonnet",
  "Teams",
  "Vim",
]);

/** Files whose text keys hold names, such as the font catalogue's, not copy. */
const NAME_FILES = new Set(["packages/web/src/theme/fonts.svelte.ts"]);
/** Files whose every string is shown, such as the field help. */
const COPY_FILES = new Set(["packages/web/src/admin/help.ts"]);

/** Markup props and script keys whose value is shown as words. */
const TEXT_KEYS = new Set([
  "addLabel",
  "aria-label",
  "ariaLabel",
  "cancelLabel",
  "confirmLabel",
  "desc",
  "description",
  "detail",
  "empty",
  "emptyDetail",
  "emptyTitle",
  "hint",
  "idle",
  "info",
  "label",
  "note",
  "sourceLabel",
  "text",
  "title",
]);
const TEXT_CALLS = new Set(["toast"]);

/** What an empty field may show: the value it stands for when left empty. */
const EMPTY_VALUE_RE = /^(?:any(?: [a-z]+)?|anyone|none)$/;
/** What a select may show with nothing picked; "add …" on a picker that adds. */
const EMPTY_PICK_RE = /^(?:any(?: [a-z]+)?|anyone|none|add(?: [a-z]+){0,2})$/;
const EMPTY_VALUES = `"any …", "anyone" or "none"`;
const NATIVE_FIELD_RE = /^(?:input|textarea)$/;
const CAPITALISED_RE = /(?<![\w'])(?:[A-Z][a-z][\w']*|A(?=\s))/g;
const SVELTE_BLOCK_RE = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/g;

const lineAt = (text, offset) => text.slice(0, offset).split("\n").length;

/** The capitalised words of `text` that are not names. */
function capitalised(text) {
  const words = text.replace(/\$\{[^}]*\}/g, " ").match(CAPITALISED_RE) ?? [];
  return words.filter((word) => !PROPER_NOUNS.has(word));
}

function caseFindings(text, line) {
  const words = capitalised(text);
  if (!words.length) return [];
  return [
    {
      line,
      rule: "case",
      message: `"${words[0]}" in "${text.trim().slice(0, 60)}"`,
    },
  ];
}

/** Elements whose text is code or a key name, not copy. */
const CODE_ELEMENTS = new Set(["code", "pre", "kbd", "samp"]);
/** Fragment-holding keys of the Svelte template AST. */
const FRAGMENT_KEYS = [
  "fragment",
  "consequent",
  "alternate",
  "body",
  "fallback",
  "pending",
  "then",
  "catch",
];

/** String values an estree expression shows: the whole value, a branch, an operand. */
function shownStrings(node, out = []) {
  if (!node) return out;
  if (node.type === "Literal" && typeof node.value === "string")
    out.push({ value: node.value, start: node.start });
  else if (node.type === "TemplateLiteral")
    out.push({
      value: node.quasis.map((q) => q.value.cooked ?? "").join(" "),
      start: node.start,
    });
  else if (node.type === "ConditionalExpression") {
    shownStrings(node.consequent, out);
    shownStrings(node.alternate, out);
  } else if (node.type === "LogicalExpression") {
    shownStrings(node.left, out);
    shownStrings(node.right, out);
  } else if (node.type === "BinaryExpression" && node.operator === "+") {
    shownStrings(node.left, out);
    shownStrings(node.right, out);
  } else if (node.type === "ArrayExpression")
    for (const item of node.elements) textProps(item, out);
  else if (node.type === "ObjectExpression") textProps(node, out);
  return out;
}

/** The strings under text keys of object literals inside `node`. */
function textProps(node, out) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "ObjectExpression")
    for (const property of node.properties) {
      const key = property.key?.name ?? property.key?.value;
      if (property.type === "Property" && TEXT_KEYS.has(key))
        shownStrings(property.value, out);
      else textProps(property.value, out);
    }
  else if (node.type === "ArrayExpression")
    for (const item of node.elements) textProps(item, out);
  else if (node.type === "ConditionalExpression") {
    textProps(node.consequent, out);
    textProps(node.alternate, out);
  }
  return out;
}

const elementName = (node) =>
  node.type === "RegularElement" || node.type === "Component" ? node.name : "";

function placeholderFindings(element, attribute, text) {
  const native = NATIVE_FIELD_RE.test(elementName(element));
  const parts = attribute.value === true ? [] : [attribute.value].flat();
  const literal = parts.every((part) => part.type === "Text")
    ? parts.map((part) => part.data).join("")
    : parts.length === 1 && parts[0].type === "ExpressionTag"
      ? shownStrings(parts[0].expression).map((found) => found.value)
      : null;
  if (literal === null) return [];
  const values = [literal].flat().filter(Boolean);
  const line = lineAt(text, attribute.start);
  const allowed = native ? EMPTY_VALUE_RE : EMPTY_PICK_RE;
  return values
    .filter((value) => !allowed.test(value.replace(/\s+/g, " ").trim()))
    .map((value) => ({
      line,
      rule: "placeholder",
      message: native
        ? `"${value}" in an empty input is not ${EMPTY_VALUES}`
        : `"${value}" is not "any …", "anyone", "none" or "add …"`,
    }));
}

/** Text and text props of `.svelte` markup, read from the compiler's AST. */
function markupFindings(text) {
  const ast = parse(text, { modern: true });
  const found = [];
  const check = (value, start) =>
    found.push(...caseFindings(value, lineAt(text, start)));

  const visitAttributes = (element) => {
    for (const attribute of element.attributes ?? []) {
      if (attribute.type === "UseDirective" && attribute.name === "tip") {
        for (const shown of shownStrings(attribute.expression))
          check(shown.value, shown.start);
        continue;
      }
      if (attribute.type !== "Attribute") continue;
      if (attribute.name === "placeholder") {
        found.push(...placeholderFindings(element, attribute, text));
        continue;
      }
      const parts = attribute.value === true ? [] : [attribute.value].flat();
      for (const part of parts) {
        if (part.type === "Text" && TEXT_KEYS.has(attribute.name))
          check(part.data, part.start);
        if (part.type !== "ExpressionTag") continue;
        const strings = TEXT_KEYS.has(attribute.name)
          ? shownStrings(part.expression)
          : textProps(part.expression, []);
        for (const shown of strings) check(shown.value, shown.start);
      }
    }
  };

  const visit = (node, inCode) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node))
      return node.forEach((child) => visit(child, inCode));
    if (node.type === "Text") {
      if (!inCode) check(node.data, node.start);
      return;
    }
    if (node.type === "ExpressionTag") {
      if (!inCode)
        for (const shown of shownStrings(node.expression))
          check(shown.value, shown.start);
      return;
    }
    if (node.type === "RenderTag") {
      const call = node.expression.expression ?? node.expression;
      for (const argument of call.arguments ?? [])
        for (const shown of shownStrings(argument))
          check(shown.value, shown.start);
      return;
    }
    const code = inCode || CODE_ELEMENTS.has(elementName(node));
    if (node.attributes) visitAttributes(node);
    for (const key of FRAGMENT_KEYS) if (node[key]) visit(node[key], code);
    if (node.nodes) visit(node.nodes, code);
  };
  visit(ast.fragment, false);
  return found;
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isTemplateExpression(node))
    return [
      node.head.text,
      ...node.templateSpans.map((s) => s.literal.text),
    ].join(" ");
  return null;
}

/** The strings a script expression can show: the whole value, a branch, an operand. */
function literalTexts(node) {
  if (ts.isParenthesizedExpression(node)) return literalTexts(node.expression);
  if (ts.isConditionalExpression(node))
    return [...literalTexts(node.whenTrue), ...literalTexts(node.whenFalse)];
  if (ts.isBinaryExpression(node))
    return [...literalTexts(node.left), ...literalTexts(node.right)];
  const text = literalText(node);
  return text === null ? [] : [text];
}

const keyName = (name) =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;

function scriptFindings(text, { firstLine = 1, everyString = false } = {}) {
  const source = ts.createSourceFile(
    "source.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found = [];
  const lineOf = (node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line +
    firstLine;

  const visit = (node) => {
    if (everyString && ts.isStringLiteral(node))
      found.push(...caseFindings(node.text, lineOf(node)));
    else if (ts.isPropertyAssignment(node)) {
      const key = keyName(node.name);
      const values = literalTexts(node.initializer);
      if (key === "placeholder")
        for (const value of values.filter((v) => v && !EMPTY_VALUE_RE.test(v)))
          found.push({
            line: lineOf(node),
            rule: "placeholder",
            message: `"${value}" in an empty input is not ${EMPTY_VALUES}`,
          });
      else if (key && TEXT_KEYS.has(key))
        for (const value of values)
          found.push(...caseFindings(value, lineOf(node)));
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      TEXT_CALLS.has(node.expression.text) &&
      node.arguments[0]
    ) {
      const value = literalText(node.arguments[0]);
      if (value !== null) found.push(...caseFindings(value, lineOf(node)));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** What `path` breaks, as `{ line, rule, message }`, in line order. */
export function violations(path, text) {
  if (NAME_FILES.has(path)) return [];
  if (!path.endsWith(".svelte"))
    return scriptFindings(text, { everyString: COPY_FILES.has(path) });
  const found = markupFindings(text);
  for (const match of text.matchAll(SVELTE_BLOCK_RE)) {
    if (match[1] !== "script") continue;
    const bodyOffset = match.index + match[0].indexOf(">") + 1;
    found.push(
      ...scriptFindings(match[2], { firstLine: lineAt(text, bodyOffset) }),
    );
  }
  return found.sort((a, b) => a.line - b.line);
}

/** Repo-relative paths under `targets` within the SPA, all of it when there are none. */
export function checkedFiles(targets = []) {
  const listing = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...(targets.length ? targets : [SCOPE]),
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: LISTING_MAX_BYTES },
  );
  return listing
    .split("\0")
    .filter(
      (path) => path.startsWith(`${SCOPE}/`) && CHECKED_FILE_RE.test(path),
    )
    .filter((path) => existsSync(resolve(ROOT, path)))
    .sort();
}

function main(targets) {
  let count = 0;
  for (const path of checkedFiles(targets)) {
    for (const { line, rule, message } of violations(
      path,
      readFileSync(resolve(ROOT, path), "utf8"),
    )) {
      console.error(`${path}:${line}  ${rule}  ${message}`);
      count++;
    }
  }
  if (count) {
    console.error(`\ncopy:check: ${count} to fix (see CLAUDE.md).`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
