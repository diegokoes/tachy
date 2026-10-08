import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addComponent, addTeam, renameComponent } from "@tachy/core/catalog";
import {
  addSourceProject,
  deleteProjectAreaMap,
  deleteSourceProject,
  listProjectAreaMap,
  listSourceProjects,
  resolveAreaComponent,
  resolveProjectContext,
  resolveProjectContextStrict,
  resolveSourceProject,
  setProjectAreaMap,
  updateSourceProject,
} from "@tachy/core/sources";
import { ingestWorkItem } from "@tachy/core/work-items";
import { linkRepo } from "@tachy/core/code";
import {
  resetData,
  seededFreshdeskConnId,
  sql,
  tpdProductId,
} from "../database";

const SOURCE = "test-freshdesk";
const FIXTURE_KEY = "48000641379";

/**
 * resetData() spares source_projects, so this file owns the table's state and
 * puts the fixture routing row back for the suites that follow.
 */
const seedFixtureProject = () =>
  addSourceProject({
    sourceSlug: SOURCE,
    externalKey: FIXTURE_KEY,
    name: "Test Group",
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
    productSlug: "tpd",
    ...over,
  });
}

describe("source projects", () => {
  beforeEach(freshProjects);

  it("registers a project with a product and takes its team from it", async () => {
    const row = await register("ProjA", { name: "Project A" });
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

  it("registers a project against a team, with no product", async () => {
    const row = await addSourceProject({
      sourceSlug: SOURCE,
      externalKey: "DocsOnly",
      teamSlug: "test-team",
    });
    expect(row.product_id).toBeNull();
    expect(row.team_slug).toBe("test-team");
  });

  it("refuses a project with neither a product nor a team", async () => {
    await expect(
      addSourceProject({ sourceSlug: SOURCE, externalKey: "X" }),
    ).rejects.toThrow(/needs an owner/);
  });

  it("takes the team from the product even when a team is also named", async () => {
    await addTeam("other-team", "Other");
    const row = await register("ProjA", { teamSlug: "other-team" });
    expect(row.team_slug).toBe("test-team");
  });

  it("filters by whether a project has a product", async () => {
    await register("ProjA");
    await addSourceProject({
      sourceSlug: SOURCE,
      externalKey: "DocsOnly",
      teamSlug: "test-team",
    });
    const keys = async (hasProduct: boolean) =>
      (await listSourceProjects({ sourceSlug: SOURCE, hasProduct })).map(
        (p) => p.external_key,
      );
    expect(await keys(true)).not.toContain("DocsOnly");
    expect(await keys(false)).toEqual(["DocsOnly"]);
  });

  it("refuses a wiki on a project without a product", async () => {
    await expect(
      addSourceProject({
        sourceSlug: SOURCE,
        externalKey: "DocsOnly",
        teamSlug: "test-team",
        wikis: [{ identifier: "DocsOnly.wiki" }],
      }),
    ).rejects.toThrow(/cannot own a wiki/);
  });

  it("suggests registered keys when one is not found", async () => {
    await register("ProjAlpha");
    await expect(resolveSourceProject(SOURCE, "ProjAlpa")).rejects.toThrow(
      /ProjAlpha/,
    );
  });

  it("refuses to drop its product while repos or rules hang off it", async () => {
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
        productSlug: null,
        teamSlug: "test-team",
      }),
    ).rejects.toThrow(/area rule/);
  });

  it("drops its product cleanly when nothing hangs off it", async () => {
    const project = await register("ProjA");
    const row = await updateSourceProject(project.id, {
      productSlug: null,
      teamSlug: "test-team",
    });
    expect(row.product_id).toBeNull();
    expect(row.team_slug).toBe("test-team");
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

  it("survives a component rename - the point of it being a table", async () => {
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

  it("rejects an unknown component with nearest matches, and productless projects outright", async () => {
    const project = await withComponents();
    await expect(
      setProjectAreaMap({
        sourceProjectId: project.id,
        areaPrefix: "ProjA",
        componentSlug: "portl",
      }),
    ).rejects.toThrow(/portal/);

    const bare = await addSourceProject({
      sourceSlug: SOURCE,
      externalKey: "DocsOnly",
      teamSlug: "test-team",
    });
    await expect(
      setProjectAreaMap({
        sourceProjectId: bare.id,
        areaPrefix: "X",
        componentSlug: "portal",
      }),
    ).rejects.toThrow(/no product/);
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
      wikis: [{ identifier: "TPD.wiki", name: "TPD.wiki" }],
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
