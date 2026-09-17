import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addComponent,
  addCustomer,
  addLabel,
  addResolutionPattern,
  addTeam,
  catalogCensus,
  createUser,
  knowledgeCensus,
  linkRepo,
  saveKnowledgeEntry,
  repoCensus,
  sourceCensus,
  userCensus,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

/*
 * The admin overview renders from these four numbers-only queries rather than
 * from the lists themselves, so what is asserted here is mostly the "how much
 * of this is unfinished" half: those are the figures with a condition in them,
 * and the ones a panel cannot cheaply recompute in the browser.
 */
describe("the admin census", () => {
  beforeEach(resetData);
  afterAll(() => sql.end());

  describe("catalog", () => {
    /* Deltas, not absolutes: teams, products and source_connections are the
       three tables resetData deliberately leaves standing, so another file on
       this worker may have added to them already. */
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

      const c = await catalogCensus();
      expect(c.components_no_description).toBe(1);
      expect(c.labels_no_description).toBe(1);
      expect(c.patterns).toBe(1);
      expect(c.patterns_no_description).toBe(0);
    });

    it("counts a customer with no email domain — nothing resolves to them", async () => {
      await addCustomer({ name: "Anon Co", slug: "anon-co" });
      await addCustomer({
        name: "Known Co",
        slug: "known-co",
        emailDomains: ["known.example"],
      });

      const c = await catalogCensus();
      expect(c.customers).toBe(2);
      expect(c.customers_no_domains).toBe(1);
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

      const c = await catalogCensus();
      const mine = c.components_by_product.find((p) => p.slug === "tpd");
      expect(mine?.n).toBe(2);
      /* Products with nothing under them are the point of the chart, so they
         must still be rows in it — the left join, not an inner one. */
      expect(c.components_by_product.length).toBe(c.products);
      const summed = c.components_by_product.reduce((n, p) => n + p.n, 0);
      expect(summed).toBe(c.components);
    });
  });

  describe("sources", () => {
    it("splits projects by role and finds the ones with no wiki", async () => {
      const s = await sourceCensus();
      expect(s.knowledge).toBe(1);
      expect(s.trackers).toBe(0);
      expect(s.projects_no_wiki).toBe(1);
      expect(s.projects_for_customer).toBe(0);
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
      const s = await sourceCensus();
      expect(s.by_type.freshdesk).toBeGreaterThanOrEqual(1);
      const grouped = Object.values(s.by_type).reduce((n, v) => n + v, 0);
      expect(grouped).toBe(s.connections);
    });
  });

  describe("repos", () => {
    it("is all zeroes and no oldest index when nothing is linked", async () => {
      const r = await repoCensus();
      expect(r).toMatchObject({
        repos: 0,
        ready: 0,
        working: 0,
        idle: 0,
        failing: 0,
        files: 0,
        chunks: 0,
        never_indexed: 0,
      });
      expect(r.oldest_indexed_at).toBeNull();
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
        update repos set index_status = 'ready', file_count = 10,
          chunk_count = 40, last_indexed_at = now() - interval '3 days'
        where slug = 'seed-ready'
      `;
      await sql`
        update repos set index_status = 'error' where slug = 'seed-broken'
      `;

      const r = await repoCensus();
      expect(r.repos).toBe(2);
      expect(r.ready).toBe(1);
      expect(r.failing).toBe(1);
      expect(r.idle).toBe(0);
      expect(r.files).toBe(10);
      expect(r.chunks).toBe(40);
      // The one that never indexed is the broken one.
      expect(r.never_indexed).toBe(1);
      expect(r.no_component).toBe(2);
      expect(r.no_project).toBe(2);
      expect(r.oldest_indexed_at).toBeInstanceOf(Date);
    });
  });

  describe("knowledge", () => {
    it("is empty before anything is written", async () => {
      const k = await knowledgeCensus();
      expect(k).toMatchObject({
        entries: 0,
        entries_no_component: 0,
        entries_no_product: 0,
      });
      expect(k.by_status).toEqual({});
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

      const k = await knowledgeCensus();
      expect(k.entries).toBe(2);
      expect(k.by_status).toEqual({ approved: 1, draft: 1 });
      /* Neither carries a component; only one carries a product. */
      expect(k.entries_no_component).toBe(2);
      expect(k.entries_no_product).toBe(1);
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

      const k = await knowledgeCensus();
      expect(k.entries).toBe(1);
      expect(k.entries_no_component).toBe(0);
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

      const u = await userCensus();
      expect(u.users).toBe(2);
      expect(u.admins).toBe(1);
      expect(u.with_password).toBe(1);
      expect(u.disabled).toBe(0);
      expect(u.users_no_team).toBe(2);
      expect(u.teams_with_admin).toBe(0);
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
      const u = await userCensus();
      expect(u.teams_with_admin).toBe(1);
      expect(u.team_admins).toBe(1);
      expect(u.teams_without_admin.map((t) => t.slug)).not.toContain(
        "test-team",
      );
      expect(u.users_no_team).toBe(0);
    });

    /* The four segments the access overview draws have to partition the roll,
       so somebody who is both rungs must land in exactly one of them. */
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

      const u = await userCensus();
      expect(u.admins).toBe(1);
      expect(u.team_admins).toBe(0);
      expect(u.teams_with_admin).toBe(1);
      expect(u.users - u.disabled - u.admins - u.team_admins).toBe(u.users - 1);
    });

    it("counts a disabled user as one who cannot sign in", async () => {
      const user = await createUser({ email: "gone@test.local" });
      await sql`update users set disabled = true where id = ${user.id}`;
      const u = await userCensus();
      expect(u.users).toBe(1);
      expect(u.disabled).toBe(1);
    });
  });
});
