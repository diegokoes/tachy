import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  insertKnowledgeEntry,
  nearDuplicateEntries,
  prepareKnowledgeEntry,
  saveKnowledgeEntry,
} from "@tachy/core/knowledge";
import { addProduct, addTeam } from "@tachy/core/catalog";
import { resetData, sql, tpdProductId } from "../database";

afterAll(() => sql.end());

const SCANNER = {
  issueSummary: "Barcode scanner stays offline after the firmware update",
  symptoms: ["scanner offline", "no pairing dialog"],
  rootCause: "The update reset the Bluetooth pairing table.",
  resolution: "Pair the scanner again and restart the ingest service.",
};

const EXPORT = {
  issueSummary: "Monthly invoice export produces an empty PDF",
  rootCause: "A stale render in the export cache.",
  resolution: "Clear the export cache and run the export again.",
};

/**
 * The same text embeds to the same vector whatever the model, so a re-save of
 * an entry is a near-copy at any floor under 1.
 */
const COPY_FLOOR = 0.99;

describe("nearDuplicateEntries", () => {
  beforeEach(resetData);

  it("offers the stored entry a new one repeats, and not an unrelated one", async () => {
    const productId = await tpdProductId();
    const original = await saveKnowledgeEntry({
      productId,
      status: "approved",
      ...SCANNER,
    });
    await saveKnowledgeEntry({ productId, status: "approved", ...EXPORT });

    const copy = await prepareKnowledgeEntry({ productId, ...SCANNER });
    const [match, ...rest] = await nearDuplicateEntries(copy, COPY_FLOOR);
    expect(match).toMatchObject({
      id: original.id,
      issue_summary: SCANNER.issueSummary,
      status: "approved",
      superseded_by: null,
    });
    expect(match.similarity).toBeGreaterThanOrEqual(COPY_FLOOR);
    expect(rest).toEqual([]);

    const unrelated = await prepareKnowledgeEntry({
      productId,
      issueSummary: "Ink cartridge rattles in transit",
      resolution: "Pack the cartridge with more padding.",
    });
    expect(await nearDuplicateEntries(unrelated, COPY_FLOOR)).toEqual([]);
  });

  it("names the entry that replaced a deprecated original", async () => {
    const productId = await tpdProductId();
    const current = await saveKnowledgeEntry({
      productId,
      status: "approved",
      ...EXPORT,
    });
    const old = await saveKnowledgeEntry({
      productId,
      status: "approved",
      ...SCANNER,
    });
    await sql`update knowledge_entries set status = 'deprecated', superseded_by = ${current.id}
              where id = ${old.id}`;

    const [match] = await nearDuplicateEntries(
      await prepareKnowledgeEntry({ productId, ...SCANNER }),
      COPY_FLOOR,
    );
    expect(match).toMatchObject({
      id: old.id,
      status: "deprecated",
      superseded_by: current.id,
    });
  });

  it("leaves out rejected and archived entries", async () => {
    const productId = await tpdProductId();
    const original = await saveKnowledgeEntry({
      productId,
      status: "approved",
      ...SCANNER,
    });
    const copy = await prepareKnowledgeEntry({ productId, ...SCANNER });
    for (const status of ["rejected", "archived"]) {
      await sql`update knowledge_entries set status = ${status} where id = ${original.id}`;
      expect(await nearDuplicateEntries(copy, COPY_FLOOR)).toEqual([]);
    }
  });

  it("looks in the entry's own product and in none, never in another", async () => {
    await addTeam("dup-team", "Dup Team");
    const other = await addProduct("dup-team", "dup-other", "Other");
    const productId = await tpdProductId();
    await saveKnowledgeEntry({
      productId: other.id as string,
      status: "approved",
      ...SCANNER,
    });
    const copy = await prepareKnowledgeEntry({ productId, ...SCANNER });
    expect(await nearDuplicateEntries(copy, COPY_FLOOR)).toEqual([]);

    const unscoped = await saveKnowledgeEntry({
      status: "approved",
      ...SCANNER,
    });
    expect(
      (await nearDuplicateEntries(copy, COPY_FLOOR)).map((d) => d.id),
    ).toEqual([unscoped.id]);
  });

  it("finds none for an entry with no text to embed", async () => {
    const empty = await prepareKnowledgeEntry({});
    expect(empty.embedding).toBeNull();
    expect(await nearDuplicateEntries(empty, 0)).toEqual([]);
  });
});

describe("insertKnowledgeEntry", () => {
  beforeEach(resetData);

  it("stores what prepareKnowledgeEntry resolved, as saveKnowledgeEntry does", async () => {
    const productId = await tpdProductId();
    const prepared = await prepareKnowledgeEntry({
      productId,
      status: "draft",
      ...SCANNER,
    });
    const saved = await insertKnowledgeEntry(prepared);
    const [row] = await sql`
      select product_id, status, issue_summary, embedding is not null as embedded
      from knowledge_entries where id = ${saved.id}
    `;
    expect(row).toMatchObject({
      product_id: productId,
      status: "draft",
      issue_summary: SCANNER.issueSummary,
      embedded: true,
    });
  });
});
