export interface KnowledgeCensus {
  entries: number;
  entries_no_component: number;
  entries_no_product: number;
  by_status: Record<string, number>;
}

/** One component's filed entries, and how many of them search can return. */
export interface ComponentKnowledge {
  component_id: string;
  entries: number;
  /** Approved or deprecated: the statuses searchKnowledge returns. */
  searchable: number;
}
