import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  saveKnowledgeEntry,
  searchKnowledge,
  updateKnowledgeEntry,
  getKnowledgeEntry,
  listKnowledgeEntries,
  addFeedback,
  listEnvironments,
  listKnowledgeFacets,
} from "@tachy/core/knowledge";
import {
  addComponent,
  addCustomer,
  getCustomerIdBySlug,
} from "@tachy/core/catalog";
import { MAX_ENTRY_TITLE_CHARS } from "@tachy/core";
import { resetData, sql, tpdProductId } from "../database";

afterAll(() => sql.end());

describe("searchKnowledge", () => {
  beforeEach(resetData);

  it("ranks the relevant approved entry first and never returns drafts", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      title: "Scanner stays offline after a firmware update",
      issueSummary: "Barcode scanner stays offline after firmware update",
      symptoms: ["scanner offline", "error E-204"],
      rootCause: "firmware regression",
      resolution: "roll back firmware to 1.4.2",
    });
    await saveKnowledgeEntry({
      status: "approved",
      title: "Invoice export is empty",
      issueSummary: "Invoice export produces empty PDF",
      resolution: "clear the export cache",
    });
    await saveKnowledgeEntry({
      status: "draft",
      title: "Scanner offline draft",
      issueSummary: "scanner offline draft that must not surface",
    });

    const rows = await searchKnowledge("scanner offline E-204");
    expect(rows[0].title).toBe("Scanner stays offline after a firmware update");
    expect(rows.every((r) => r.status === "approved")).toBe(true);
    expect(rows.some((r) => String(r.title).includes("draft"))).toBe(false);
  });

  it("finds a semantic match even with no shared keywords", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      title: "Handheld reader will not connect after an upgrade",
      issueSummary:
        "Handheld barcode reader will not connect after a software upgrade",
      resolution: "reinstall the device driver",
    });
    await saveKnowledgeEntry({
      status: "approved",
      title: "Monthly invoice is blank",
      issueSummary: "Monthly invoice PDF is blank",
      resolution: "clear the export cache",
    });

    const rows = await searchKnowledge("scanner offline");
    expect(rows[0].title).toBe(
      "Handheld reader will not connect after an upgrade",
    );
  });

  it("scopes by product_id", async () => {
    const tpd = await tpdProductId();
    await saveKnowledgeEntry({
      status: "approved",
      productId: tpd,
      title: "tpd tracking gap",
    });
    await saveKnowledgeEntry({
      status: "approved",
      title: "tracking gap elsewhere",
    });

    const scoped = await searchKnowledge("tracking gap", { productId: tpd });
    expect(scoped.length).toBe(1);
    expect(scoped[0].title).toBe("tpd tracking gap");

    const withUnscoped = await searchKnowledge("tracking gap", {
      productId: tpd,
      includeUnscoped: true,
    });
    expect(withUnscoped.map((r) => r.title).sort()).toEqual([
      "tpd tracking gap",
      "tracking gap elsewhere",
    ]);
  });

  it("finds an entry by a signal (error code) with no other keyword overlap", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      title: "Label printing fails during rework",
      signals: ["023", "TOO_MANY_STRINGS", "application-provisioning.yml"],
    });
    await saveKnowledgeEntry({
      status: "approved",
      title: "Unrelated invoice export bug",
    });

    const rows = await searchKnowledge("TOO_MANY_STRINGS");
    expect(rows[0].title).toBe("Label printing fails during rework");
    expect(rows[0].signals).toContain("TOO_MANY_STRINGS");
  });
});

describe("knowledge_entries constraints", () => {
  beforeEach(resetData);

  it("normalizes confidence case so filtering by lowercase always works", async () => {
    const row = await saveKnowledgeEntry({
      title: "x",
      confidence: "HIGH",
    });
    const [stored] =
      await sql`select confidence from knowledge_entries where id = ${row.id}`;
    expect(stored.confidence).toBe("high");
  });

  it("rejects an invalid confidence value at the DB level", async () => {
    await expect(
      sql`insert into knowledge_entries (title, confidence) values ('x', 'super-high')`,
    ).rejects.toThrow(/knowledge_entries_confidence_check/);
  });

  it("rejects an invalid status value at the DB level", async () => {
    await expect(
      sql`insert into knowledge_entries (title, status) values ('x', 'not-a-status')`,
    ).rejects.toThrow(/knowledge_entries_status_check/);
  });

  it("requires a title at the DB level", async () => {
    await expect(
      sql`insert into knowledge_entries (issue_summary) values ('no title')`,
    ).rejects.toThrow(/null value in column "title"/);
  });

  it("rejects an empty or over-long title at the DB level", async () => {
    for (const title of ["", "x".repeat(MAX_ENTRY_TITLE_CHARS + 1)])
      await expect(
        sql`insert into knowledge_entries (title) values (${title})`,
      ).rejects.toThrow(/knowledge_entries_title_check/);
    await expect(
      sql`insert into knowledge_entries (title) values (${"x".repeat(MAX_ENTRY_TITLE_CHARS)})`,
    ).resolves.toBeDefined();
  });
});

describe("titles", () => {
  beforeEach(resetData);

  it("stores a title as one line, and refuses a blank or over-long one", async () => {
    const row = await saveKnowledgeEntry({
      title: "  Spooler   stalls\n on long batches ",
    });
    expect((await getKnowledgeEntry(row.id)).title).toBe(
      "Spooler stalls on long batches",
    );
    await expect(saveKnowledgeEntry({ title: " \n " })).rejects.toThrow(
      /title is empty/,
    );
    await expect(
      saveKnowledgeEntry({ title: "x".repeat(MAX_ENTRY_TITLE_CHARS + 1) }),
    ).rejects.toThrow(/at most 80/);
    await expect(
      updateKnowledgeEntry(row.id, {
        title: "y".repeat(MAX_ENTRY_TITLE_CHARS + 1),
      }),
    ).rejects.toThrow(/at most 80/);
  });

  it("returns the title beside the summary from get, list and search", async () => {
    const row = await saveKnowledgeEntry({
      status: "approved",
      title: "Spooler stalls on long batches",
      issueSummary:
        "The print spooler halts once a batch passes 500 labels, and the queue never drains.",
    });
    const fromGet = await getKnowledgeEntry(row.id);
    const [fromList] = await listKnowledgeEntries();
    const [fromSearch] = await searchKnowledge("spooler stalls");
    for (const found of [fromGet, fromList, fromSearch]) {
      expect(found.title).toBe("Spooler stalls on long batches");
      expect(found.issue_summary).toMatch(/^The print spooler halts/);
    }
  });

  it("finds an entry by a word only its title holds, on the keyword and the fuzzy leg", async () => {
    const titled = await saveKnowledgeEntry({
      status: "approved",
      title: "Zebrafix overlay hides the reprint button",
      issueSummary: "Operators cannot reach the reprint control on line 4.",
    });
    await saveKnowledgeEntry({
      status: "approved",
      title: "Invoice export is empty",
      issueSummary: "The monthly export produces an empty file.",
    });

    const [exact] = await searchKnowledge("zebrafix");
    expect(exact.id).toBe(titled.id);
    expect(Number(exact.fts_rank)).toBeGreaterThan(0);

    const [misspelt] = await searchKnowledge("zebrafx");
    expect(misspelt.id).toBe(titled.id);
    expect(Number(misspelt.trgm_sim)).toBeGreaterThan(0);
  });

  it("re-embeds an entry when only its title changes", async () => {
    const row = await saveKnowledgeEntry({
      title: "Spooler stalls on long batches",
      issueSummary: "The print spooler halts once a batch passes 500 labels.",
    });
    const vector = async () => {
      const [stored] = await sql`
        select embedding::text as embedding from knowledge_entries where id = ${row.id}
      `;
      return stored.embedding as string;
    };
    const before = await vector();
    await updateKnowledgeEntry(row.id, {
      title: "Label queue never drains past 500 labels",
    });
    expect(await vector()).not.toBe(before);
  });
});

describe("promoted facets (cloud / quality)", () => {
  beforeEach(resetData);

  it("stores and filters approved entries by cloud", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      title: "prod outage in pipeline",
      cloud: "prod",
      resolutionClarity: "clear",
    });
    await saveKnowledgeEntry({
      status: "approved",
      title: "qa pipeline flake",
      cloud: "qa",
    });

    const prod = await searchKnowledge("pipeline", { cloud: "prod" });
    expect(prod.length).toBe(1);
    expect(prod[0].cloud).toBe("prod");
    expect(prod[0].resolution_clarity).toBe("clear");
  });

  it("round-trips facets and lets update clear them with null", async () => {
    const row = await saveKnowledgeEntry({
      title: "x",
      cloud: "on-prem",
      hiddenFix: true,
      resolutionClarity: "clear",
    });
    let stored = await getKnowledgeEntry(row.id);
    expect(stored.cloud).toBe("on-prem");
    expect(stored.hidden_fix).toBe(true);

    await updateKnowledgeEntry(row.id, { cloud: null });
    stored = await getKnowledgeEntry(row.id);
    expect(stored.cloud).toBeNull();
    expect(stored.hidden_fix).toBe(true);
  });

  it("round-trips affected/fixed version, seeds from the work item, and filters on them", async () => {
    const row = await saveKnowledgeEntry({
      status: "approved",
      title: "broken in 2.3",
      affectedVersion: "2.3.0",
      fixedVersion: "2.4.0",
    });
    let stored = await getKnowledgeEntry(row.id);
    expect(stored.affected_version).toBe("2.3.0");
    expect(stored.fixed_version).toBe("2.4.0");
    await updateKnowledgeEntry(row.id, { fixedVersion: null });
    stored = await getKnowledgeEntry(row.id);
    expect(stored.fixed_version).toBeNull();
    expect(stored.affected_version).toBe("2.3.0");

    const [conn] =
      await sql`select id from source_connections where slug = 'test-freshdesk'`;
    const [workItem] = await sql`
      insert into work_items (source_connection_id, external_id, title, observed_version)
      values (${conn.id}, 'v-1', 'versioned ticket', '1.9.2') returning id
    `;
    const seeded = await saveKnowledgeEntry({
      workItemId: workItem.id as string,
      title: "seeded",
    });
    expect((await getKnowledgeEntry(seeded.id)).affected_version).toBe("1.9.2");

    const hits = await listKnowledgeEntries({ affectedVersion: "2.3.0" });
    expect(hits.map((h) => h.id)).toEqual([row.id]);
  });

  it("accepts deployment-specific environments and lists them with counts", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      title: "a",
      cloud: "demo/preprod",
    });
    await saveKnowledgeEntry({
      status: "approved",
      title: "b",
      cloud: "demo/preprod",
    });
    await saveKnowledgeEntry({
      status: "approved",
      title: "c",
      cloud: "dev",
    });
    await saveKnowledgeEntry({
      status: "archived",
      title: "d",
      cloud: "gone",
    });

    const envs = await listEnvironments();
    expect(envs).toEqual([
      { cloud: "demo/preprod", count: 2 },
      { cloud: "dev", count: 1 },
    ]);
  });
});

describe("deprecation lifecycle", () => {
  beforeEach(resetData);

  it("deprecated entries surface in search flagged, archived ones do not", async () => {
    const old = await saveKnowledgeEntry({
      status: "approved",
      title: "Scanner offline after a firmware update",
      issueSummary: "scanner offline after firmware update",
    });
    const fresh = await saveKnowledgeEntry({
      status: "approved",
      title: "Reflash an offline scanner with tool v2",
      issueSummary: "scanner offline: reflash with tool v2",
    });
    await saveKnowledgeEntry({
      status: "archived",
      title: "Archived scanner lesson",
      issueSummary: "scanner offline lesson that must stay hidden",
    });
    await updateKnowledgeEntry(old.id, {
      status: "deprecated",
      supersededBy: fresh.id,
    });

    const rows = await searchKnowledge("scanner offline");
    const deprecated = rows.find((r) => r.id === old.id);
    expect(deprecated).toBeDefined();
    expect(deprecated!.status).toBe("deprecated");
    expect(deprecated!.superseded_by).toBe(fresh.id);
    expect(rows.some((r) => String(r.title).includes("Archived"))).toBe(false);
  });

  it("validates the supersede link: unknown target and self-reference are rejected", async () => {
    const row = await saveKnowledgeEntry({
      status: "approved",
      title: "x",
    });
    await expect(
      updateKnowledgeEntry(row.id, {
        supersededBy: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      updateKnowledgeEntry(row.id, { supersededBy: row.id }),
    ).rejects.toThrow(/supersede itself/);

    await expect(
      sql`update knowledge_entries set superseded_by = id where id = ${row.id}`,
    ).rejects.toThrow();
  });

  it("clears the supersede link with null and allows re-approving", async () => {
    const old = await saveKnowledgeEntry({
      status: "approved",
      title: "old lesson",
    });
    const fresh = await saveKnowledgeEntry({
      status: "approved",
      title: "new lesson",
    });
    await updateKnowledgeEntry(old.id, {
      status: "deprecated",
      supersededBy: fresh.id,
    });

    await updateKnowledgeEntry(old.id, {
      status: "approved",
      supersededBy: null,
    });
    const stored = await getKnowledgeEntry(old.id);
    expect(stored.status).toBe("approved");
    expect(stored.superseded_by).toBeNull();
  });

  it("accepts feedback kind 'deprecation' and rejects unknown kinds at the DB level", async () => {
    const row = await saveKnowledgeEntry({
      status: "approved",
      title: "x",
    });
    const feedback = await addFeedback({
      knowledgeEntryId: row.id,
      kind: "deprecation",
      comment: "fixed since v2.3",
    });
    expect(feedback.kind).toBe("deprecation");
    await expect(
      sql`insert into knowledge_feedback (knowledge_entry_id, kind) values (${row.id}, 'bogus')`,
    ).rejects.toThrow();
  });
});

describe("investigation and related links", () => {
  beforeEach(resetData);

  const TICKET_URL = "https://dev.azure.com/seed/_workitems/edit/50912";

  const investigated = () =>
    saveKnowledgeEntry({
      status: "approved",
      title: "Label printer drops jobs after a firmware rollout",
      issueSummary: "Jobs vanish from the queue on line 2.",
      investigation:
        "1. Traced the spooler with quarnix.\n2. Compared the firmware builds.",
      relatedLinks: [TICKET_URL],
    });

  it("returns both from get and search, and an update replaces or clears them", async () => {
    const row = await investigated();
    const fromGet = await getKnowledgeEntry(row.id);
    const [fromSearch] = await searchKnowledge("printer drops jobs");
    for (const found of [fromGet, fromSearch]) {
      expect(found.investigation).toMatch(/^1\. Traced the spooler/);
      expect(found.related_links).toEqual([TICKET_URL]);
    }

    await updateKnowledgeEntry(row.id, {
      investigation: null,
      relatedLinks: [],
    });
    const cleared = await getKnowledgeEntry(row.id);
    expect(cleared.investigation).toBeNull();
    expect(cleared.related_links).toEqual([]);
  });

  it("finds an entry by a word only its investigation holds, on the keyword and the fuzzy leg", async () => {
    const row = await investigated();
    await saveKnowledgeEntry({
      status: "approved",
      title: "Invoice export is empty",
      issueSummary: "The monthly export produces an empty file.",
    });

    const [exact] = await searchKnowledge("quarnix");
    expect(exact.id).toBe(row.id);
    expect(Number(exact.fts_rank)).toBeGreaterThan(0);

    const [misspelt] = await searchKnowledge("quarnx");
    expect(misspelt.id).toBe(row.id);
    expect(Number(misspelt.trgm_sim)).toBeGreaterThan(0);
  });

  it("names its component and the work item it was learned from", async () => {
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "spooler", name: "Spooler" });
    const [conn] =
      await sql`select id from source_connections where slug = 'test-freshdesk'`;
    const [workItem] = await sql`
      insert into work_items (source_connection_id, external_id, external_url)
      values (${conn.id}, '4711', 'https://acme.freshdesk.com/a/tickets/4711')
      returning id
    `;
    const row = await saveKnowledgeEntry({
      productId,
      workItemId: workItem.id as string,
      component: "spooler",
      title: "Spooler stalls on long batches",
    });
    expect(await getKnowledgeEntry(row.id)).toMatchObject({
      component_slug: "spooler",
      work_item_external_id: "4711",
      work_item_url: "https://acme.freshdesk.com/a/tickets/4711",
    });
  });

  it("re-embeds an entry when only its investigation changes", async () => {
    const row = await investigated();
    const vector = async () => {
      const [stored] = await sql`
        select embedding::text as embedding from knowledge_entries where id = ${row.id}
      `;
      return stored.embedding as string;
    };
    const before = await vector();
    await updateKnowledgeEntry(row.id, {
      investigation: "1. Swapped the print head; the drops stopped.",
    });
    expect(await vector()).not.toBe(before);
  });
});

describe("listKnowledgeFacets", () => {
  beforeEach(resetData);

  const seed = () =>
    Promise.all([
      saveKnowledgeEntry({
        status: "approved",
        title: "printer truncates labels",
        confidence: "high",
        resolutionClarity: "clear",
        hiddenFix: true,
        tags: ["printing", "firmware"],
      }),
      saveKnowledgeEntry({
        status: "approved",
        title: "scanner drops packets",
        confidence: "low",
        resolutionClarity: "clear",
        tags: ["printing"],
      }),
      saveKnowledgeEntry({
        status: "approved",
        title: "cache stampede",
        confidence: "low",
        resolutionClarity: "unclear",
        tags: ["caching"],
      }),
    ]);

  it("counts every facet value present", async () => {
    await seed();
    const facets = await listKnowledgeFacets();

    expect(facets.confidence).toEqual([
      { value: "low", count: 2 },
      { value: "high", count: 1 },
    ]);
    expect(facets.tags).toEqual([
      { value: "printing", count: 2 },
      { value: "caching", count: 1 },
      { value: "firmware", count: 1 },
    ]);
    expect(facets.hidden_fix).toEqual([{ value: "true", count: 1 }]);
  });

  it("narrows one facet's options by the other filters", async () => {
    await seed();
    const facets = await listKnowledgeFacets({ confidence: "low" });

    // Only the two low-confidence entries are in scope, so "firmware" - which
    // only the high-confidence one carries - is no longer offered.
    expect(facets.tags).toEqual([
      { value: "caching", count: 1 },
      { value: "printing", count: 1 },
    ]);
  });

  it("counts a facet with its own selection lifted, so it stays switchable", async () => {
    await seed();
    const facets = await listKnowledgeFacets({ confidence: "low" });

    // Narrowing by confidence must not reduce the confidence list to itself,
    // or there would be no way back to "high" without clearing the filter.
    expect(facets.confidence).toEqual([
      { value: "low", count: 2 },
      { value: "high", count: 1 },
    ]);
  });
});

describe("knowledge filters", () => {
  beforeEach(resetData);

  it("filters on confidence and hidden_fix, which the library exposes via +", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      title: "obvious fix",
      confidence: "high",
      hiddenFix: false,
    });
    await saveKnowledgeEntry({
      status: "approved",
      title: "non-obvious fix",
      confidence: "low",
      hiddenFix: true,
    });

    const high = await listKnowledgeEntries({ confidence: "high" });
    expect(high.map((r) => r.title)).toEqual(["obvious fix"]);

    const hidden = await listKnowledgeEntries({ hiddenFix: true });
    expect(hidden.map((r) => r.title)).toEqual(["non-obvious fix"]);

    // A null hidden_fix means "not marked", so it must match the false filter.
    await saveKnowledgeEntry({ status: "approved", title: "unmarked" });
    const notHidden = await listKnowledgeEntries({ hiddenFix: false });
    expect(notHidden.map((r) => r.title).sort()).toEqual([
      "obvious fix",
      "unmarked",
    ]);
  });
});

describe("customer scoping", () => {
  beforeEach(resetData);

  /** Two entries that say the same thing, so only the customer can order them. */
  const twins = async () => {
    await addCustomer({ name: "Logista", slug: "logista" });
    await addCustomer({ name: "Villiger", slug: "villiger" });
    await saveKnowledgeEntry({
      status: "approved",
      title: "Codes stay unlocked as the quantity grows",
      issueSummary: "Codes are not locked when the quantity increases",
      resolution: "reset the aggregation counter",
      customerSlug: "logista",
    });
    await saveKnowledgeEntry({
      status: "approved",
      title: "Codes stay unlocked as the quantity grows",
      issueSummary: "Codes are not locked when the quantity increases",
      resolution: "reset the aggregation counter",
    });
  };

  it("ranks a customer's own entry above an identical general one", async () => {
    await twins();
    const rows = await searchKnowledge("codes not locked quantity increase", {
      boostCustomerId: await getCustomerIdBySlug("logista"),
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].customer_slug).toBe("logista");
    expect(rows[1].customer_slug).toBeNull();
  });

  it("boosting never hides the general entry, nor another customer's", async () => {
    await twins();
    const rows = await searchKnowledge("codes not locked quantity increase", {
      boostCustomerId: await getCustomerIdBySlug("villiger"),
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.customer_slug))).toEqual(
      new Set([null, "logista"]),
    );
  });

  it("filtering by customer is exact - a general entry is not swept in", async () => {
    await twins();
    const rows = await searchKnowledge("codes not locked quantity increase", {
      customerId: await getCustomerIdBySlug("logista"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].customer_slug).toBe("logista");
  });

  it("never inherits the ticket's customer - it has to be stated", async () => {
    const customer = await addCustomer({ name: "Logista", slug: "logista" });
    const [workItem] = await sql`
      insert into work_items (source_connection_id, external_id, kind, customer_id)
      select id, 'wi-cust-1', 'ticket', ${customer.id} from source_connections limit 1
      returning id
    `;
    // Learned on Logista's ticket, but a lesson about the product.
    const general = await saveKnowledgeEntry({
      status: "approved",
      workItemId: workItem.id,
      title: "true of the product, found on their ticket",
    });
    expect((await getKnowledgeEntry(general.id)).customer_slug).toBeNull();

    const theirs = await saveKnowledgeEntry({
      status: "approved",
      workItemId: workItem.id,
      customerSlug: "logista",
      title: "only true of their install",
    });
    expect((await getKnowledgeEntry(theirs.id)).customer_slug).toBe("logista");
  });

  it("update can re-file an entry, and null makes it general again", async () => {
    await addCustomer({ name: "Logista", slug: "logista" });
    const row = await saveKnowledgeEntry({
      status: "approved",
      title: "some lesson",
    });
    await updateKnowledgeEntry(row.id, { customerSlug: "logista" });
    expect((await getKnowledgeEntry(row.id)).customer_slug).toBe("logista");
    await updateKnowledgeEntry(row.id, { customerSlug: null });
    expect((await getKnowledgeEntry(row.id)).customer_slug).toBeNull();
  });

  it("counts customers as a facet, by slug", async () => {
    await twins();
    const facets = await listKnowledgeFacets({ status: "approved" });
    expect(facets.customer).toEqual([{ value: "logista", count: 1 }]);
  });
});
