/** The app's glyph vocabulary. One meaning, one glyph, everywhere. */
export const G = {
  save: "✓",
  del: "✕",
  add: "+",
  right: "▸",
  expanded: "▾",
  marker: "▎",
  selected: "›",
  dot: "●",
  file: "⤓",
  artifact: "⛬",
  tool: "⚙",
  enter: "⏎",
} as const;

/** Block ramp, lightest to solid — meters, bands, spinners. */
export const RAMP = ["·", "░", "▒", "▓", "█"] as const;
