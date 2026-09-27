/**
 * How a team shapes one creation form, stored per registered project and item
 * type. Source-agnostic: fields are the source's own field ids, and a source
 * with no such form simply has no config.
 */

/**
 * "form" shows it even where the source's own form hides it; "fold" tucks it
 * into the collapsed section; "hidden" leaves it out, its default still sent.
 * With no entry, the source's own form decides.
 */
export type FieldShow = "form" | "fold" | "hidden";

/** A starting value the person can still change. */
export type FieldDefault = { value: unknown } | { macro: "@me" };

export interface FieldFormConfig {
  show?: FieldShow;
  default?: FieldDefault;
}

export interface TypeFormConfig {
  fields?: Record<string, FieldFormConfig>;
  /** Field ids in the order they are drawn; ones not listed keep their place after. */
  order?: string[];
  /** Appended to tachy's review checklist for this type. */
  guidance?: string;
}

export interface ComposeConfig {
  /** The types offered, in order. Absent: every type the source can create. */
  types?: string[];
  forms?: Record<string, TypeFormConfig>;
}

/** What the composer draws differently because of a team's config. */
export interface FormDisplay {
  show: Record<string, FieldShow>;
  order: string[];
}

export const FIELD_SHOWS: readonly FieldShow[] = ["form", "fold", "hidden"];
