import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addComponent,
  addSourceProject,
  deleteProjectAreaMap,
  deleteSourceProject,
  ingestWorkItem,
  linkRepo,
  listProjectAreaMap,
  listSourceProjects,
  renameComponent,
  resolveAreaComponent,
  resolveProjectContext,
  resolveProjectContextStrict,
  resolveSourceProject,
  setProjectAreaMap,
  updateSourceProject,
} from "@tachy/core";
import { resetData, seededFreshdeskConnId, sql, tpdProductId } from "./helpers";

const SOURCE = "test-freshdesk";
const FIXTURE_KEY = "48000641379";

/** resetData() spares source_projects, so this file owns the table's state and
 *  puts the fixture routing row back for the suites that follow. */
const seedFixtureProject = () =>
  addSourceProject({
    sourceSlug: SOURCE,
    externalKey: FIXTURE_KEY,
    name: "Test Group",
    role: "knowledge",
    productSlug: "tpd",
  });

const seededProject = () => resolveSourceProject(SOURCE, FIXTURE_KEY);

async function freshProjects() {
  await resetData();
  await sql`delete from source_projects`;
  await seedFixtureProject();
}

afterAll(async () => {
  await seedFixtureProject();
  await sql.end();
});

async function register(externalKey: string, over: Record<string, any> = {}) {
  return addSourceProject({
    sourceSlug: SOURCE,
    externalKey,
    role: "knowledge",
    productSlug: "tpd",
    ...over,
  });
}

describe("source projects", () => {
  beforeEach(freshProjects);

  it("registers a knowledge project and takes its team from the product", async () => {
    const row = await register("ProjA", { name: "Project A" });
    expect(row.role).toBe("knowledge");
    expect(row.product_slug).toBe("tpd");
    expect(row.team_slug).toBe("test-team");
    expect(row.source_slug).toBe(SOURCE);
  });

  it("upserts on (connection, external_key) instead of duplicating", async () => {
    const first = await register("ProjA", { name: "Project A" });
    const again = await register("ProjA", { name: "Renamed" });
    expect(again.id).toBe(first.id);
    expect(again.name).toBe("Renamed");
    expect(
      (await listSourceProjects({ sourceSlug: SOURCE })).filter(
        (p) => p.external_key === "ProjA",
      ),
    ).toHaveLength(1);
  });

  it("registers a tracker against a team, with no product", async () => {
    const row = await addSourceProject({
      sourceSlug: SOURCE,
      externalKey: "DocsOnly",
      role: "tracker",
      teamSlug: "test-team",
    });
    expect(row.product_id).toBeNull();
    expect(row.team_slug).toBe("test-team");
  });

  it("refuses a knowledge project with no product, and a tracker with one", async () => {
    await expect(
      addSourceProject({
        sourceSlug: SOURCE,
        externalKey: "X",
        role: "knowledge",
        teamSlug: "test-team",
      }),
    ).rejects.toThrow(/needs a product/);
    await expect(
      addSourceProject({
        sourceSlug: SOURCE,
        externalKey: "X",
        role: "tracker",
        productSlug: "tpd",
      }),
    ).rejects.toThrow(/no product/);
  });

  it("keeps role and product in step at the database level", async () => {
    const conn = await seededFreshdeskConnId();
    const [team] = await sql`select id from teams where slug = 'test-team'`;
    await expect(
      sql`
        insert into source_projects (source_connection_id, external_key, name, team_id, role)
        values (${conn}, 'Broken', 'Broken', ${team.id}, 'knowledge')
      `,
    ).rejects.toThrow(/source_projects_check/);
  });

  it("refuses a wiki on a tracker project", async () => {
    await expect(
      addSourceProject({
        sourceSlug: SOURCE,
        externalKey: "DocsOnly",
        role: "tracker",
        teamSlug: "test-team",
        wiki: { identifier: "DocsOnly.wiki" },
      }),
    ).rejects.toThrow(/cannot own a wiki/);
  });

  it("suggests registered keys when one is not found", async () => {
    await register("ProjAlpha");
    await expect(resolveSourceProject(SOURCE, "ProjAlpa")).rejects.toThrow(
      /ProjAlpha/,
    );
  });

  it("refuses to become a tracker while repos or rules hang off it", async () => {
    const project = await register("ProjA");
    const tpd = await tpdProductId();
    await addComponent({ productId: tpd, slug: "portal", name: "Portal" });
    await setProjectAreaMap({
      sourceProjectId: project.id,
      areaPrefix: "ProjA\\Portal",
      componentSlug: "portal",
    });
    await expect(
      updateSourceProject(project.id, {
        role: "tracker",
        teamSlug: "test-team",
      }),
    ).rejects.toThrow(/area rule/);
  });

  it("refuses deletion while a repo points at it", async () => {
    const project = await register("ProjA");
    await linkRepo({
      slug: "portal",
      url: "https://example.invalid/portal.git",
      sourceProjectId: project.id,
    });
    await expect(deleteSourceProject(project.id)).rejects.toThrow(/repo/);
  });
});

describe("area path mapping", () => {
  beforeEach(freshProjects);

  async function withComponents() {
    const tpd = await tpdProductId();
    await addComponent({ productId: tpd, slug: "portal", name: "Portal" });
    await addComponent({ productId: tpd, slug: "backend", name: "Backend" });
    return register("ProjA");
  }

  it("picks the longest matching prefix", async () => {
    const project = await withComponents();
    await setProjectAreaMap({
      sourceProjectId: project.id,
      areaPrefix: "ProjA",
      componentSlug: "backend",
    });
    await setProjectAreaMap({
      sourceProjectId: project.id,
      areaPrefix: "ProjA\\Portal",
      componentSlug: "portal",
    });

    expect(
      (await resolveAreaComponent(project.id, "ProjA\\Portal\\Print"))?.slug,
    ).toBe("portal");
    expect((await resolveAreaComponent(project.id, "ProjA\\Api"))?.slug).toBe(
      "backend",
    );
    expect(await resolveAreaComponent(project.id, "Other\\Thing")).toBeNull();
    expect(await resolveAreaComponent(project.id, null)).toBeNull();
  });

  it("survives a component rename — the point of it being a table", async () => {
    const project = await withComponents();
    const tpd = await tpdProductId();
    await setProjectAreaMap({
      sourceProjectId: project.id,
      areaPrefix: "ProjA\\Portal",
      componentSlug: "portal",
    });
    await renameComponent(tpd, "portal", "web-portal");

    const rules = await listProjectAreaMap(project.id);
    expect(rules).toHaveLength(1);
    expect(rules[0].component_slug).toBe("web-portal");
    expect(
      (await resolveAreaComponent(project.id, "ProjA\\Portal"))?.slug,
    ).toBe("web-portal");
  });

  it("rejects an unknown component with nearest matches, and trackers outright", async () => {
    const project = await withComponents();
    await expect(
      setProjectAreaMap({
        sourceProjectId: project.id,
        areaPrefix: "ProjA",
        componentSlug: "portl",
      }),
    ).rejects.toThrow(/portal/);

    const tracker = await addSourceProject({
      sourceSlug: SOURCE,
      externalKey: "DocsOnly",
      role: "tracker",
      teamSlug: "test-team",
    });
    await expect(
      setProjectAreaMap({
        sourceProjectId: tracker.id,
        areaPrefix: "X",
        componentSlug: "portal",
      }),
    ).rejects.toThrow(/tracker/);
  });

  it("replaces the component on an existing prefix, and deletes rules", async () => {
    const project = await withComponents();
    await setProjectAreaMap({
      sourceProjectId: project.id,
      areaPrefix: "ProjA",
      componentSlug: "portal",
    });
    await setProjectAreaMap({
      sourceProjectId: project.id,
      areaPrefix: "ProjA",
      componentSlug: "backend",
    });
    let rules = await listProjectAreaMap(project.id);
    expect(rules).toHaveLength(1);
    expect(rules[0].component_slug).toBe("backend");

    await deleteProjectAreaMap(rules[0].id);
    expect(await listProjectAreaMap(project.id)).toHaveLength(0);
  });
});

describe("project context", () => {
  beforeEach(freshProjects);

  it("answers by product, by key and by work item, with repos and wiki", async () => {
    const project = await seededProject();
    const tpd = await tpdProductId();
    await addComponent({ productId: tpd, slug: "portal", name: "Portal" });
    await updateSourceProject(project.id, {
      wiki: { identifier: "TPD.wiki", name: "TPD.wiki" },
    });
    await linkRepo({
      slug: "portal",
      url: "https://example.invalid/portal.git",
      sourceProjectId: project.id,
      componentSlug: "portal",
    });

    const byProduct = await resolveProjectContext({ productSlug: "tpd" });
    expect(byProduct).toHaveLength(1);
    expect(byProduct[0].wiki?.identifier).toBe("TPD.wiki");
    expect(byProduct[0].repos).toEqual([
      expect.objectContaining({ slug: "portal", component_slug: "portal" }),
    ]);

    const byKey = await resolveProjectContextStrict({
      sourceSlug: SOURCE,
      externalKey: "48000641379",
    });
    expect(byKey.project.id).toBe(project.id);

    const item = await ingestWorkItem(await seededFreshdeskConnId(), {
      externalId: "9001",
      kind: "ticket",
      title: "Printer offline",
      groupKey: "48000641379",
      raw: {},
      messages: [],
    });
    const byItem = await resolveProjectContext({ workItemId: item.id });
    expect(byItem[0].project.id).toBe(project.id);
  });

  it("errors with the candidates when a product maps to several projects", async () => {
    await register("ProjA");
    await expect(
      resolveProjectContextStrict({ productSlug: "tpd" }),
    ).rejects.toThrow(/ProjA/);
  });

  it("returns nothing rather than throwing for an unregistered product", async () => {
    await sql`delete from source_projects`;
    expect(await resolveProjectContext({ productSlug: "tpd" })).toEqual([]);
  });
});

describe("ingest routing through projects", () => {
  beforeEach(freshProjects);

  it("routes to the project's product and maps the area to a component", async () => {
    const project = await seededProject();
    const tpd = await tpdProductId();
    await addComponent({ productId: tpd, slug: "portal", name: "Portal" });
    await setProjectAreaMap({
      sourceProjectId: project.id,
      areaPrefix: "TPD\\Portal",
      componentSlug: "portal",
    });

    const item = await ingestWorkItem(await seededFreshdeskConnId(), {
      externalId: "9002",
      kind: "work_item",
      title: "Print job stuck",
      groupKey: "48000641379",
      areaPath: "TPD\\Portal\\Print",
      raw: {},
      messages: [],
    });

    expect(item.sourceProjectId).toBe(project.id);
    expect(item.productId).toBe(tpd);
    expect(item.componentSlug).toBe("portal");
  });

  it("ingests an item from an unregistered group with no product", async () => {
    const item = await ingestWorkItem(await seededFreshdeskConnId(), {
      externalId: "9003",
      kind: "ticket",
      title: "Stray",
      groupKey: "not-registered",
      raw: {},
      messages: [],
    });
    expect(item.sourceProjectId).toBeNull();
    expect(item.productId).toBeNull();
    expect(item.componentSlug).toBeNull();
  });
});
