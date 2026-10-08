import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addComponent,
  addCustomer,
  addLabel,
  addResolutionPattern,
  addTeam,
  catalogCensus,
} from "@tachy/core/catalog";
import { createUser, userCensus } from "@tachy/core/access";
import {
  knowledgeByComponent,
  knowledgeCensus,
  saveKnowledgeEntry,
} from "@tachy/core/knowledge";
import { linkRepo, repoCensus, repoIssues } from "@tachy/core/code";
import { sourceCensus } from "@tachy/core/sources";
import { resetData, sql, tpdProductId } from "../database";

// The admin overview renders from these numbers-only queries, not from the
// lists. Mostly the "how much is unfinished" figures are asserted: they carry a
// condition, and a panel cannot recompute them in the browser.
describe("the admin census", () => {
  beforeEach(resetData);
  afterAll(() => sql.end());

  describe("catalog", () => {
    // Deltas, not absolutes: teams, products and source_connections are the
    // three tables `resetData` leaves standing, so another file on this worker
    // may have added to them already.
    it("counts a team that owns no product", async () => {
      const before = await catalogCensus();

      await addTeam("orphan-team", "Orphan Team");

      const after = await catalogCensus();
      expect(after.teams).toBe(before.teams + 1);
      expect(after.teams_no_product).toBe(before.teams_no_product + 1);
    });

    it("counts products with no components, and roots against nested", async () => {
      const tpd = await tpdProductId();
      const before = await catalogCensus();

      await addComponent({ productId: tpd, slug: "engine", name: "Engine" });
      await addComponent({
        productId: tpd,
        slug: "engine-timer",
        name: "Timer",
        parentSlug: "engine",
      });

      const after = await catalogCensus();
      expect(after.components).toBe(2);
      expect(after.components_root).toBe(1);
      expect(after.products_no_component).toBe(
        before.products_no_component - 1,
      );
    });

    it("counts an undescribed component, label and pattern separately", async () => {
      const tpd = await tpdProductId();
      await addComponent({ productId: tpd, slug: "bare", name: "Bare" });
      await addComponent({
        productId: tpd,
        slug: "spoken-for",
        name: "Spoken For",
        description: "what this part does",
      });
      await addLabel(tpd, "no-words");
      await addLabel(tpd, "with-words", "what this label means");
      await addResolutionPattern("configured", "the setting was wrong");

      const census = await catalogCensus();
      expect(census.components_no_description).toBe(1);
      expect(census.labels_no_description).toBe(1);
      expect(census.patterns).toBe(1);
      expect(census.patterns_no_description).toBe(0);
    });

    it("counts a customer with no email domain - nothing resolves to them", async () => {
      await addCustomer({ name: "Anon Co", slug: "anon-co" });
      await addCustomer({
        name: "Known Co",
        slug: "known-co",
        emailDomains: ["known.example"],
      });

      const census = await catalogCensus();
      expect(census.customers).toBe(2);
      expect(census.customers_no_domains).toBe(1);
    });

    it("reports every product in the per-product tally, empty ones included", async () => {
      const tpd = await tpdProductId();
      await addComponent({ productId: tpd, slug: "engine", name: "Engine" });
      await addComponent({
        productId: tpd,
        slug: "engine-timer",
        name: "Timer",
        parentSlug: "engine",
      });

      const census = await catalogCensus();
      const mine = census.components_by_product.find((p) => p.slug === "tpd");
      expect(mine?.n).toBe(2);
      // Products with nothing under them are the point of the chart, so they
      // must still be rows in it - the left join, not an inner one.
      expect(census.components_by_product.length).toBe(census.products);
      const summed = census.components_by_product.reduce((n, p) => n + p.n, 0);
      expect(summed).toBe(census.components);
    });
  });

  describe("sources", () => {
    it("splits projects by role and finds the ones with no wiki", async () => {
      const census = await sourceCensus();
      expect(census.with_product).toBe(1);
      expect(census.without_product).toBe(0);
      expect(census.projects_no_wiki).toBe(1);
      expect(census.projects_for_customer).toBe(0);
    });

    it("stops counting a project once it has a wiki", async () => {
      await sql`
        update source_projects
        set wikis = ${sql.json([{ identifier: "w1", default: true }])}
      `;
      expect((await sourceCensus()).projects_no_wiki).toBe(0);
    });

    it("counts a connection that has never synced", async () => {
      const before = await sourceCensus();
      expect(before.never_synced).toBe(before.connections);

      await sql`
        update source_connections
        set last_synced_at = now() - interval '6 days'
      `;
      expect((await sourceCensus()).never_synced).toBe(0);
    });

    it("groups connections by kind", async () => {
      const census = await sourceCensus();
      expect(census.by_type.freshdesk).toBeGreaterThanOrEqual(1);
      const grouped = Object.values(census.by_type).reduce((n, v) => n + v, 0);
      expect(grouped).toBe(census.connections);
    });
  });

  describe("repos", () => {
    it("is all zeroes and no oldest index when nothing is linked", async () => {
      const census = await repoCensus();
      expect(census).toMatchObject({
        repos: 0,
        ready: 0,
        working: 0,
        idle: 0,
        failing: 0,
        files: 0,
        chunks: 0,
        never_indexed: 0,
      });
      expect(census.oldest_indexed_at).toBeNull();
    });

    it("splits by index status and sums what is searchable", async () => {
      await linkRepo({
        slug: "seed-ready",
        url: "https://example.test/ready.git",
        productSlug: "tpd",
      });
      await linkRepo({
        slug: "seed-broken",
        url: "https://example.test/broken.git",
        productSlug: "tpd",
      });
      await sql`
        update repo_lines set index_status = 'ready', file_count = 10,
          chunk_count = 40, last_indexed_at = now() - interval '3 days'
        where repo_id = (select id from repos where slug = 'seed-ready')
      `;
      await sql`
        update repo_lines set index_status = 'error'
        where repo_id = (select id from repos where slug = 'seed-broken')
      `;

      const census = await repoCensus();
      expect(census.repos).toBe(2);
      expect(census.ready).toBe(1);
      expect(census.failing).toBe(1);
      expect(census.idle).toBe(0);
      expect(census.files).toBe(10);
      expect(census.chunks).toBe(40);
      // The one that never indexed is the broken one.
      expect(census.never_indexed).toBe(1);
      expect(census.no_component).toBe(2);
      expect(census.no_project).toBe(2);
      expect(census.oldest_indexed_at).toBeInstanceOf(Date);

      // The same conditions by name, for the issues list - a failing repo is
      // not also listed as never indexed.
      const issues = await repoIssues();
      expect(issues["repos.failing"]).toEqual({
        n: 1,
        items: [{ key: "seed-broken", label: "seed-broken" }],
      });
      expect(issues["repos.never_indexed"].n).toBe(0);
      expect(issues["repos.no_component"].items.map((i) => i.label)).toEqual([
        "seed-broken",
        "seed-ready",
      ]);
    });
  });

  describe("knowledge", () => {
    it("is empty before anything is written", async () => {
      const census = await knowledgeCensus();
      expect(census).toMatchObject({
        entries: 0,
        entries_no_component: 0,
        entries_no_product: 0,
      });
      expect(census.by_status).toEqual({});
    });

    it("splits by status and counts what the tree does not describe", async () => {
      const tpd = await tpdProductId();
      await saveKnowledgeEntry({
        status: "approved",
        productId: tpd,
        issueSummary: "Export produces an empty PDF",
        resolution: "clear the export cache",
      });
      await saveKnowledgeEntry({
        status: "draft",
        issueSummary: "Something nobody has filed yet",
      });

      const census = await knowledgeCensus();
      expect(census.entries).toBe(2);
      expect(census.by_status).toEqual({ approved: 1, draft: 1 });
      // Neither carries a component; only one carries a product.
      expect(census.entries_no_component).toBe(2);
      expect(census.entries_no_product).toBe(1);
    });

    it("files an entry once it is given a component", async () => {
      const tpd = await tpdProductId();
      await addComponent({ productId: tpd, slug: "export", name: "Export" });
      await saveKnowledgeEntry({
        status: "approved",
        productId: tpd,
        component: "export",
        issueSummary: "Export produces an empty PDF",
        resolution: "clear the export cache",
      });

      const census = await knowledgeCensus();
      expect(census.entries).toBe(1);
      expect(census.entries_no_component).toBe(0);
    });

    it("counts each component's entries, and the ones search returns", async () => {
      const tpd = await tpdProductId();
      await addComponent({ productId: tpd, slug: "export", name: "Export" });
      await addComponent({ productId: tpd, slug: "import", name: "Import" });
      for (const status of ["approved", "deprecated", "draft", "rejected"])
        await saveKnowledgeEntry({
          status,
          productId: tpd,
          component: "export",
          issueSummary: `An export lesson, ${status}`,
        });
      await saveKnowledgeEntry({
        status: "approved",
        productId: tpd,
        issueSummary: "A lesson about the product as a whole",
      });

      // Only the component with something filed has a row.
      expect(await knowledgeByComponent()).toEqual([
        { component_id: expect.any(String), entries: 4, searchable: 2 },
      ]);
    });
  });

  describe("users", () => {
    it("counts admins, passwords, and who belongs to no team", async () => {
      await createUser({
        email: "boss@test.local",
        role: "admin",
        password: "correct horse battery",
      });
      await createUser({ email: "sso-only@test.local" });

      const census = await userCensus();
      expect(census.users).toBe(2);
      expect(census.admins).toBe(1);
      expect(census.with_password).toBe(1);
      expect(census.disabled).toBe(0);
      expect(census.users_no_team).toBe(2);
      expect(census.teams_with_admin).toBe(0);
    });

    it("counts a team as curated only once someone admins it", async () => {
      const user = await createUser({ email: "curator@test.local" });
      const [team] = await sql`select id from teams where slug = 'test-team'`;
      await sql`
        insert into team_members (team_id, user_id, role)
        values (${team.id}, ${user.id}, 'member')
      `;
      const plain = await userCensus();
      expect(plain.teams_with_admin).toBe(0);
      expect(plain.teams_without_admin.map((t) => t.slug)).toContain(
        "test-team",
      );
      expect(plain.team_admins).toBe(0);

      await sql`
        update team_members set role = 'admin' where user_id = ${user.id}
      `;
      const census = await userCensus();
      expect(census.teams_with_admin).toBe(1);
      expect(census.team_admins).toBe(1);
      expect(census.teams_without_admin.map((t) => t.slug)).not.toContain(
        "test-team",
      );
      expect(census.users_no_team).toBe(0);
    });

    // The four segments the access overview draws have to partition the roll,
    // so somebody who is both rungs must land in exactly one of them.
    it("counts an app admin who also admins a team only as an app admin", async () => {
      const user = await createUser({
        email: "both@test.local",
        role: "admin",
      });
      const [team] = await sql`select id from teams where slug = 'test-team'`;
      await sql`
        insert into team_members (team_id, user_id, role)
        values (${team.id}, ${user.id}, 'admin')
      `;

      const census = await userCensus();
      expect(census.admins).toBe(1);
      expect(census.team_admins).toBe(0);
      expect(census.teams_with_admin).toBe(1);
      expect(
        census.users - census.disabled - census.admins - census.team_admins,
      ).toBe(census.users - 1);
    });

    it("counts a disabled user as one who cannot sign in", async () => {
      const user = await createUser({ email: "gone@test.local" });
      await sql`update users set disabled = true where id = ${user.id}`;
      const census = await userCensus();
      expect(census.users).toBe(1);
      expect(census.disabled).toBe(1);
    });
  });
});
