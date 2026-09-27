import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addComponent,
  addWikiCategory,
  dismissWikiGap,
  listWikiGaps,
  saveKnowledgeEntry,
  saveReferenceDoc,
  setArticleCategories,
  setComposedFrom,
  sweepWikiGaps,
  updateKnowledgeEntry,
  updateReferenceDoc,
  sql as coreSql,
} from "@tachy/core";
import type { WikiGapRow } from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

afterAll(() => sql.end());

/** printing › spooler, and coding beside them. */
async function tree() {
  const productId = await tpdProductId();
  await addComponent({ productId, slug: "printing", name: "Printing" });
  await addComponent({
    productId,
    slug: "spooler",
    name: "Spooler",
    parentSlug: "printing",
  });
  await addComponent({ productId, slug: "coding", name: "Coding" });
  return productId;
}

async function lessons(productId: string, component: string, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++)
    ids.push(
      (
        await saveKnowledgeEntry({
          productId,
          component,
          issueSummary: `${component} lesson ${i}`,
        })
      ).id as string,
    );
  return ids;
}

const article = (
  productId: string | null,
  slug: string,
  over: Record<string, unknown> = {},
) =>
  saveReferenceDoc({
    productId,
    kind: "wiki",
    slug,
    title: slug,
    body: "body",
    ...over,
  });

async function gaps(productId: string | null) {
  await sweepWikiGaps({ productId });
  return listWikiGaps(productId);
}

const of = (rows: WikiGapRow[], kind: string) =>
  rows.filter((g) => g.kind === kind);

describe("unwritten parts of the product", () => {
  beforeEach(resetData);

  it("flags a component with enough lessons and no article", async () => {
    const productId = await tree();
    await lessons(productId, "coding", 3);

    const [g] = of(await gaps(productId), "unwritten");
    expect(g.subject).toBe("Coding");
    expect(g.score).toBe(3);
    expect(g.evidence).toMatchObject({
      component: "coding",
      entries: 3,
      docs: 0,
    });
    expect((g.evidence as any).items).toHaveLength(3);
  });

  it("stays quiet below the threshold", async () => {
    const productId = await tree();
    await lessons(productId, "coding", 2);
    expect(of(await gaps(productId), "unwritten")).toEqual([]);
  });

  /** Two lessons on a child and one on its parent are one topic, the parent's. */
  it("rolls a child's leftovers up into its parent", async () => {
    const productId = await tree();
    await lessons(productId, "spooler", 2);
    await lessons(productId, "printing", 1);

    const found = of(await gaps(productId), "unwritten");
    expect(found.map((g) => g.subject)).toEqual(["Printing"]);
    expect(found[0].score).toBe(3);
  });

  /** A child with enough of its own is flagged, and its parent is not asked
      for the same lessons twice. */
  it("raises the gap at the most specific part that has enough", async () => {
    const productId = await tree();
    await lessons(productId, "spooler", 3);
    await lessons(productId, "printing", 2);

    const found = of(await gaps(productId), "unwritten");
    expect(found.map((g) => g.subject)).toEqual(["Spooler"]);
  });

  it("counts imported docs alongside lessons", async () => {
    const productId = await tree();
    await lessons(productId, "coding", 2);
    await saveReferenceDoc({
      productId,
      component: "coding",
      title: "Coding runbook",
      body: "steps",
    });
    const [g] = of(await gaps(productId), "unwritten");
    expect(g.evidence).toMatchObject({ entries: 2, docs: 1 });
  });

  it("ignores lessons still in draft", async () => {
    const productId = await tree();
    await lessons(productId, "coding", 2);
    await saveKnowledgeEntry({
      productId,
      component: "coding",
      issueSummary: "not yet",
      status: "draft",
    });
    expect(of(await gaps(productId), "unwritten")).toEqual([]);
  });

  it("is resolved by an article about the component, or its parent", async () => {
    const productId = await tree();
    await lessons(productId, "spooler", 3);
    expect(of(await gaps(productId), "unwritten")).toHaveLength(1);

    await article(productId, "printing-guide", { component: "printing" });
    expect(of(await gaps(productId), "unwritten")).toEqual([]);
  });

  it("counts a lesson any article cites as covered", async () => {
    const productId = await tree();
    const [first, second] = await lessons(productId, "coding", 3);
    await article(productId, "notes", {
      body: `See [[entry:${first}|the first one]].`,
    });
    const page = await article(productId, "summary");
    await setComposedFrom(coreSql, page.id, [{ entryId: second }]);

    expect(of(await gaps(productId), "unwritten")).toEqual([]);
  });
});

describe("articles the lessons have moved past", () => {
  beforeEach(resetData);

  it("flags new uncited lessons under an article's component", async () => {
    const productId = await tree();
    await lessons(productId, "printing", 2);
    await article(productId, "printing-guide", { component: "printing" });
    await lessons(productId, "spooler", 3);

    const found = await gaps(productId);
    expect(of(found, "unwritten")).toEqual([]);
    const [g] = of(found, "outgrown");
    expect(g.subject).toBe("printing-guide");
    expect(g.score).toBe(3);
    expect(g.evidence).toMatchObject({
      slug: "printing-guide",
      component: "printing",
    });
  });

  it("does not count what was already there when it was written", async () => {
    const productId = await tree();
    await lessons(productId, "printing", 5);
    await article(productId, "printing-guide", { component: "printing" });
    expect(of(await gaps(productId), "outgrown")).toEqual([]);
  });
});

describe("the wiki's own housekeeping", () => {
  beforeEach(resetData);

  it("flags an article whose sources changed since it was written", async () => {
    const productId = await tree();
    const [entry] = await lessons(productId, "coding", 1);
    const page = await article(productId, "coding-guide");
    await setComposedFrom(coreSql, page.id, [{ entryId: entry }]);
    expect(of(await gaps(productId), "stale")).toEqual([]);

    await updateKnowledgeEntry(entry, { resolution: "a better fix" });
    const [g] = of(await gaps(productId), "stale");
    expect(g.subject).toBe("coding-guide");
    expect(g.score).toBe(1);
  });

  it("lists pages that are linked to and never written, by how many ask", async () => {
    const productId = await tree();
    await article(productId, "a", {
      body: "[[not-yet]] and [[entry:00000000-0000-4000-8000-000000000000]]",
    });
    await article(productId, "b", { body: "also [[not-yet]]" });

    const wanted = of(await gaps(productId), "wanted");
    expect(wanted.map((g) => [g.key, g.score])).toEqual([["not-yet", 2]]);

    await article(productId, "not-yet");
    expect(of(await gaps(productId), "wanted")).toEqual([]);
  });

  it("flags drafts, and articles filed nowhere except the main page", async () => {
    const productId = await tree();
    await article(productId, "main");
    const loose = await article(productId, "loose");
    await article(productId, "pending", { status: "draft" });
    await addWikiCategory({ productId, slug: "about", name: "About" });
    const filed = await article(productId, "filed");
    await setArticleCategories(productId, filed.id, ["about"]);

    const found = await gaps(productId);
    expect(of(found, "draft").map((g) => g.subject)).toEqual(["pending"]);
    expect(
      of(found, "uncategorised")
        .map((g) => g.subject)
        .sort(),
    ).toEqual(["loose", "pending"]);

    await setArticleCategories(productId, loose.id, ["about"]);
    expect(
      of(await gaps(productId), "uncategorised").map((g) => g.subject),
    ).toEqual(["pending"]);
  });

  it("gives the org-wide wiki only the kinds it can have", async () => {
    await article(null, "loose", { body: "[[missing]]", status: "draft" });
    const kinds = new Set((await gaps(null)).map((g) => g.kind));
    expect([...kinds].sort()).toEqual(["draft", "uncategorised", "wanted"]);
  });
});

describe("gap lifecycle", () => {
  beforeEach(resetData);

  it("keeps the date a gap was first seen across sweeps", async () => {
    const productId = await tree();
    await lessons(productId, "coding", 3);
    const [before] = await gaps(productId);
    await lessons(productId, "coding", 1);
    const [after] = await gaps(productId);
    expect(after.id).toBe(before.id);
    expect(after.first_seen_at).toEqual(before.first_seen_at);
    expect(after.score).toBe(4);
  });

  it("reopens a gap that comes back after being resolved", async () => {
    const productId = await tree();
    await lessons(productId, "coding", 3);
    const [before] = await gaps(productId);

    const page = await article(productId, "coding-guide", {
      component: "coding",
    });
    expect(await gaps(productId)).toEqual([
      expect.objectContaining({ kind: "uncategorised" }),
    ]);

    await updateReferenceDoc(page.id, { status: "archived" });
    const [again] = of(await gaps(productId), "unwritten");
    expect(again.id).toBe(before.id);
    expect(new Date(again.first_seen_at).getTime()).toBeGreaterThan(
      new Date(before.first_seen_at).getTime(),
    );
  });

  it("hides a dismissed gap until the evidence grows well past it", async () => {
    const productId = await tree();
    await lessons(productId, "coding", 3);
    const [g] = await gaps(productId);
    await dismissWikiGap(productId, g.id, null);
    expect(await gaps(productId)).toEqual([]);

    // 4 is not enough past 3; it needs max(ceil(3 × 1.5), 3 + 3) = 6.
    await lessons(productId, "coding", 1);
    expect(await gaps(productId)).toEqual([]);
    await lessons(productId, "coding", 2);
    const [back] = await gaps(productId);
    expect(back.id).toBe(g.id);
    expect(back.dismissed_score).toBe(3);
  });

  it("refuses to dismiss what is not an open gap in this wiki", async () => {
    const productId = await tree();
    await lessons(productId, "coding", 3);
    const [g] = await gaps(productId);
    await expect(dismissWikiGap(null, g.id, null)).rejects.toThrow(
      /No open gap/,
    );
    await expect(dismissWikiGap(productId, "nope", null)).rejects.toThrow(
      /No open gap/,
    );
  });

  /** The key mirrors LOCK_NS in core/wiki/gaps.ts. */
  it("skips a wiki another sweep holds, or waits for it when asked", async () => {
    const productId = await tree();
    await lessons(productId, "coding", 3);

    let waiting!: ReturnType<typeof sweepWikiGaps>;
    await sql.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(
          ${0x7769}::int, hashtext(current_schema() || ':' || ${productId}))
      `;
      expect(await sweepWikiGaps({ productId })).toMatchObject({
        wikis: 0,
        skipped: 1,
      });
      waiting = sweepWikiGaps({ productId, wait: true });
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(await waiting).toMatchObject({ wikis: 1, skipped: 0 });
    expect(await listWikiGaps(productId)).toHaveLength(1);
  });

  it("sweeps every wiki when not told which", async () => {
    const productId = await tree();
    await lessons(productId, "coding", 3);
    await article(null, "loose");
    const result = await sweepWikiGaps();
    expect(result.failed).toBe(0);
    expect(await listWikiGaps(productId)).toHaveLength(1);
    expect(await listWikiGaps(null)).toHaveLength(1);
  });
});
