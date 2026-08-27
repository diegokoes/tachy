import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_STATUSES,
  REFERENCE_STATUSES,
  CONFIDENCES,
  FEEDBACK_KINDS,
  RUN_MODES,
  RESOLUTION_CLARITIES,
  USER_ROLES,
  TEAM_ROLES,
  SOURCE_PROJECT_ROLES,
  WORK_ITEM_LINK_KINDS,
  REPO_INDEX_STATUSES,
  SCOPES,
} from "@tachy/core";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "db", "schema.sql"), "utf8");

function tableBlock(table: string): string {
  const m = schema.match(
    new RegExp(`create table ${table} \\(([\\s\\S]*?)\\n\\);`),
  );
  if (!m) throw new Error(`table ${table} not found in schema.sql`);
  return m[1];
}

function checkValues(table: string, col: string): string[] {
  const block = tableBlock(table);
  const re = new RegExp(
    `check \\((?:${col} is null or )?${col} in \\(([^)]*)\\)\\)`,
  );
  const m = block.match(re);
  if (!m) throw new Error(`no CHECK for ${table}.${col} in schema.sql`);
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

describe("core enums match db/schema.sql CHECK constraints", () => {
  it.each([
    ["knowledge_entries", "status", KNOWLEDGE_STATUSES],
    ["knowledge_entries", "confidence", CONFIDENCES],
    ["knowledge_entries", "resolution_clarity", RESOLUTION_CLARITIES],
    ["knowledge_feedback", "kind", FEEDBACK_KINDS],
    ["analysis_runs", "mode", RUN_MODES],
    ["reference_docs", "status", REFERENCE_STATUSES],
    ["users", "role", USER_ROLES],
    ["team_members", "role", TEAM_ROLES],
    ["source_projects", "role", SOURCE_PROJECT_ROLES],
    ["work_item_links", "kind", WORK_ITEM_LINK_KINDS],
    ["repos", "index_status", REPO_INDEX_STATUSES],
    ["credentials", "scope", SCOPES],
    ["preferences", "scope", SCOPES],
    ["artifacts", "scope", SCOPES],
  ] as const)("%s.%s", (table, col, values) => {
    expect(checkValues(table, col).sort()).toEqual([...values].sort());
  });

  it("source_projects ties its role to having a product", () => {
    expect(tableBlock("source_projects")).toContain(
      "check ((role = 'knowledge') = (product_id is not null))",
    );
  });

  it("repos carry their project and component", () => {
    const block = tableBlock("repos");
    expect(block).toContain("source_project_id");
    expect(block).toContain("component_id");
  });

  it("knowledge_entries carries the taxonomy/lifecycle columns", () => {
    const block = tableBlock("knowledge_entries");
    expect(block).toContain("component_id");
    expect(block).toContain("superseded_by");
    expect(block).toContain("knowledge_entries_no_self_supersede");
    expect(block).toContain("affected_version");
    expect(block).toContain("fixed_version");
  });

  it("knowledge_entries.cloud has no CHECK constraint", () => {
    expect(() => checkValues("knowledge_entries", "cloud")).toThrow(/no CHECK/);
  });

  it("reference_docs carries the versioning columns", () => {
    const block = tableBlock("reference_docs");
    expect(block).toContain("doc_version");
    expect(block).toContain("superseded_by");
    expect(block).toContain("reference_docs_no_self_supersede");
  });

  it("artifacts mirrors the scoped-table layout", () => {
    const block = tableBlock("artifacts");
    expect(block).toContain("check (scope in ('global','team','user'))");
    expect(block).toContain("check ((scope = 'team') = (team_id is not null))");
    expect(block).toContain("check ((scope = 'user') = (user_id is not null))");
    for (const idx of [
      "artifacts_global_idx on artifacts(slug)",
      "artifacts_team_idx   on artifacts(team_id, slug)",
      "artifacts_user_idx   on artifacts(user_id, slug)",
    ])
      expect(schema).toContain(idx);
  });

  it("artifacts carries the output spec column", () => {
    expect(tableBlock("artifacts")).toMatch(/^\s*spec\s+jsonb,$/m);
  });

  it("generated_outputs stores bytes, ownership and an expiry", () => {
    const block = tableBlock("generated_outputs");
    for (const col of [
      "user_id     uuid references users(id) on delete cascade",
      "artifact_id uuid references artifacts(id) on delete set null",
      "bytes       bytea not null",
      "byte_size   integer not null",
      "expires_at  timestamptz not null",
    ])
      expect(block).toContain(col);
    expect(schema).toContain(
      "generated_outputs_expiry_idx on generated_outputs(expires_at)",
    );
  });
});
