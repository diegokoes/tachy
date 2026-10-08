/**
 * Which of a file's changed lines hold the code its base had: the same tokens,
 * with local bindings renamed and the layout or the comments changed. Such a
 * line is not new code, so `coverage-diff.ts` does not ask a test to run it.
 *
 * A hunk qualifies when its tokens equal the base's with every local binding
 * read as one wildcard, and each binding it mentions pairs with one base
 * binding, declared at the paired place. A swapped argument, a reference that
 * resolves to another variable than before, and a renamed export or property
 * each fail one of those and count as added.
 */
import ts from "typescript";

export interface Hunk {
  /** With a count of 0, the line the change follows. */
  baseStart: number;
  baseCount: number;
  headStart: number;
  headCount: number;
}

interface Token {
  key: string;
  line: number;
  binding?: ts.Symbol;
  declares?: boolean;
}

type Pair = [base: Token, head: Token];

/** Adjacent hunks and the tokens on each side of them. */
interface Change {
  hunks: Hunk[];
  base: Token[];
  head: Token[];
}

/** No source token reads as these. */
const LOCAL = "\u0000local";
const STATEMENT = "\u0000statement";
const RENAMABLE =
  ts.SymbolFlags.Variable | ts.SymbolFlags.Function | ts.SymbolFlags.Class;
/** Prettier adds a comma before these when it breaks a list over lines. */
const CLOSERS = new Set([")", "]", "}"]);
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Each file's hunks in `git diff --unified=0` output, by path. */
export function parseHunks(diff: string): Map<string, Hunk[]> {
  const files = new Map<string, Hunk[]>();
  let current: Hunk[] | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      current = [];
      files.set(line.slice(6), current);
      continue;
    }
    const hunk = HUNK_RE.exec(line);
    if (!hunk || !current) continue;
    current.push({
      baseStart: Number(hunk[1]),
      baseCount: hunk[2] === undefined ? 1 : Number(hunk[2]),
      headStart: Number(hunk[3]),
      headCount: hunk[4] === undefined ? 1 : Number(hunk[4]),
    });
  }
  return files;
}

/**
 * The parentheses Prettier puts around a `return` or `throw` argument it
 * breaks over lines, where a bare line break would end the statement.
 */
const isLayoutParenthesis = (
  node: ts.Node,
): node is ts.ParenthesizedExpression =>
  ts.isParenthesizedExpression(node) &&
  (ts.isReturnStatement(node.parent) || ts.isThrowStatement(node.parent));

/** One file as a program, so an identifier resolves to the binding it names. */
function parse(path: string, text: string) {
  const name = `/${path.split("/").pop()}`;
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const host: ts.CompilerHost = {
    getSourceFile: (file) => (file === name ? source : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (file) => file,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (file) => file === name,
    readFile: (file) => (file === name ? text : undefined),
  };
  const program = ts.createProgram(
    [name],
    {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
      noResolve: true,
      noLib: true,
    },
    host,
  );
  return { source, checker: program.getTypeChecker() };
}

/**
 * The file's tokens in order, comments left out. A shorthand property or
 * binding is written out as `name: local`, so renaming the local it reads
 * leaves the same tokens. Each statement opens with a marker, so a line break
 * that ends one early, as after `return`, does not.
 */
function tokensOf(path: string, text: string): Token[] {
  const { source, checker } = parse(path, text);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const exported = new Set(
    moduleSymbol
      ? checker
          .getExportsOfModule(moduleSymbol)
          .map((symbol) =>
            symbol.flags & ts.SymbolFlags.Alias
              ? checker.getAliasedSymbol(symbol)
              : symbol,
          )
      : [],
  );

  const localBinding = (symbol: ts.Symbol | undefined) => {
    if (!symbol || !(symbol.flags & RENAMABLE) || exported.has(symbol))
      return undefined;
    const declarations = symbol.declarations ?? [];
    if (!declarations.length) return undefined;
    const isLocal = declarations.every(
      (declaration) =>
        declaration.getSourceFile() === source &&
        !(ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Export),
    );
    return isLocal ? symbol : undefined;
  };

  const tokens: Token[] = [];
  const lineOf = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const pushLocal = (node: ts.Identifier, binding: ts.Symbol) =>
    tokens.push({
      key: LOCAL,
      line: lineOf(node),
      binding,
      declares: (binding.declarations ?? []).some(
        (declaration) => ts.getNameOfDeclaration(declaration) === node,
      ),
    });
  const pushText = (node: ts.Node, key: string) =>
    tokens.push({ key, line: lineOf(node) });

  const pushIdentifier = (node: ts.Identifier) => {
    const parent = node.parent;
    const isShorthand =
      (ts.isShorthandPropertyAssignment(parent) && parent.name === node) ||
      (ts.isBindingElement(parent) &&
        parent.name === node &&
        !parent.propertyName &&
        !parent.dotDotDotToken &&
        ts.isObjectBindingPattern(parent.parent));
    const isMemberName =
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node) ||
      (ts.isBindingElement(parent) && parent.propertyName === node) ||
      ts.isImportSpecifier(parent) ||
      ts.isExportSpecifier(parent);
    const binding = isMemberName
      ? undefined
      : localBinding(
          ts.isShorthandPropertyAssignment(parent)
            ? checker.getShorthandAssignmentValueSymbol(parent)
            : checker.getSymbolAtLocation(node),
        );
    if (!binding) return pushText(node, node.text);
    if (isShorthand) {
      pushText(node, node.text);
      pushText(node, ":");
    }
    pushLocal(node, binding);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJSDoc(node) || node.kind === ts.SyntaxKind.EndOfFileToken) return;
    if (ts.isIdentifier(node)) return pushIdentifier(node);
    if (isLayoutParenthesis(node)) return visit(node.expression);
    if (ts.isStatement(node)) pushText(node, STATEMENT);
    const children = node.getChildren(source);
    if (children.length) return children.forEach(visit);
    const key = node.getText(source);
    if (key) pushText(node, key);
  };
  visit(source);

  return tokens.filter(
    (token, i) => !(token.key === "," && CLOSERS.has(tokens[i + 1]?.key ?? "")),
  );
}

/** The local-binding pairs of two equal token runs, or null when they differ. */
function pairsOf(base: Token[], head: Token[]): Pair[] | null {
  if (base.length !== head.length) return null;
  const pairs: Pair[] = [];
  for (let i = 0; i < base.length; i++) {
    if (base[i].key !== head[i].key) return null;
    if (base[i].binding) pairs.push([base[i], head[i]]);
  }
  return pairs;
}

/**
 * The head line numbers proven to hold the base's code. Empty when the file
 * does not parse or a line git reports as unchanged reads differently, which
 * is a name that now resolves elsewhere.
 */
export function renamedLines(
  path: string,
  base: string,
  head: string,
  hunks: Hunk[],
): Set<number> {
  const before = tokensOf(path, base);
  const after = tokensOf(path, head);
  let baseAt = 0;
  let headAt = 0;
  const upTo = (tokens: Token[], from: number, line: number) => {
    let to = from;
    while (to < tokens.length && tokens[to].line < line) to++;
    return to;
  };

  // Hunks with no token between them are one change: code that moved past a
  // comment leaves git a removal on one side of it and an addition on the other.
  const pairs: Pair[] = [];
  const changes: Change[] = [];
  for (const hunk of hunks) {
    const baseFirst = hunk.baseCount ? hunk.baseStart : hunk.baseStart + 1;
    const headFirst = hunk.headCount ? hunk.headStart : hunk.headStart + 1;

    const baseSame = upTo(before, baseAt, baseFirst);
    const headSame = upTo(after, headAt, headFirst);
    if (baseSame > baseAt || headSame > headAt || !changes.length) {
      const unchanged = pairsOf(
        before.slice(baseAt, baseSame),
        after.slice(headAt, headSame),
      );
      if (!unchanged) return new Set();
      pairs.push(...unchanged);
      changes.push({ hunks: [], base: [], head: [] });
    }

    baseAt = upTo(before, baseSame, baseFirst + hunk.baseCount);
    headAt = upTo(after, headSame, headFirst + hunk.headCount);
    const change = changes[changes.length - 1];
    change.hunks.push(hunk);
    change.base.push(...before.slice(baseSame, baseAt));
    change.head.push(...after.slice(headSame, headAt));
  }
  const tail = pairsOf(before.slice(baseAt), after.slice(headAt));
  if (!tail) return new Set();
  pairs.push(...tail);

  const candidates: { hunks: Hunk[]; pairs: Pair[] }[] = [];
  for (const change of changes) {
    const renamed = pairsOf(change.base, change.head);
    if (!renamed) continue;
    pairs.push(...renamed);
    candidates.push({ hunks: change.hunks, pairs: renamed });
  }

  const headsOf = new Map<ts.Symbol, Set<ts.Symbol>>();
  const basesOf = new Map<ts.Symbol, Set<ts.Symbol>>();
  const declaredTogether = new Set<ts.Symbol>();
  const note = (
    partners: Map<ts.Symbol, Set<ts.Symbol>>,
    of: ts.Symbol,
    partner: ts.Symbol,
  ) => partners.set(of, (partners.get(of) ?? new Set()).add(partner));
  for (const [baseToken, headToken] of pairs) {
    note(headsOf, baseToken.binding!, headToken.binding!);
    note(basesOf, headToken.binding!, baseToken.binding!);
    if (baseToken.declares && headToken.declares)
      declaredTogether.add(headToken.binding!);
  }
  const isSameBinding = ([baseToken, headToken]: Pair) =>
    headsOf.get(baseToken.binding!)!.size === 1 &&
    basesOf.get(headToken.binding!)!.size === 1 &&
    declaredTogether.has(headToken.binding!);

  const proven = new Set<number>();
  for (const { hunks: proved, pairs: mentioned } of candidates) {
    if (!mentioned.every(isSameBinding)) continue;
    for (const hunk of proved)
      for (let i = 0; i < hunk.headCount; i++) proven.add(hunk.headStart + i);
  }
  return proven;
}
