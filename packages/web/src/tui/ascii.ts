/**
 * Small drawings for empty states, in the box-drawing and block characters
 * DejaVu Mono carries. One per kind of place, at most five lines, every line
 * the same width so the drawing stays square in a monospace face.
 */
export const ASCII_ART = {
  library: ["┌─┬─┬──┬─┐", "│▒│░│▓▓│▒│", "└─┴─┴──┴─┘"],
  board: ["┌──┬──┬──┐", "│▓▓│░░│  │", "│▒▒│  │  │", "└──┴──┴──┘"],
  wiki: ["┌─────┐", "│▀▀▀▀ │", "│▄▄▄  │", "└─────┘"],
  noMatch: [" ▄▀▀▀▄   ", " █   █   ", " ▀▄▄▄▀▄  ", "      ▀▄ "],
  empty: ["┌────────┐", "│ ······ │", "│ ······ │", "└────────┘"],
  reports: ["┃▀▀▀▄", "┃▄▄▄▀", "┃    "],
  complete: ["▓▓▓▓▓▓▓▓", "▓▓▓▓▓▓▓▓"],
} as const;

export type AsciiArt = keyof typeof ASCII_ART;
