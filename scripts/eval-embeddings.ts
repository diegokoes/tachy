/**
 * Measure an embedding model against the golden corpus, and print the numbers
 * that SEM_FLOOR / SEM_CEIL in packages/core/src/search/relevance.ts are set from.
 *
 *   npx tsx scripts/eval-embeddings.ts
 *   TACHY_EMBED_MODEL=Xenova/gte-base npx tsx scripts/eval-embeddings.ts
 *
 * Reads nothing from the database — it embeds the fixture directly, so it runs
 * on a laptop with no stack up. The separation it reports is what makes a
 * nonsense query return zero rows; if it collapses, the floor is wrong.
 */
import {
  embedPassage,
  embedQuery,
  EMBEDDING_MODEL,
  EMBEDDING_SPEC,
  SEM_FLOOR,
  SEM_CEIL,
} from "@tachy/core";
import { GOLDEN, KNOWLEDGE, NONSENSE } from "../test/fixtures/search-corpus";

const cos = (a: number[], b: number[]) =>
  a.reduce((s, x, i) => s + x * b[i], 0);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const passageText = (e: (typeof KNOWLEDGE)[number]) =>
  [
    e.issueSummary,
    e.symptoms.join(" "),
    e.rootCause,
    e.resolution,
    e.signals.join(" "),
    (e.tags ?? []).join(" "),
  ].join(" ");

console.log(`model      ${EMBEDDING_MODEL}`);
console.log(
  `spec       dim=${EMBEDDING_SPEC.dim} pooling=${EMBEDDING_SPEC.pooling}` +
    ` queryPrefix=${JSON.stringify(EMBEDDING_SPEC.queryPrefix)}`,
);

const keys = KNOWLEDGE.map((e) => e.key);
const docs: number[][] = [];
for (const e of KNOWLEDGE) docs.push(await embedPassage(passageText(e)));

/** Highest a meaningless query ever scores — the floor must clear this. */
let noiseMax = 0;
let noiseAt = "";
for (const q of NONSENSE) {
  const qv = await embedQuery(q);
  docs.forEach((d, i) => {
    const c = cos(qv, d);
    if (c > noiseMax) {
      noiseMax = c;
      noiseAt = `${JSON.stringify(q)} -> ${keys[i]}`;
    }
  });
}

/**
 * Paraphrase and facet queries are the vector leg's job, so they set the floor.
 * Identifier queries are deliberately excluded: an error code has almost no
 * semantic content, and the trigram/tsvector legs are what retrieve it.
 */
let semanticMin = 1;
let semanticAt = "";
let semanticMax = 0;
let top1 = 0;
let mrrSum = 0;
const perQuery: string[] = [];

for (const g of GOLDEN) {
  const qv = await embedQuery(g.q);
  const scored = docs
    .map((d, i) => [keys[i], cos(qv, d)] as const)
    .sort((a, b) => b[1] - a[1]);
  const rank = scored.findIndex(([k]) => k === g.expect);
  if (rank === 0) top1++;
  if (rank >= 0) mrrSum += 1 / (rank + 1);
  const mine = scored[rank][1];
  if (g.why !== "identifier") {
    if (mine < semanticMin) {
      semanticMin = mine;
      semanticAt = `${JSON.stringify(g.q)} -> ${g.expect}`;
    }
    semanticMax = Math.max(semanticMax, mine);
  }
  perQuery.push(
    `  ${mine.toFixed(3)}  rank ${rank + 1}  [${g.why}] ${JSON.stringify(g.q)} -> ${g.expect}`,
  );
}

console.log("\nper golden query (vector leg only):");
for (const line of perQuery) console.log(line);

const gap = semanticMin - noiseMax;
console.log("\nvector-leg separation");
console.log(`  nonsense ceiling   ${noiseMax.toFixed(3)}   ${noiseAt}`);
console.log(`  semantic floor     ${semanticMin.toFixed(3)}   ${semanticAt}`);
console.log(`  semantic ceiling   ${semanticMax.toFixed(3)}`);
console.log(
  `  usable gap         ${gap.toFixed(3)}${gap <= 0 ? "   *** NO SEPARATION ***" : ""}`,
);

console.log("\nsuggested constants (midpoint of the gap, ceiling of observed)");
console.log(`  SEM_FLOOR = ${((noiseMax + semanticMin) / 2).toFixed(2)}`);
console.log(`  SEM_CEIL  = ${Math.ceil(semanticMax * 20) / 20}`);
console.log(`  in use:     SEM_FLOOR = ${SEM_FLOOR}   SEM_CEIL = ${SEM_CEIL}`);

console.log("\nvector-only ranking over the golden set");
console.log(
  `  top-1  ${top1}/${GOLDEN.length}  (${pct(top1 / GOLDEN.length)})`,
);
console.log(`  MRR    ${(mrrSum / GOLDEN.length).toFixed(3)}`);

const ok = SEM_FLOOR > noiseMax && SEM_FLOOR < semanticMin;
console.log(
  `\n${ok ? "OK" : "MISCALIBRATED"}: SEM_FLOOR ${SEM_FLOOR} ${ok ? "sits inside" : "is outside"} the measured gap.`,
);
if (!ok) process.exitCode = 1;
