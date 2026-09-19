export interface KnowledgeCensus {
  entries: number;
  entries_no_component: number;
  entries_no_product: number;
  by_status: Record<string, number>;
}
