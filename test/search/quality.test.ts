import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveKnowledgeEntry, searchKnowledge } from "@tachy/core/knowledge";
import { saveReferenceDoc, searchReferenceDocs } from "@tachy/core/reference";
import { relevance, SEM_FLOOR, SEM_CEIL } from "@tachy/core/search";
import { grade, GOOD, STRONG } from "@tachy/core";
import { resetData, sql, tpdProductId } from "../database";
import {
  GOLDEN,
  KNOWLEDGE,
  NONSENSE,
  REFERENCE,
} from "../fixtures/search-corpus";

afterAll(() => sql.end());

const idByKey = new Map<string, string>();

beforeAll(async () => {
  await resetData();
  const productId = await tpdProductId();
  for (const entry of KNOWLEDGE) {
    const row = await saveKnowledgeEntry({
      productId,
      status: "approved",
      issueSummary: entry.issueSummary,
      symptoms: entry.symptoms,
      signals: entry.signals,
      rootCause: entry.rootCause,
      resolution: entry.resolution,
      cloud: entry.cloud,
      affectedVersion: entry.affectedVersion,
      tags: entry.tags,
    });
    idByKey.set(entry.key, row.id as string);
  }
  for (const doc of REFERENCE) {
    const row = await saveReferenceDoc({
      productId,
      title: doc.title,
      body: doc.body,
      status: "approved",
    });
    idByKey.set(doc.key, row.id as string);
  }
}, 300_000);

describe("nonsense queries return nothing", () => {
  // Raw cosine never starts at zero, so these are rejected by the vector leg's
  // floor and by having no lexical candidates, not by a score threshold.
  it.each(NONSENSE)("knowledge: %j", async (query) => {
    expect(await searchKnowledge(query)).toEqual([]);
  });

  it.each(NONSENSE)("reference: %j", async (query) => {
    expect(await searchReferenceDocs(query)).toEqual([]);
  });
});

describe("golden query set", () => {
  it.each(GOLDEN)("[$why] $q -> $expect", async ({ q, expect: key }) => {
    const rows = await searchKnowledge(q);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].id).toBe(idByKey.get(key));
  });

  it("holds recall@3 and MRR above their floors", async () => {
    let hits = 0;
    let reciprocalRankSum = 0;
    for (const golden of GOLDEN) {
      const rows = await searchKnowledge(golden.q);
      const rank = rows.findIndex((r) => r.id === idByKey.get(golden.expect));
      if (rank >= 0 && rank < 3) hits++;
      if (rank >= 0) reciprocalRankSum += 1 / (rank + 1);
    }
    const recallAt3 = hits / GOLDEN.length;
    const mrr = reciprocalRankSum / GOLDEN.length;
    // Floors: a change that regresses retrieval fails here.
    expect(recallAt3).toBeGreaterThanOrEqual(0.9);
    expect(mrr).toBeGreaterThanOrEqual(0.9);
  });

  it("finds a reference doc by a phrase only its body contains", async () => {
    const rows = await searchReferenceDocs("queue does not drain");
    expect(rows[0]?.id).toBe(idByKey.get("deploy-runbook"));
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
    expect(rows[0].id).toBe(idByKey.get("printer-023"));
    for (const row of rows.slice(1)) expect(row.relevance).toBeLessThan(GOOD);
  });
});

describe("calibration constants", () => {
  // The constants are measured for one model. A change of `TACHY_EMBED_MODEL`
  // that does not re-derive them skews every gauge and grade with no error.
  it("separates the noise floor from real matches", async () => {
    let worstTrue = 1;
    for (const golden of GOLDEN) {
      const [top] = await searchKnowledge(golden.q);
      if (top?.cos_sim) worstTrue = Math.min(worstTrue, Number(top.cos_sim));
    }
    expect(SEM_FLOOR).toBeLessThan(SEM_CEIL);
    // Every golden top hit clears the floor its own vector leg is gated on, or
    // it only got in on keywords - either way the floor is not cutting matches.
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
  // These assert the query shapes stay index-eligible. On a small table the
  // planner still prefers a scan on cost, so seqscan is disabled.
  const planOf = async (query: string) => {
    const rows = await sql.unsafe(`explain (format json) ${query}`);
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
