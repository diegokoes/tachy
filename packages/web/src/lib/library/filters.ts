import { CONFIDENCES, RESOLUTION_CLARITIES } from "../vocab";

/** A facet key as `/knowledge/facets` returns it. */
export type FacetKey =
  | "tags"
  | "customer"
  | "cloud"
  | "confidence"
  | "resolution_clarity"
  | "resolution_pattern"
  | "hidden_fix"
  | "affected_version"
  | "fixed_version";

export type FacetCount = { value: string; count: number };
export type Facets = Partial<Record<FacetKey, FacetCount[]>>;

export type ExtraFilter = {
  key: FacetKey;
  /** Menu entry and the control's title. */
  label: string;
  /** Shown inside the control when nothing is picked. */
  any: string;
  /** Query parameter sent to /knowledge. */
  param: string;
  /** `enum` has a fixed option list; `facet` reads its options from the
   *  counts; `tags` is the multi-select text widget. */
  kind: "enum" | "facet" | "tags";
  options?: readonly string[];
};

/**
 * Everything the `+` menu can add. The default controls — product, component,
 * affected version, status — stay hard-wired in the view; these are the ones
 * that were reachable from no filter at all before.
 *
 * All of them are entry-only, like affected version already is:
 * `/knowledge/facets` counts knowledge entries, so offering them while
 * browsing docs would show counts that do not describe the list.
 */
export const EXTRA_FILTERS: ExtraFilter[] = [
  {
    key: "confidence",
    label: "confidence",
    any: "any confidence",
    param: "confidence",
    kind: "enum",
    options: CONFIDENCES,
  },
  {
    key: "resolution_clarity",
    label: "clarity",
    any: "any clarity",
    param: "resolution_clarity",
    kind: "enum",
    options: RESOLUTION_CLARITIES,
  },
  {
    key: "customer",
    label: "customer",
    any: "any customer",
    param: "customer",
    kind: "facet",
  },
  {
    key: "cloud",
    label: "environment",
    any: "any environment",
    param: "cloud",
    kind: "facet",
  },
  {
    key: "resolution_pattern",
    label: "pattern",
    any: "any pattern",
    param: "resolution_pattern",
    kind: "facet",
  },
  {
    key: "hidden_fix",
    label: "hidden fix",
    any: "hidden fix: any",
    param: "hidden_fix",
    kind: "enum",
    options: ["true", "false"],
  },
  {
    key: "fixed_version",
    label: "fixed version",
    any: "any fixed version",
    param: "fixed_version",
    kind: "facet",
  },
  { key: "tags", label: "tags", any: "any tag", param: "tags", kind: "tags" },
];

export const byKey = (k: FacetKey): ExtraFilter | undefined =>
  EXTRA_FILTERS.find((f) => f.key === k);

const STORAGE_KEY = "tachy-library-filters";

export type Stored = { shown: FacetKey[]; values: Record<string, string> };

/** Which extras are on screen, and what each is set to. */
export function loadFilters(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { shown: [], values: {} };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const shown = (parsed.shown ?? []).filter((k) => byKey(k));
    return { shown, values: parsed.values ?? {} };
  } catch {
    return { shown: [], values: {} };
  }
}

export function saveFilters(s: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* private mode, quota — the filters still work for this session. */
  }
}

/**
 * A stored value that the current facet counts no longer offer would silently
 * narrow the list to nothing, so it is dropped rather than kept. `enum` filters
 * are checked against their fixed list instead — an enum value with no rows
 * behind it right now is still a legitimate thing to ask for.
 */
export function pruneValues(
  shown: FacetKey[],
  values: Record<string, string>,
  facets: Facets,
): Record<string, string> {
  const next = { ...values };
  for (const key of shown) {
    const def = byKey(key);
    const v = next[key];
    if (!def || !v) continue;
    if (def.kind === "enum") {
      if (!def.options?.includes(v)) delete next[key];
    } else if (def.kind === "facet") {
      if (!(facets[key] ?? []).some((o) => o.value === v)) delete next[key];
    } else if (def.kind === "tags") {
      const offered = new Set((facets.tags ?? []).map((o) => o.value));
      const kept = v.split(",").filter((t) => offered.has(t));
      if (kept.length) next[key] = kept.join(",");
      else delete next[key];
    }
  }
  return next;
}

/** Add the active extras to a query string. */
export function applyExtras(
  p: URLSearchParams,
  shown: FacetKey[],
  values: Record<string, string>,
) {
  for (const key of shown) {
    const def = byKey(key);
    const v = values[key];
    if (def && v) p.set(def.param, v);
  }
  return p;
}
