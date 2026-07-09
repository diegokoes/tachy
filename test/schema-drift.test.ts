import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_STATUSES, REFERENCE_STATUSES, CONFIDENCES, FEEDBACK_KINDS, RUN_MODES,
  RESOLUTION_CLARITIES, LEARNING_VALUES, USER_ROLES, TEAM_ROLES,
} from "@tachy/core";





const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "db", "schema.sql"), "utf8");

function tableBlock(table: string): string {
  const m = schema.match(new RegExp(`create table ${table} \\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`table ${table} not found in schema.sql`);
  return m[1];
}



function checkValues(table: string, col: string): string[] {
  const block = tableBlock(table);
  const re = new RegExp(`check \\((?:${col} is null or )?${col} in \\(([^)]*)\\)\\)`);
  const m = block.match(re);
  if (!m) throw new Error(`no CHECK for ${table}.${col} in schema.sql`);
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

describe("core enums match db/schema.sql CHECK constraints", () => {
  it.each([
    ["knowledge_entries", "status", KNOWLEDGE_STATUSES],
    ["knowledge_entries", "confidence", CONFIDENCES],
    ["knowledge_entries", "resolution_clarity", RESOLUTION_CLARITIES],
    ["knowledge_entries", "learning_value", LEARNING_VALUES],
    ["knowledge_feedback", "kind", FEEDBACK_KINDS],
    ["analysis_runs", "mode", RUN_MODES],
    ["reference_docs", "status", REFERENCE_STATUSES],
    ["users", "role", USER_ROLES],
    ["team_members", "role", TEAM_ROLES],
  ] as const)("%s.%s", (table, col, values) => {
    expect(checkValues(table, col).sort()).toEqual([...values].sort());
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
});
