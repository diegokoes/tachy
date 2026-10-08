/**
 * Measure code search against the golden questions, on a database that has
 * the repository indexed.
 *
 *   DATABASE_URL=... npx tsx scripts/eval-code-search.ts [repo-slug]
 *   ... npx tsx scripts/eval-code-search.ts tachy --json > before.json
 *
 * Each question goes through the real searchCode. The report is where the
 * expected file ranks, by kind of question, and for the misses what the vector
 * leg alone ranked first, so a change to chunking, to a leg or to the model
 * can be judged by what it moved.
 */
import { searchCode } from "@tachy/core/code";
import { sql } from "@tachy/core/infra";
import { EMBEDDING_MODEL, embedQueryLiteral } from "@tachy/core/search";
import {
  CODE_GOLDEN,
  type CodeQuestionKind,
} from "../test/fixtures/code-golden";

const args = process.argv.slice(2);
const json = args.includes("--json");
const repoSlug = args.find((a) => !a.startsWith("--")) ?? "tachy";
const PAGE = 8;

const [corpus] = await sql`
  select count(distinct f.path)::int as files,
         (select count(*)::int from code_blob_chunks c where c.repo_id = r.id) as chunks,
         (select count(*)::int from code_blob_chunks c
          where c.repo_id = r.id and c.embedding is null) as unembedded
  from repos r join repo_line_files f on f.repo_id = r.id
  where r.slug = ${repoSlug}
  group by r.id
`;
if (!corpus) {
  console.error(`no indexed repo '${repoSlug}' in this database`);
  process.exit(2);
}
const indexed = new Set(
  (
    await sql`
      select distinct f.path from repo_line_files f
      join repos r on r.id = f.repo_id where r.slug = ${repoSlug}
    `
  ).map((r) => r.path as string),
);

/** What the vector leg alone puts first, with no floor: the model's own opinion. */
async function vectorOnly(query: string): Promise<string[]> {
  const qvec = await embedQueryLiteral(query);
  const rows = await sql`
    select distinct on (c.id) f.path, c.embedding <=> ${qvec}::vector as dist
    from code_blob_chunks c
    join repos r on r.id = c.repo_id
    join repo_line_files f on f.repo_id = c.repo_id and f.blob_sha = c.blob_sha
    where r.slug = ${repoSlug} and c.embedding is not null
    order by c.id, f.path
  `;
  const seen = new Set<string>();
  return [...rows]
    .sort((a, b) => (a.dist as number) - (b.dist as number))
    .map((r) => r.path as string)
    .filter((p) => !seen.has(p) && seen.add(p))
    .slice(0, 50);
}

interface Outcome {
  q: string;
  why: CodeQuestionKind;
  expect: string[];
  /** 1-based rank of the first expected file on the page; null when absent. */
  rank: number | null;
  vectorRank: number | null;
  top: string[];
  stale: boolean;
}

const outcomes: Outcome[] = [];
for (const golden of CODE_GOLDEN) {
  const hits = await searchCode(golden.q, { repoSlug, limit: PAGE });
  const paths = hits.map((h) => (h as { path: string }).path);
  const at = paths.findIndex((p) => golden.expect.includes(p));
  const vec = await vectorOnly(golden.q);
  const vecAt = vec.findIndex((p) => golden.expect.includes(p));
  outcomes.push({
    q: golden.q,
    why: golden.why,
    expect: golden.expect,
    rank: at < 0 ? null : at + 1,
    vectorRank: vecAt < 0 ? null : vecAt + 1,
    top: paths.slice(0, 3),
    stale: !golden.expect.some((p) => indexed.has(p)),
  });
}

const summarise = (list: Outcome[]) => {
  const n = list.length;
  const within = (k: number) =>
    list.filter((o) => o.rank !== null && o.rank <= k).length;
  return {
    n,
    top1: within(1),
    top3: within(3),
    page: within(PAGE),
    mrr: n ? list.reduce((s, o) => s + (o.rank ? 1 / o.rank : 0), 0) / n : 0,
    vectorTop3: list.filter((o) => o.vectorRank !== null && o.vectorRank <= 3)
      .length,
  };
};

const kinds = [...new Set(CODE_GOLDEN.map((g) => g.why))];
const summary = {
  model: EMBEDDING_MODEL,
  repo: repoSlug,
  ...corpus,
  overall: summarise(outcomes),
  byKind: Object.fromEntries(
    kinds.map((k) => [k, summarise(outcomes.filter((o) => o.why === k))]),
  ),
};

if (json) {
  console.log(JSON.stringify({ summary, outcomes }, null, 2));
} else {
  console.log(
    `model ${summary.model}   repo ${repoSlug}: ${corpus.files} files, ${corpus.chunks} chunks` +
      (corpus.unembedded ? `, ${corpus.unembedded} without a vector` : ""),
  );
  const row = (label: string, s: ReturnType<typeof summarise>) =>
    console.log(
      `  ${label.padEnd(11)} n=${String(s.n).padStart(2)}  top1 ${String(s.top1).padStart(2)}  top3 ${String(s.top3).padStart(2)}  page ${String(s.page).padStart(2)}  MRR ${s.mrr.toFixed(3)}  vector-only top3 ${String(s.vectorTop3).padStart(2)}`,
    );
  console.log("\nexpected file found, by kind of question:");
  for (const kind of kinds) row(kind, summary.byKind[kind]);
  row("all", summary.overall);

  const misses = outcomes.filter((o) => o.rank !== 1);
  if (misses.length) console.log("\nnot first:");
  for (const miss of misses)
    console.log(
      `  [${miss.why}] ${JSON.stringify(miss.q)}\n` +
        `      rank ${miss.rank ?? "-"}  vector-only rank ${miss.vectorRank ?? ">50"}` +
        `${miss.stale ? "  (expected file is not in the index)" : ""}\n` +
        `      got ${miss.top[0] ?? "nothing"}`,
    );
}
await sql.end();
