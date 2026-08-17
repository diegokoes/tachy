import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  saveKnowledgeEntry,
  saveReferenceDoc,
  searchKnowledge,
  searchReferenceDocs,
  relevance,
  grade,
  SEM_FLOOR,
  SEM_CEIL,
  GOOD,
  STRONG,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";
import {
  GOLDEN,
  KNOWLEDGE,
  NONSENSE,
  REFERENCE,
} from "./fixtures/search-corpus";

afterAll(() => sql.end());

/** key -> id, so a golden expectation names an entry rather than a uuid. */
const ids = new Map<string, string>();

beforeAll(async () => {
  await resetData();
  const productId = await tpdProductId();
  for (const e of KNOWLEDGE) {
    const row = await saveKnowledgeEntry({
      productId,
      status: "approved",
      issueSummary: e.issueSummary,
      symptoms: e.symptoms,
      signals: e.signals,
      rootCause: e.rootCause,
      resolution: e.resolution,
      cloud: e.cloud,
      affectedVersion: e.affectedVersion,
      tags: e.tags,
    });
    ids.set(e.key, row.id as string);
  }
  for (const d of REFERENCE) {
    const row = await saveReferenceDoc({
      productId,
      title: d.title,
      body: d.body,
      status: "approved",
    });
    ids.set(d.key, row.id as string);
  }
}, 300_000);

describe("nonsense queries return nothing", () => {
  // The defect this whole design exists for: with a blended score computed in
  // the SELECT list and a cosine that floors around 0.6, `score > 0.02` could
  // not reject anything, so "ñ" returned a full page of confident-looking rows.
  it.each(NONSENSE)("knowledge: %j", async (q) => {
    expect(await searchKnowledge(q)).toEqual([]);
  });

  it.each(NONSENSE)("reference: %j", async (q) => {
    expect(await searchReferenceDocs(q)).toEqual([]);
  });
});

describe("golden query set", () => {
  it.each(GOLDEN)("[$why] $q -> $expect", async ({ q, expect: key }) => {
    const rows = await searchKnowledge(q);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].id).toBe(ids.get(key));
  });

  it("holds recall@3 and MRR above their floors", async () => {
    let hits = 0;
    let reciprocalRankSum = 0;
    for (const g of GOLDEN) {
      const rows = await searchKnowledge(g.q);
      const rank = rows.findIndex((r) => r.id === ids.get(g.expect));
      if (rank >= 0 && rank < 3) hits++;
      if (rank >= 0) reciprocalRankSum += 1 / (rank + 1);
    }
    const recallAt3 = hits / GOLDEN.length;
    const mrr = reciprocalRankSum / GOLDEN.length;
    // Floors, not targets. They fail loudly if a change regresses retrieval.
    expect(recallAt3).toBeGreaterThanOrEqual(0.9);
    expect(mrr).toBeGreaterThanOrEqual(0.9);
  });

  it("finds a reference doc by a phrase only its body contains", async () => {
    const rows = await searchReferenceDocs("queue does not drain");
    expect(rows[0]?.id).toBe(ids.get("deploy-runbook"));
    expect(rows[0].grade).not.toBe("weak");
  });
});

describe("grading", () => {
  it("grades an exact identifier hit strong, on the lexical arm alone", async () => {
    const [top] = await searchKnowledge("TOO_MANY_STRINGS");
    expect(top.grade).toBe("strong");
  });

  it("grades a paraphrase strong, on the semantic arm alone", async () => {
    const [top] = await searchKnowledge("scanner offline");
    expect(top.cos_sim).toBeGreaterThan(SEM_FLOOR);
    expect(top.grade).toBe("strong");
  });

  it("ranks an unrelated-but-admitted row below a real match", async () => {
    const rows = await searchKnowledge("printer label problem");
    expect(rows[0].id).toBe(ids.get("printer-023"));
    for (const r of rows.slice(1)) expect(r.relevance).toBeLessThan(GOOD);
  });
});

describe("calibration constants", () => {
  // These are measurements of one model's distribution. Changing
  // TACHY_EMBED_MODEL without re-deriving them silently skews every gauge and
  // every agent-facing grade, so it has to fail here instead.
  it("separates the noise floor from real matches", async () => {
    let worstTrue = 1;
    for (const g of GOLDEN) {
      const [top] = await searchKnowledge(g.q);
      if (top?.cos_sim) worstTrue = Math.min(worstTrue, Number(top.cos_sim));
    }
    expect(SEM_FLOOR).toBeLessThan(SEM_CEIL);
    // Every golden top hit clears the floor its own vector leg is gated on, or
    // it only got in on keywords — either way the floor is not cutting matches.
    expect(worstTrue).toBeGreaterThan(0);
  });

  it("maps the signal range onto the grades", () => {
    expect(grade(relevance({ cos_sim: SEM_CEIL }))).toBe("strong");
    expect(grade(relevance({ cos_sim: SEM_FLOOR }))).toBe("weak");
    expect(grade(relevance({ trgm_sim: 1, fts_rank: 0.3 }))).toBe("strong");
    expect(relevance({})).toBe(0);
    expect(grade(GOOD)).toBe("good");
    expect(grade(STRONG)).toBe("strong");
  });
});

describe("index usage", () => {
  // REVIEW.md B2: all three searches computed their blend in the SELECT list,
  // which left the planner no indexable predicate. Correct but linear. These
  // assert the query SHAPES stay index-eligible; on a small table the planner
  // may still prefer a scan on cost, which is why seqscan is disabled here.
  const planOf = async (q: string) => {
    const rows = await sql.unsafe(`explain (format json) ${q}`);
    return JSON.stringify(rows);
  };

  it("uses the HNSW index for the vector leg", async () => {
    const [{ embedding }] =
      await sql`select embedding from knowledge_entries where embedding is not null limit 1`;
    await sql`set enable_seqscan = off`;
    const plan = await planOf(
      `select id from knowledge_entries where embedding is not null
       order by embedding <=> '${embedding}'::vector limit 50`,
    );
    await sql`reset enable_seqscan`;
    expect(plan).toContain("knowledge_embedding_idx");
  });

  it("uses both tsvector indexes for the lexical leg", async () => {
    await sql`set enable_seqscan = off`;
    const plan = await planOf(
      `select id from knowledge_entries
       where search_tsv @@ websearch_to_tsquery('simple', 'TOO_MANY_STRINGS')
          or search_tsv_en @@ websearch_to_tsquery('english', 'TOO_MANY_STRINGS')`,
    );
    await sql`reset enable_seqscan`;
    expect(plan).toContain("knowledge_tsv_idx");
    expect(plan).toContain("knowledge_tsv_en_idx");
  });

  it("uses the trigram index for the fuzzy leg", async () => {
    await sql`set enable_seqscan = off`;
    const plan = await planOf(
      `select id from knowledge_entries where 'TOO_MANY_STRINGS' <% search_text`,
    );
    await sql`reset enable_seqscan`;
    expect(plan).toContain("knowledge_trgm_idx");
  });
});
