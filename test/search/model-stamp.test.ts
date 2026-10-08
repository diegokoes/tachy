import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  backfillEmbeddings,
  saveKnowledgeEntry,
  searchKnowledge,
} from "@tachy/core/knowledge";
import { EMBEDDING_MODEL, staleVectors } from "@tachy/core/search";
import { LEGACY_EMBEDDING_MODEL } from "../../packages/core/src/search/model";
import { resetData, sql, tpdProductId } from "../database";

afterAll(() => sql.end());

let id = "";
beforeAll(async () => {
  await resetData();
  const row = await saveKnowledgeEntry({
    productId: await tpdProductId(),
    status: "approved",
    issueSummary: "Label printer stops in the middle of a batch",
    symptoms: ["half the labels print, then nothing"],
    rootCause: "The printer buffer overflows on long jobs",
    resolution: "Split the job into smaller batches",
  });
  id = row.id as string;
}, 120_000);

const stamp = async () =>
  (await sql`select embedding_model from knowledge_entries where id = ${id}`)[0]
    .embedding_model as string | null;
const byMeaning = async () =>
  (await searchKnowledge("the device halts partway through a print run")).find(
    (h) => h.id === id,
  );

describe("which model made a vector", () => {
  it("is written with the vector", async () => {
    expect(await stamp()).toBe(EMBEDDING_MODEL);
    expect(await staleVectors()).toEqual([]);
    expect(Number((await byMeaning())?.cos_sim)).toBeGreaterThan(0);
  });

  it("keeps another model's vector out of the vector leg, and counts it", async () => {
    await sql`update knowledge_entries set embedding_model = 'Other/model' where id = ${id}`;
    expect(await byMeaning()).toBeUndefined();
    // Its words still find it.
    const byWords = await searchKnowledge("printer buffer overflows");
    expect(byWords.map((h) => h.id)).toContain(id);
    expect(await staleVectors()).toEqual([
      { table: "knowledge_entries", rows: 1 },
    ]);
  });

  it("takes a row with no stamp for the model every older row was made by", async () => {
    await sql`update knowledge_entries set embedding_model = null where id = ${id}`;
    const stale = await staleVectors();
    expect(stale.length).toBe(
      EMBEDDING_MODEL === LEGACY_EMBEDDING_MODEL ? 0 : 1,
    );
  });

  it("is brought up to date by the backfill, without being asked for everything", async () => {
    await sql`update knowledge_entries set embedding_model = 'Other/model' where id = ${id}`;
    expect(await backfillEmbeddings()).toBe(1);
    expect(await stamp()).toBe(EMBEDDING_MODEL);
    expect(await backfillEmbeddings()).toBe(0);
    expect(Number((await byMeaning())?.cos_sim)).toBeGreaterThan(0);
  });
});
