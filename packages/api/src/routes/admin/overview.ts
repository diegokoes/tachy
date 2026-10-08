import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  catalogCensus,
  listComponentTree,
  catalogIssues,
} from "@tachy/core/catalog";
import { bucketCensus, bucketFreshness } from "@tachy/core/buckets";
import { userCensus, userIssues } from "@tachy/core/access";
import {
  sourceCensus,
  sourceTrafficCensus,
  sourceIssues,
  sourceFreshness,
} from "@tachy/core/sources";
import { repoCensus, repoIssues, repoFreshness } from "@tachy/core/code";
import {
  knowledgeCensus,
  knowledgeByComponent,
  knowledgeStale,
} from "@tachy/core/knowledge";
import { reportsCensus } from "@tachy/core/reports";
import { agentUsageCensus, toolUsageCensus } from "@tachy/core/analytics";
import { libraryEngagementCensus } from "@tachy/core/library";
import { jobIssues } from "@tachy/core/jobs";
import { forbidden, ISSUE_ITEMS, type IssueList } from "@tachy/core/infra";
import { callerScope, isAdminIdentity } from "../../authz";
import { runtimeSnapshot, systemIssues } from "../../runtime";
import { untokenedConnections } from "./sources";

/** How far back an overview's detail view looks, when it is not the default. */
const periodQuery = z.object({
  days: z.coerce.number().int().min(7).max(90).optional(),
});

/** The admin overview: counts, activity and what needs fixing per page. */
export const overview = new Hono()
  // The admin index's counts in one request. Composed here from each domain's
  // own census: a count of teams belongs to catalog and a count of repos to
  // code, and core does not reach across domains to produce this.
  .get("/overview", async (c) => {
    const ctx = await callerScope(c);
    const [
      catalog,
      users,
      sources,
      repos,
      knowledge,
      reports,
      untokened,
      buckets,
    ] = await Promise.all([
      catalogCensus(),
      userCensus(),
      sourceCensus(),
      repoCensus(),
      knowledgeCensus(),
      reportsCensus(),
      untokenedConnections(ctx).then((slugs) => slugs.length),
      bucketCensus(),
    ]);
    return c.json({
      counts: {
        sources: sources.connections,
        projects: sources.projects,
        repos: repos.repos,
        buckets: buckets.buckets,
        teams: catalog.teams,
        products: catalog.products,
        components: catalog.components,
        labels: catalog.labels,
        patterns: catalog.patterns,
        customers: catalog.customers,
        users: users.users,
        reports: reports.reports,
      },
      // Only what is actionable. A disabled user is a normal state; a
      // connection that cannot authenticate and a repo that stopped indexing
      // are not.
      warn: {
        sources: untokened,
        repos: repos.failing,
        reports: reports.open,
      },
      // The censuses unsummarised, for the overview panels. What they show
      // (labels with no description, teams with no admin) is per-product or
      // per-membership, which the browser would otherwise fetch row by row.
      detail: {
        sources: { ...sources, untokened },
        repos,
        catalog,
        users,
        knowledge,
        reports,
      },
    });
  })

  // What the deployment has been doing. Its own route so the rail's counts stay
  // one cheap query: these scan day buckets and the run log. The two lists that
  // name people travel only to an app admin, as `/system` holds back `env`.
  .get("/overview/activity", zValidator("query", periodQuery), async (c) => {
    const { days } = c.req.valid("query");
    const [usage, tools, traffic, library] = await Promise.all([
      agentUsageCensus(days ?? 30),
      toolUsageCensus(days ?? 30),
      sourceTrafficCensus(days ?? 14),
      libraryEngagementCensus(days ?? 30),
    ]);
    if (!isAdminIdentity(c)) {
      delete usage.top_users;
      delete tools.writers;
    }
    return c.json({ usage, tools, traffic, library });
  })

  // When each source, repo and bucket was last brought up to date, oldest
  // first.
  .get("/overview/freshness", async (c) => {
    const [sources, repos, buckets] = await Promise.all([
      sourceFreshness(),
      repoFreshness(),
      bucketFreshness(),
    ]);
    return c.json([...sources, ...repos, ...buckets]);
  })

  .get("/overview/stale", async (c) => c.json(await knowledgeStale()))

  // Every component with its entries, for the structure overview's map. Its own
  // route because it grows with the catalogue, and the census is fetched on
  // every admin page.
  .get("/overview/components", async (c) => {
    const [tree, filed] = await Promise.all([
      listComponentTree(),
      knowledgeByComponent(),
    ]);
    const filedByComponent = new Map(filed.map((f) => [f.component_id, f]));
    return c.json(
      tree.map((n) => ({
        id: n.id,
        parent_id: n.parent_id,
        slug: n.slug,
        name: n.name,
        product_slug: n.product_slug,
        product_name: n.product_name,
        entries: filedByComponent.get(n.id)?.entries ?? 0,
        searchable: filedByComponent.get(n.id)?.searchable ?? 0,
      })),
    );
  })

  // What needs fixing on one admin page, by name: the census counts, with the
  // offenders listed so each message can say which one. Wording lives in the
  // SPA, which owns the deployment's terms for teams, products and customers.
  .get(
    "/overview/issues",
    zValidator(
      "query",
      z.object({
        page: z.enum([
          "integrations",
          "structure",
          "access",
          "workers",
          "system",
        ]),
      }),
    ),
    async (c) => {
      const { page } = c.req.valid("query");
      const admin = isAdminIdentity(c);
      if ((page === "workers" || page === "system") && !admin)
        throw forbidden("app admins only");
      let issues: Record<string, IssueList> = {};
      if (page === "integrations") {
        const ctx = await callerScope(c);
        const [sources, repos, untokened] = await Promise.all([
          sourceIssues(),
          repoIssues(),
          untokenedConnections(ctx),
        ]);
        issues = {
          "sources.untokened": {
            n: untokened.length,
            items: untokened
              .slice(0, ISSUE_ITEMS)
              .map((slug) => ({ key: slug, label: slug })),
          },
          ...sources,
          ...repos,
        };
      } else if (page === "structure") issues = await catalogIssues();
      else if (page === "access") issues = await userIssues();
      else if (page === "workers") issues = await jobIssues();
      else issues = systemIssues(await runtimeSnapshot());
      return c.json(issues);
    },
  );
