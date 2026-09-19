export interface CatalogCensus {
  teams: number;
  products: number;
  components: number;
  labels: number;
  patterns: number;
  customers: number;
  teams_no_product: number;
  products_no_component: number;
  components_root: number;
  components_no_description: number;
  labels_no_description: number;
  patterns_no_description: number;
  customers_no_domains: number;
  customer_units: number;
  components_by_product: { slug: string; name: string; n: number }[];
}
