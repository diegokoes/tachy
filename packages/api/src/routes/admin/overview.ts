import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  catalogCensus,
  userCensus,
  sourceCensus,
  repoCensus,
  knowledgeCensus,
  reportsCensus,
  agentUsageCensus,
  toolUsageCensus,
  sourceTrafficCensus,
  libraryEngagementCensus,
  sourceIssues,
  repoIssues,
  catalogIssues,
  userIssues,
  jobIssues,
  forbidden,
  ISSUE_ITEMS,
  type IssueList,
} from "@tachy/core";
import { callerScope, isAdminIdentity } from "../../authz";
import { runtimeSnapshot, systemIssues } from "../../runtime";
import { untokenedConnections } from "./sources";

/** The admin overview: counts, activity and what needs fixing per page. */
export const overview = new Hono()
  /**
   * The admin index's counts, in one request rather than one per section.
   * Composed here from each domain's own census: a count of teams belongs to
   * catalog and a count of repos to code, and nothing in core reaches across
   * to another domain's tables to produce this.
   */
  .get("/overview", async (c) => {
    const ctx = await callerScope(c);
    const [catalog, users, sources, repos, knowledge, reports, untokened] =
      await Promise.all([
        catalogCensus(),
        userCensus(),
        sourceCensus(),
        repoCensus(),
        knowledgeCensus(),
        reportsCensus(),
        untokenedConnections(ctx).then((slugs) => slugs.length),
      ]);
    return c.json({
      counts: {
        sources: sources.connections,
        projects: sources.projects,
        repos: repos.repos,
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
      // per-membership, which the browser would otherwise fetch one row at a
      // time.
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

  /**
   * What the deployment has been doing, as opposed to what it holds. Its own
   * route so the rail's counts stay one cheap query: these scan day buckets and
   * the run log, and only the overviews render them.
   *
   * Everything is aggregate except two lists that name people — who spends the
   * most tokens, who has the agent change the most — and those travel only to an
   * app admin, for the same reason `/system` keeps its `env` block back.
   */
  .get("/overview/activity", async (c) => {
    const [usage, tools, traffic, library] = await Promise.all([
      agentUsageCensus(30),
      toolUsageCensus(30),
      sourceTrafficCensus(14),
      libraryEngagementCensus(30),
    ]);
    if (!isAdminIdentity(c)) {
      delete usage.top_users;
      delete tools.writers;
    }
    return c.json({ usage, tools, traffic, library });
  })

  /**
   * What needs fixing on one admin page, by name: the census counts, with the
   * offenders listed so each message can say which one. Wording lives in the
   * SPA, which owns the deployment's terms for teams, products and customers.
   */
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
