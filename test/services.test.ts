import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { upsertUser, recordRun } from "@tachy/core";
import { resetData, sql } from "./helpers";

afterAll(() => sql.end());

describe("users", () => {
  beforeEach(resetData);

  it("upserts by email and updates display name", async () => {
    const id1 = await upsertUser("eng@example.com");
    const id2 = await upsertUser("eng@example.com", "Engineer");
    expect(id1).toBe(id2);
    const [row] = await sql`select display_name from users where id = ${id1}`;
    expect(row.display_name).toBe("Engineer");
  });
});

describe("analysis runs", () => {
  beforeEach(resetData);

  it("records a run with token accounting", async () => {
    const run = await recordRun({
      mode: "consult",
      model: "claude-sonnet-4-6",
      inputTokens: 1200,
      outputTokens: 300,
    });
    const [row] =
      await sql`select mode, input_tokens, output_tokens from analysis_runs where id = ${run.id}`;
    expect(row.mode).toBe("consult");
    expect(row.input_tokens).toBe(1200);
    expect(row.output_tokens).toBe(300);
  });
});
