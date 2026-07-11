export const ANSI16: { name: string; hex: string }[] = [
  { name: "black", hex: "#000000" },
  { name: "red", hex: "#cd3131" },
  { name: "green", hex: "#0dbc79" },
  { name: "yellow", hex: "#e5e510" },
  { name: "blue", hex: "#2472c8" },
  { name: "magenta", hex: "#bc3fbc" },
  { name: "cyan", hex: "#11a8cd" },
  { name: "white", hex: "#e5e5e5" },
  { name: "bright black", hex: "#666666" },
  { name: "bright red", hex: "#f14c4c" },
  { name: "bright green", hex: "#23d18b" },
  { name: "bright yellow", hex: "#f5f543" },
  { name: "bright blue", hex: "#3b8eea" },
  { name: "bright magenta", hex: "#d670d6" },
  { name: "bright cyan", hex: "#29b8db" },
  { name: "bright white", hex: "#ffffff" },
];

export type BorderKey = "none" | "tilde" | "blocks" | "hash";

export const BORDERS: Record<
  Exclude<BorderKey, "none">,
  { top: string; bottom: string; left: string; right: string }
> = {
  tilde: { top: "~", bottom: "~", left: "~", right: "~" },
  blocks: { top: "▀", bottom: "▄", left: "▐", right: "▌" },
  hash: { top: "#", bottom: "#", left: "#", right: "#" },
};

export const BORDER_KEYS = Object.keys(BORDERS) as Exclude<BorderKey, "none">[];

export function borderPreview(k: Exclude<BorderKey, "none">): string {
  const b = BORDERS[k];
  const w = 24;
  const top = b.left + b.top.repeat(w) + b.right;
  const mid = b.left + " ".repeat(w) + b.right;
  return [top, mid, mid, mid, b.left + b.bottom.repeat(w) + b.right].join("\n");
}

export const PATTERN_LABELS = ["brackets", "rope", "slashes", "bricks", "stars"];

export function patternPreview(idx: number): string {
  const lines = PATTERNS[idx]
    .split("\n")
    .filter((l) => l.trim() !== "")
    .slice(0, 5);
  const start = Math.min(
    ...lines.map((l) => l.search(/\S/)).filter((n) => n >= 0),
  );
  return lines.map((l) => l.slice(start, start + 26)).join("\n");
}

function makeBg(rows: string[], vRep = 60): string {
  const wide = rows.map((u) => u.repeat(Math.ceil(650 / u.length) + 2));
  return (wide.join("\n") + "\n").repeat(vRep);
}

const P0 = makeBg([" |___  |", "    _|_|", "_  | |__", "_|_|    "]);
const P1 = makeBg(["  |  ", "`.__.' _.'", ',-"  ,-""-', "  |  "]);
const P2 = makeBg(["   /   __/  ", "__   \\__/  \\", "  \\__/  \\   ", "__/     /   "]);
const P3 = makeBg(["__|__|   ", " __|__|  ", "|   __|__", "|__|   __"]);

const STAR_LINES = [
  "                        .",
  "  .     '                           '                   **",
  " ",
  " ",
  "                         *                                                                    *",
  "                                         |                   ''",
  "                                        -o-",
  "                                         |",
  "        .                                      .                                          *",
  " ",
  "              +                 '                                |",
  "                             .:'                                -+-",
  "                         _.::'  +             .                  |",
  "                        (_.'                          .                                                         +",
  "                                                                                            +",
  "                         +                 +    ..",
  "       o                                                                      +",
  "                                               .                                        .            o",
  "                         \\                o                                                           o",
  " .                        \\                                                             .                  +",
  "                           *                              +",
  "                            o                           /     .                 .                       *",
  "                                                       /        .           +",
  "             .                                        *       '",
  "                     o",
  "                                                   .                     o                                          '",
  "                                                                                                                   '",
  "                                 .                    o                           |                    +",
  "                                                                                --o--",
  "                                                              .                   |",
  "                       .+",
  " ",
  "                       o                                 .        *                                .   '          . '",
  "                         +",
  "  _|_           .         '                                                                                        '",
  "   |                                o                                             '",
  " ",
  "                                                                                               '     .",
  "           o                                                                                        _|_",
  "              o                                                                                   +  |",
  "                    .",
  "                      .",
  " ",
  "           '",
  "                                +",
  "                                                                                                                   |",
  "                                o                                                                                --o--",
  "                                                               .                                               .   |",
  "                               .                 '",
  " ",
];
const starWidth = Math.max(...STAR_LINES.map((l) => l.length));
const P4 = makeBg(STAR_LINES.map((l) => l.padEnd(starWidth)), 6);

export const PATTERNS: string[] = [P0, P1, P2, P3, P4];
