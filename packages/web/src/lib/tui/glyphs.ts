/**
 * The app's glyph vocabulary. One meaning, one glyph, everywhere.
 *
 * Every entry here has to exist in a bundled face — see the note in tokens.css.
 * Neither Plex face carries any of these, so they all resolve through DejaVu
 * Mono at the tail of every stack. Anything DejaVu lacks, and any mark that
 * names an action, is an SVG in ICONS instead.
 */
export const G = {
  right: "▸",
  marker: "▎",
  dot: "●",
} as const;

/** Block ramp, lightest to solid — bands and textures. */
export const RAMP = ["·", "░", "▒", "▓", "█"] as const;
