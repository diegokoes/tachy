import { RUN_MODES } from "@tachy/core";
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
        meta: JSON.stringify({
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
      meta: JSON.stringify({ seeded: true }),
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
