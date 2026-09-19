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
  /** Menu entry, cap above the control, and the control's title. */
  label: string;
  /** Query parameter sent to /knowledge. */
  param: string;
  /** `enum` has a fixed option list; `facet` reads its options from the
   *  counts; `tags` is the multi-select text widget. */
  kind: "enum" | "facet" | "tags";
  options?: readonly string[];
  /**
   * Only offerable once a component is picked. A version string names a
   * release of one component; the same number under another names a different
   * build, so an unscoped list of them is a list of collisions.
   */
  needsComponent?: boolean;
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
    param: "confidence",
    kind: "enum",
    options: CONFIDENCES,
  },
  {
    key: "resolution_clarity",
    label: "clarity",
    param: "resolution_clarity",
    kind: "enum",
    options: RESOLUTION_CLARITIES,
  },
  {
    key: "customer",
    label: "customer",
    param: "customer",
    kind: "facet",
  },
  {
    key: "cloud",
    label: "environment",
    param: "cloud",
    kind: "facet",
  },
  {
    key: "resolution_pattern",
    label: "pattern",
    param: "resolution_pattern",
    kind: "facet",
  },
  {
    key: "hidden_fix",
    label: "hidden fix",
    param: "hidden_fix",
    kind: "enum",
    options: ["true", "false"],
  },
  {
    key: "fixed_version",
    label: "fixed version",
    param: "fixed_version",
    kind: "facet",
    needsComponent: true,
  },
  { key: "tags", label: "tags", param: "tags", kind: "tags" },
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
  const same =
    Object.keys(next).length === Object.keys(values).length &&
    Object.entries(next).every(([k, v]) => values[k] === v);
  return same ? values : next;
}

/** Drop what a component was scoping, for when the component goes away. */
export function clearScoped(
  values: Record<string, string>,
): Record<string, string> {
  const next = { ...values };
  for (const key of Object.keys(next))
    if (byKey(key as FacetKey)?.needsComponent) delete next[key];
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

/**
 * A product and component to open the list already narrowed to, handed over by
 * a page elsewhere — the wiki's coverage tree — that wants to show "everything
 * recorded under this part". The router carries paths only, so it travels
 * here; taken once, so the next visit opens unfiltered as usual.
 */
export type ScopePreset = { product: string; component?: string };

let preset: ScopePreset | null = null;

export function presetScope(next: ScopePreset): void {
  preset = next;
}

export function takePreset(): ScopePreset | null {
  const p = preset;
  preset = null;
  return p;
}
