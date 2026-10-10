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
import {
  CODE_SEM_FLOOR,
  EMBEDDING_MODEL,
  embedQueryLiteral,
} from "@tachy/core/search";
import {
  CODE_GOLDEN,
  type CodeQuestionKind,
} from "../test/fixtures/code-golden";
import { NONSENSE } from "../test/fixtures/search-corpus";

const args = process.argv.slice(2);
const json = args.includes("--json");
const repoSlug = args.find((a) => !a.startsWith("--")) ?? "tachy";
const PAGE = 8;
/**
 * The questions are asked of the repository that holds them. The file they
 * are written in matches every one word for word, so it is never a hit, and
 * a page is asked for with room for the two chunks it could take.
 */
const QUESTIONS_FILE = "test/fixtures/code-golden.ts";
const FILE_CHUNKS_ON_PAGE = 2;

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

/**
 * Every file by its nearest chunk to the query, nearest first, with no floor:
 * the model's own opinion.
 */
async function vectorOnly(
  query: string,
): Promise<{ path: string; cosine: number }[]> {
  const qvec = await embedQueryLiteral(query);
  const rows = await sql`
    select distinct on (c.id) f.path, c.embedding <=> ${qvec}::vector as dist
    from code_blob_chunks c
    join repos r on r.id = c.repo_id
    join repo_line_files f on f.repo_id = c.repo_id and f.blob_sha = c.blob_sha
    where r.slug = ${repoSlug} and c.embedding is not null
      and f.path <> ${QUESTIONS_FILE}
    order by c.id, f.path
  `;
  const seen = new Set<string>();
  return [...rows]
    .sort((a, b) => (a.dist as number) - (b.dist as number))
    .filter((r) => !seen.has(r.path as string) && seen.add(r.path as string))
    .map((r) => ({ path: r.path as string, cosine: 1 - (r.dist as number) }));
}

/** Files the vector leg hands to the fusion at most. */
const VECTOR_CANDIDATES = 50;

interface Outcome {
  q: string;
  why: CodeQuestionKind;
  expect: string[];
  /** 1-based rank of the first expected file on the page; null when absent. */
  rank: number | null;
  vectorRank: number | null;
  /** Cosine of the nearest chunk of an expected file; null when none is indexed. */
  ownCosine: number | null;
  top: string[];
  stale: boolean;
}

const outcomes: Outcome[] = [];
for (const golden of CODE_GOLDEN) {
  const hits = await searchCode(golden.q, {
    repoSlug,
    limit: PAGE + FILE_CHUNKS_ON_PAGE,
  });
  const paths = hits
    .map((h) => (h as { path: string }).path)
    .filter((path) => path !== QUESTIONS_FILE)
    .slice(0, PAGE);
  const at = paths.findIndex((p) => golden.expect.includes(p));
  const vec = await vectorOnly(golden.q);
  const vecAt = vec
    .slice(0, VECTOR_CANDIDATES)
    .findIndex((v) => golden.expect.includes(v.path));
  const own = vec.find((v) => golden.expect.includes(v.path));
  outcomes.push({
    q: golden.q,
    why: golden.why,
    expect: golden.expect,
    rank: at < 0 ? null : at + 1,
    vectorRank: vecAt < 0 ? null : vecAt + 1,
    ownCosine: own?.cosine ?? null,
    top: paths.slice(0, 3),
    stale: !golden.expect.some((p) => indexed.has(p)),
  });
}

const summarise = (list: Outcome[]) => {
  const n = list.length;
  const within = (k: number) =>
    list.filter((o) => o.rank !== null && o.rank <= k).length;
  const vectorWithin = (k: number) =>
    list.filter((o) => o.vectorRank !== null && o.vectorRank <= k).length;
  return {
    n,
    top1: within(1),
    top3: within(3),
    page: within(PAGE),
    mrr: n ? list.reduce((s, o) => s + (o.rank ? 1 / o.rank : 0), 0) / n : 0,
    vectorTop1: vectorWithin(1),
    vectorTop3: vectorWithin(3),
    vectorPage: vectorWithin(PAGE),
  };
};

/**
 * What `codeSemFloor` is set from: the highest a meaningless query scores
 * against the code, and what a question's own file scores at the 25th
 * percentile. The floor belongs between the two.
 */
let nonsenseCeiling = 0;
for (const query of NONSENSE)
  nonsenseCeiling = Math.max(
    nonsenseCeiling,
    (await vectorOnly(query))[0]?.cosine ?? 0,
  );
const ownCosines = outcomes
  .flatMap((o) => (o.ownCosine === null ? [] : [o.ownCosine]))
  .sort((a, b) => a - b);
const floor = {
  nonsenseCeiling,
  ownFileP25: ownCosines[Math.floor(ownCosines.length / 4)] ?? 0,
  inUse: CODE_SEM_FLOOR,
};

const kinds = [...new Set(CODE_GOLDEN.map((g) => g.why))];
const summary = {
  model: EMBEDDING_MODEL,
  repo: repoSlug,
  ...corpus,
  floor,
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
      `  ${label.padEnd(11)} n=${String(s.n).padStart(2)}  top1 ${String(s.top1).padStart(2)}  top3 ${String(s.top3).padStart(2)}  page ${String(s.page).padStart(2)}  MRR ${s.mrr.toFixed(3)}  vector-only ${s.vectorTop1}/${s.vectorTop3}/${s.vectorPage}`,
    );
  console.log("\nexpected file found, by kind of question:");
  for (const kind of kinds) row(kind, summary.byKind[kind]);
  row("all", summary.overall);
  console.log(
    `\nvector leg: nonsense reaches ${floor.nonsenseCeiling.toFixed(3)}, a question's own file ${floor.ownFileP25.toFixed(3)} at the 25th percentile; codeSemFloor in use ${floor.inUse}`,
  );

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
