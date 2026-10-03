import type { SourceConnectionRow } from "@tachy/contract";

export type Connection = SourceConnectionRow & {
  /** Scope the caller's API token resolves from; null when none is set. */
  token_source?: "user" | "team" | "global" | "env" | null;
};
export type ProjectWiki = {
  identifier: string;
  name?: string;
  type?: string;
  root_path?: string;
  /** The one every wiki tool uses when none is named. Exactly one per project. */
  default?: boolean;
};
export type SourceProject = {
  id: string;
  source_connection_id: string;
  source_slug: string;
  source_type: string;
  external_key: string;
  name: string;
  product_id: string | null;
  product_slug: string | null;
  team_id: string;
  team_slug: string;
  customer_id: string | null;
  customer_slug: string | null;
  wikis: ProjectWiki[];
  config: Record<string, unknown>;
  notes: string | null;
};
export type AreaRule = {
  id: string;
  area_prefix: string;
  component_id: string;
  component_slug: string;
  component_name: string;
};
export type Discovered<K extends string, T> = {
  ok: boolean;
  error?: string;
} & {
  [P in K]?: T[];
};
