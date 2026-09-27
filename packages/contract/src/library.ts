export interface CoverageCounts {
  entries: number;
  docs: number;
  articles: number;
  reads: number;
}

export interface CoverageNode extends CoverageCounts {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  /** The same four counts summed over this node and everything beneath it. */
  subtree: CoverageCounts;
  children: CoverageNode[];
}

export interface Coverage {
  nodes: CoverageNode[];
  /**
   * Items with no component at all. The honest measure of whether the component
   * tree describes the corpus: if most of it lands here, the tree does not.
   */
  unfiled: { entries: number; docs: number; articles: number };
}

export interface LibraryEngagement {
  days: number;
  reads: number;
  readers: number;
  /** Corrections people filed against entries in the window. */
  corrections: number;
  /** Reads per day, oldest first, gaps filled. */
  per_day: { day: string; reads: number }[];
  /**
   * Revisions saved per day, by who made them: a person in the app or over the
   * API, the agent (directly or over MCP), or an ingest.
   */
  edits_per_day: {
    day: string;
    people: number;
    agent: number;
    ingest: number;
  }[];
  /** Most-read items, entries and docs together. */
  top: {
    id: string;
    kind: "entry" | "doc";
    title: string;
    reads: number;
    readers: number;
  }[];
}
