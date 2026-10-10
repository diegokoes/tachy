/**
 * Time a running embedder on the texts it meets in service.
 *
 *   TACHY_EMBED_URL=http://127.0.0.1:8790/internal/embed \
 *   TACHY_INTERNAL_SECRET=... TACHY_EMBED_MODEL=<the embedder's model> \
 *     npx tsx scripts/bench-embedder.ts [--heaviest]
 *
 * Texts go through the client the api and the workers use, so they carry the
 * model's prefixes and its batch limits. The model's name has to be the
 * embedder's. Memory is read outside, from the container's `memory.peak`.
 */
import { globSync, readFileSync } from "node:fs";
import {
  embedPassages,
  embedQuery,
  EMBEDDING_MODEL,
  EMBEDDING_SPEC,
} from "@tachy/core/search";
import { CODE_GOLDEN } from "../test/fixtures/code-golden";

if (!process.env.TACHY_EMBED_URL) {
  console.error("set TACHY_EMBED_URL to the embedder's /internal/embed");
  process.exit(2);
}

const TEXTS_PER_RUN = 64;
const QUERY_EVERY_MS = 2000;

const source = globSync("packages/*/src/**/*.ts")
  .sort()
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

/** `count` pieces of `chars` characters, spread over the repository's source. */
function pieces(chars: number, count = TEXTS_PER_RUN): string[] {
  const step = Math.floor((source.length - chars) / count);
  return Array.from({ length: count }, (_, i) =>
    source.slice(i * step, i * step + chars),
  );
}

const questions = CODE_GOLDEN.map((golden) => golden.q);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
const median = (values: number[]) => sorted(values)[values.length >> 1];
const highest = (values: number[]) => sorted(values).at(-1) ?? 0;

async function queryMs(question: string): Promise<number> {
  const started = performance.now();
  await embedQuery(question);
  return performance.now() - started;
}

async function passageRate(label: string, texts: string[]): Promise<void> {
  const started = performance.now();
  await embedPassages(texts);
  const seconds = (performance.now() - started) / 1000;
  console.log(
    `  ${label.padEnd(26)} ${String(texts.length).padStart(3)} texts  ${seconds.toFixed(1).padStart(6)} s  ${(texts.length / seconds).toFixed(2).padStart(6)} /s`,
  );
}

/** Latencies of a search sent every few seconds while `work` runs. */
async function queriesDuring(work: Promise<unknown>): Promise<number[]> {
  let running = true;
  void work.finally(() => (running = false));
  const latencies: number[] = [];
  for (let i = 0; running; i++) {
    await sleep(QUERY_EVERY_MS);
    if (running) latencies.push(await queryMs(questions[i % questions.length]));
  }
  await work;
  return latencies;
}

async function heaviestRound(round: number): Promise<void> {
  const chars = EMBEDDING_SPEC.maxChars;
  const cjk = "漢字仮名交じりの長い入力".repeat(chars).slice(0, chars);
  const base64 = Buffer.from(source.slice(0, chars))
    .toString("base64")
    .slice(0, chars);
  const started = performance.now();
  await Promise.all([
    embedPassages(pieces(chars, 40)),
    embedPassages(Array.from({ length: 24 }, () => cjk)),
    embedPassages(Array.from({ length: 24 }, () => base64)),
    ...pieces(chars, 32).map((text) => embedQuery(text)),
  ]);
  console.log(
    `  round ${round}: ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
}

console.log(`model ${EMBEDDING_MODEL}`);

if (process.argv.includes("--heaviest")) {
  console.log("the heaviest input the queue admits:");
  await heaviestRound(1);
  await heaviestRound(2);
  process.exit(0);
}

await queryMs(questions[0]);
const alone: number[] = [];
for (const question of questions) alone.push(await queryMs(question));
console.log(
  `one query alone: median ${median(alone).toFixed(0)} ms, highest ${highest(alone).toFixed(0)} ms`,
);

console.log("passages:");
await passageRate("350 characters", pieces(350));
await passageRate("1000 characters", pieces(1000));
const fullChunks = pieces(EMBEDDING_SPEC.codeChunkChars);
const started = performance.now();
const behind = await queriesDuring(embedPassages(fullChunks));
const seconds = (performance.now() - started) / 1000;
console.log(
  `  ${"full code chunks".padEnd(26)} ${String(fullChunks.length).padStart(3)} texts  ${seconds.toFixed(1).padStart(6)} s  ${(fullChunks.length / seconds).toFixed(2).padStart(6)} /s`,
);
console.log(
  `a query behind full chunks: median ${median(behind).toFixed(0)} ms, highest ${highest(behind).toFixed(0)} ms (${behind.length} sent)`,
);
