/**
 * Holds the mechanical half of the comment convention in CLAUDE.md over the
 * paths in `SWEPT`: length caps, which comment syntax goes where, banners, em
 * dashes, unreferenced TODOs and commented-out code. Tense and register cannot
 * be matched without false positives and are left to review.
 *
 *   npm run comments:check [path ...]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname;

/** Repo-relative path prefixes already brought under the convention. */
export const SWEPT = [
  "packages/agent",
  "packages/api",
  "packages/contract",
  "packages/core/src/buckets",
  "packages/core/src/catalog",
  "packages/core/src/code",
  "packages/core/src/flows",
  "packages/core/src/jobs",
  "packages/core/src/knowledge",
  "packages/core/src/library",
  "packages/core/src/reference",
  "packages/core/src/search",
  "packages/core/src/sources",
  "packages/core/src/wiki",
  "packages/core/src/work-items",
  "packages/mcp",
  "packages/sources",
  "packages/web/src/shell",
  "packages/web/src/tui/Tabs.svelte",
  "packages/worker",
  "test/search/embeddings.test.ts",
  "test/search/quality.test.ts",
];

const CHECKED_FILE_RE = /\.(?:[cm]?[jt]s|svelte|css)$/;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "coverage"]);

const BODY_CAP = 3;
const DECLARATION_CAP = 5;
const HEADER_CAP = 12;

/** Compiler, test-runner and formatter instructions, and JSDoc type tags. */
const DIRECTIVE_RE =
  /^(?:@[a-z]|svelte-ignore\b|prettier-ignore\b|eslint-|(?:v8|c8|istanbul) ignore\b|[#@]__PURE__)/;
const BANNER_RE = /([-=─━═~#*_])\1{3,}/;
const EM_DASH = "—";
const MARKER_RE = /(?:^|\s)(?:TODO|FIXME|HACK|XXX)\b(?:\([^)]*\))?(?::|\s|$)/;
const ISSUE_RE = /#\d+/;
/** A keyword-led line ending like a statement, a bare call, an assignment, or a lone brace. */
const CODE_LINE_RE =
  /^(?:(?:export\s+)?(?:const|let|var|function|class|import|return|throw|await|if\s*\(|for\s*\(|while\s*\(|switch\s*\()\b.*[;{]|[\w$.]+\(.*\);|[\w$.[\]]+\s*=\s*[^=\s].*;|\}(?:\s*else\s*\{)?)$/;

const SK = ts.SyntaxKind;
const DECLARATION_KINDS = new Set([
  SK.FunctionDeclaration,
  SK.ClassDeclaration,
  SK.InterfaceDeclaration,
  SK.TypeAliasDeclaration,
  SK.EnumDeclaration,
  SK.ModuleDeclaration,
  SK.VariableStatement,
  SK.ExportAssignment,
  SK.ExportDeclaration,
  SK.PropertyDeclaration,
  SK.MethodDeclaration,
  SK.Constructor,
  SK.GetAccessor,
  SK.SetAccessor,
  SK.PropertySignature,
  SK.MethodSignature,
  SK.IndexSignature,
  SK.CallSignature,
  SK.ConstructSignature,
  SK.EnumMember,
  SK.PropertyAssignment,
  SK.ShorthandPropertyAssignment,
  SK.Parameter,
  SK.BindingElement,
]);

const lineAt = (text, offset) => text.slice(0, offset).split("\n").length;

const blockLines = (raw) =>
  raw
    .replace(/^\/\*+|\*+\/$/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, "").trimEnd());

/** Every comment in a TypeScript or JavaScript source, `//` runs merged into one. */
function scriptComments(text, { firstLine = 1, canHoldHeader = true } = {}) {
  const source = ts.createSourceFile(
    "source.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const firstToken = source.getFirstToken(source);
  const codeStart = firstToken ? firstToken.getStart(source) : text.length;
  const seen = new Set();
  const ranges = [];

  const visit = (node) => {
    if (ts.isJSDoc(node)) return;
    if (node.kind !== SK.SyntaxList) {
      for (const range of ts.getLeadingCommentRanges(
        text,
        node.getFullStart(),
      ) ?? []) {
        if (seen.has(range.pos)) continue;
        seen.add(range.pos);
        ranges.push({ range, owner: node });
      }
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  for (const child of source.getChildren(source)) visit(child);
  ranges.sort((a, b) => a.range.pos - b.range.pos);

  const comments = [];
  for (const { range, owner } of ranges) {
    const raw = text.slice(range.pos, range.end);
    const lineStart = text.lastIndexOf("\n", range.pos - 1) + 1;
    const lineEnd = text.indexOf("\n", range.end);
    const sharesLine =
      text.slice(lineStart, range.pos).trim() !== "" ||
      text.slice(range.end, lineEnd === -1 ? text.length : lineEnd).trim() !==
        "";
    const line = lineAt(text, range.pos) + firstLine - 1;
    const isLine = range.kind === SK.SingleLineCommentTrivia;

    const previous = comments.at(-1);
    if (
      isLine &&
      !sharesLine &&
      previous?.syntax === "line" &&
      !previous.sharesLine &&
      previous.line + previous.lines.length === line
    ) {
      previous.lines.push(raw.replace(/^\/\/\s?/, ""));
      continue;
    }

    comments.push({
      line,
      syntax: isLine ? "line" : raw.startsWith("/**") ? "jsdoc" : "block",
      place: "script",
      lines: isLine ? [raw.replace(/^\/\/\s?/, "")] : blockLines(raw),
      sharesLine,
      isHeader: canHoldHeader && comments.length === 0 && range.pos < codeStart,
      onDeclaration: DECLARATION_KINDS.has(owner.kind),
    });
  }
  return comments;
}

function patternComments(text, pattern, syntax, place, firstLine = 1) {
  const comments = [];
  for (const match of text.matchAll(pattern)) {
    comments.push({
      line: lineAt(text, match.index) + firstLine - 1,
      syntax,
      place,
      lines:
        syntax === "html"
          ? match[0]
              .replace(/^<!--|-->$/g, "")
              .split("\n")
              .map((line) => line.trim())
          : blockLines(match[0]),
      sharesLine: false,
      isHeader: text.slice(0, match.index).trim() === "",
      onDeclaration: false,
    });
  }
  return comments;
}

const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const SVELTE_BLOCK_RE = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/g;

function svelteComments(text) {
  const comments = [];
  let markup = text;
  for (const match of text.matchAll(SVELTE_BLOCK_RE)) {
    const bodyOffset = match.index + match[0].indexOf(">") + 1;
    const firstLine = lineAt(text, bodyOffset);
    if (match[1] === "script") {
      comments.push(
        ...scriptComments(match[2], {
          firstLine,
          canHoldHeader: text.slice(0, match.index).trim() === "",
        }),
      );
    } else {
      comments.push(
        ...patternComments(
          match[2],
          CSS_COMMENT_RE,
          "block",
          "style",
          firstLine,
        ).map((comment) => ({ ...comment, isHeader: false })),
      );
    }
    markup =
      markup.slice(0, match.index) +
      match[0].replace(/[^\n]/g, " ") +
      markup.slice(match.index + match[0].length);
  }
  comments.push(...patternComments(markup, HTML_COMMENT_RE, "html", "markup"));
  return comments.sort((a, b) => a.line - b.line);
}

export function commentsIn(path, text) {
  if (path.endsWith(".svelte")) return svelteComments(text);
  if (path.endsWith(".css"))
    return patternComments(text, CSS_COMMENT_RE, "block", "style");
  return scriptComments(text);
}

/** What `path` breaks, as `{ line, rule, message }`, in line order. */
export function violations(path, text) {
  const found = [];
  for (const comment of commentsIn(path, text)) {
    const written = comment.lines.filter((line) => line.trim() !== "");
    if (written.length === 0 || DIRECTIVE_RE.test(written[0].trim())) continue;
    const report = (rule, message) =>
      found.push({ line: comment.line, rule, message });
    const isJsdoc = comment.syntax === "jsdoc";

    const cap = comment.isHeader
      ? HEADER_CAP
      : isJsdoc && comment.onDeclaration
        ? DECLARATION_CAP
        : BODY_CAP;
    if (written.length > cap)
      report("length", `${written.length} lines, the cap here is ${cap}`);

    if (isJsdoc && !comment.isHeader && !comment.onDeclaration)
      report("syntax", "`/** */` belongs on a declaration; use `//`");
    if (
      comment.syntax === "block" &&
      comment.place === "script" &&
      !comment.sharesLine
    )
      report("syntax", "`/* */` is for CSS; use `//`");

    if (written.some((line) => BANNER_RE.test(line)))
      report("banner", "no divider lines");
    if (written.some((line) => line.includes(EM_DASH)))
      report("em-dash", "no em dashes");
    if (
      written.some((line) => MARKER_RE.test(line)) &&
      !written.some((line) => ISSUE_RE.test(line))
    )
      report("todo", "name the issue, as #123");
    if (!isJsdoc && comment.syntax !== "html") {
      const code = written.find((line) => CODE_LINE_RE.test(line.trim()));
      if (code) report("dead-code", `commented-out code: ${code.trim()}`);
    }
  }
  return found;
}

function checkedFiles(target, files = []) {
  if (!statSync(target).isDirectory()) {
    if (CHECKED_FILE_RE.test(target)) files.push(target);
    return files;
  }
  for (const name of readdirSync(target)) {
    if (SKIPPED_DIRS.has(name) || name.startsWith(".")) continue;
    checkedFiles(join(target, name), files);
  }
  return files;
}

function main(targets) {
  let count = 0;
  for (const target of targets) {
    for (const file of checkedFiles(resolve(ROOT, target))) {
      const path = relative(ROOT, file);
      for (const { line, rule, message } of violations(
        path,
        readFileSync(file, "utf8"),
      )) {
        console.error(`${path}:${line}  ${rule}  ${message}`);
        count++;
      }
    }
  }
  if (count) {
    console.error(`\ncomments:check: ${count} to fix (see CLAUDE.md).`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const targets = process.argv.slice(2);
  main(targets.length ? targets : SWEPT);
}
