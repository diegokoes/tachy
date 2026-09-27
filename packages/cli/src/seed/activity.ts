import { RUN_MODES, SOURCE_CALL_ORIGINS } from "@tachy/core";
import { insertRows, type Tx } from "./batches";
import {
  chance,
  intBetween,
  pastDate,
  pick,
  rngFor,
  uuidFor,
} from "./deterministic";
import { MEMBER_EMAIL, type SeededUser } from "./org";
import type { SeededWorkItem } from "./sources";
import type { Volumes } from "./scale";

const MODELS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
];

/** A spread of the agent's tools, reads heavier than writes as in real use. */
const TOOLS: [tool: string, writes: boolean, weight: number][] = [
  ["search_knowledge", false, 30],
  ["get_context", false, 20],
  ["search_code", false, 14],
  ["read_code_file", false, 10],
  ["get_customer_profile", false, 6],
  ["save_knowledge_entry", true, 4],
  ["post_private_note", true, 3],
  ["update_knowledge_entry", true, 2],
];

const DAY_MS = 86_400_000;
const daysAgo = (n: number) =>
  new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

export async function seedActivity(
  tx: Tx,
  v: Volumes,
  users: SeededUser[],
  workItems: SeededWorkItem[],
  artifacts: string[],
): Promise<void> {
  await insertRows(
    tx,
    "analysis_runs",
    [
      "id",
      "work_item_id",
      "user_id",
      "mode",
      "model",
      "input_tokens",
      "output_tokens",
      "meta",
      "created_at",
    ],
    Array.from({ length: v.analysisRuns }, (_, i) => {
      const rng = rngFor("run", i);
      const input = intBetween(rng, 800, 60_000);
      const output = intBetween(rng, 100, 4_000);
      return {
        id: uuidFor("analysis_run", i),
        work_item_id: workItems.length
          ? workItems[i % workItems.length].id
          : null,
        user_id: users[i % users.length].id,
        mode: pick(rng, RUN_MODES),
        model: pick(rng, MODELS),
        input_tokens: input,
        output_tokens: output,
        meta: tx.json({
          seeded: true,
          provider: "claude",
          estimated_cost_usd: Number(
            ((input / 1e6) * 5 + (output / 1e6) * 25).toFixed(4),
          ),
        }),
        created_at: pastDate(rng, 120),
      };
    }),
  );

  // getOutput filters on (user_id = $1 or user_id is null), so the k6 login
  // needs to own a slice of these or /api/outputs is empty under load.
  const member = users.find((u) => u.email === MEMBER_EMAIL) ?? users[0];
  const rows = Array.from({ length: v.generatedOutputs }, (_, i) => {
    const rng = rngFor("output", i);
    const bytes = Buffer.from(
      `seeded export ${i}\n${"col_a,col_b,col_c\n1,2,3\n".repeat(40)}`,
      "utf8",
    );
    return {
      id: uuidFor("generated_output", i),
      // Every third output belongs to the k6 user; the rest spread around.
      user_id: i % 3 === 0 ? member.id : users[i % users.length].id,
      artifact_id: artifacts.length ? artifacts[i % artifacts.length] : null,
      utility: "export_table",
      filename: `seeded-export-${i}.csv`,
      mime: "text/csv",
      bytes,
      // byte_size must agree with bytes: both come from the same Buffer.
      byte_size: bytes.length,
      meta: tx.json({ seeded: true }),
      created_at: pastDate(rng, 20),
      // Half already expired, so the hourly sweep in routes/outputs.ts has work.
      expires_at: chance(rng, 0.5)
        ? pastDate(rng, 5)
        : new Date(Date.now() + intBetween(rng, 1, 72) * 3_600_000),
    };
  });
  await insertRows(
    tx,
    "generated_outputs",
    [
      "id",
      "user_id",
      "artifact_id",
      "utility",
      "filename",
      "mime",
      "bytes",
      "byte_size",
      "meta",
      "created_at",
      "expires_at",
    ],
    rows,
  );
}

/**
 * Day buckets for the two activity tables, so the overviews have a fortnight
 * of traffic and a month of tool use to draw. Bucketed the way the real
 * counters write them: one row per connection, day and origin, and one per
 * tool, person and day.
 */
export async function seedTelemetry(
  tx: Tx,
  users: SeededUser[],
  connections: { id: string; slug: string }[],
): Promise<void> {
  await insertRows(
    tx,
    "source_calls",
    [
      "source_connection_id",
      "day",
      "origin",
      "calls",
      "rate_limited",
      "auth_failures",
    ],
    connections.flatMap((c, ci) =>
      Array.from({ length: 14 }, (_, day) =>
        SOURCE_CALL_ORIGINS.map((origin, oi) => {
          const rng = rngFor(`source_calls:${c.slug}:${origin}`, day);
          return {
            source_connection_id: c.id,
            day: daysAgo(day),
            origin,
            calls: intBetween(rng, origin === "app" ? 0 : 20, 220),
            rate_limited: chance(rng, 0.15) ? intBetween(rng, 1, 6) : 0,
            auth_failures: ci === 1 && oi === 0 && day === 2 ? 4 : 0,
          };
        }),
      ).flat(),
    ),
  );

  const people = users.slice(0, Math.min(users.length, 6));
  await insertRows(
    tx,
    "mcp_tool_calls",
    ["id", "tool", "writes", "user_id", "day", "calls", "failures", "misuse"],
    TOOLS.flatMap(([tool, writes, weight], ti) =>
      people.flatMap((u, ui) =>
        Array.from({ length: 30 }, (_, day) => {
          const rng = rngFor(`tool_calls:${tool}:${ui}`, day);
          const calls = intBetween(rng, 0, weight);
          return {
            id: uuidFor("mcp_tool_call", ti * 10_000 + ui * 100 + day),
            tool,
            writes,
            user_id: u.id,
            day: daysAgo(day),
            calls,
            failures: chance(rng, 0.05) ? 1 : 0,
            misuse: writes && chance(rng, 0.1) ? 1 : 0,
          };
        }).filter((r) => r.calls > 0),
      ),
    ),
  );
}
