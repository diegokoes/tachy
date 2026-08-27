/**
 * The app's glyph vocabulary. One meaning, one glyph, everywhere.
 *
 * Every entry here has to exist in a bundled face — see the note in tokens.css.
 * Neither Plex face carries any of these, so they all resolve through DejaVu
 * Mono at the tail of every stack; anything DejaVu lacks belongs in ICONS as
 * an SVG instead, which is where ⤓ (download) and ⛬ (artifact) went.
 */
export const G = {
  save: "✓",
  del: "✕",
  add: "+",
  right: "▸",
  expanded: "▾",
  marker: "▎",
  selected: "›",
  dot: "●",
  tool: "⚙",
  enter: "⏎",
} as const;

/** Block ramp, lightest to solid — bands and textures. */
export const RAMP = ["·", "░", "▒", "▓", "█"] as const;
