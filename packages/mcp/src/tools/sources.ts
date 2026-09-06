import { z } from "zod";
import {
  getProductIdBySlug,
  getTeamIdBySlug,
  listSourceConnections,
  addSourceConnection,
  SOURCE_PROJECT_ROLES,
  listSourceProjects,
  addSourceProject,
  setProjectAreaMap,
  sourceProjectScope,
  resolveProjectContext,
} from "@tachy/core";
import { tool } from "../server";
import { out } from "../results";
import {
  requireCanEdit,
  requireCanManageTeam,
  requireGlobalAdmin,
} from "../permissions";

/**
 * The systems work items come from, and how their projects map onto products.
 */

tool(
  "list_source_connections",
  {
    description:
      "List all configured source connections (Freshdesk tenants, GitHub orgs, Azure DevOps organizations). Each connection's 'slug' is what every other tool's 'source' parameter takes — call this first whenever you only know the source type.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listSourceConnections()),
);

tool(
  "add_source_connection",
  {
    description:
      'Register a new source connection. source_type is \'freshdesk\', \'github\', or \'azure-devops\'. slug is a short unique identifier (e.g. \'my-freshdesk\') — it also determines the env var for the API token: FRESHDESK_TOKEN_<SLUG_UPPERCASED>, GITHUB_TOKEN_<SLUG_UPPERCASED>, or AZURE_DEVOPS_TOKEN_<SLUG_UPPERCASED> (non-alphanumerics become underscores). For Freshdesk: set base_url to your tenant root URL (e.g. https://your-domain.freshdesk.com). For GitHub: omit base_url and set config to {"repos":["owner/repo"]}. For Azure DevOps: base_url is the org URL (https://dev.azure.com/<org>), config is {"projects":["ProjectA","ProjectB"]}, and the token is a PAT (scopes: Work Items Read, plus Read & Write for ticket creation, Wiki Read for wikis, Code Read for repos). Tokens are never stored in the DB — set the env var, or store per-user/team via the credentials vault.',
    inputSchema: {
      source_type: z.enum(["freshdesk", "github", "azure-devops"]),
      slug: z.string(),
      base_url: z.string().optional(),
      config: z.record(z.string(), z.any()).optional(),
    },
  },
  async (a) => {
    await requireGlobalAdmin();
    return out(
      await addSourceConnection({
        sourceType: a.source_type,
        slug: a.slug,
        baseUrl: a.base_url,
        config: a.config,
      }),
    );
  },
);

tool(
  "list_source_projects",
  {
    description:
      "List the registered projects of one or all source connections. A project is the source's own grouping — an Azure DevOps project, a Freshdesk group (numeric id as text), a GitHub 'owner/repo'. role 'knowledge' means it maps to a product and can own wikis, repos and area→component rules; role 'tracker' means it is a productless target we only create or reassign work items in.",
    inputSchema: {
      source_slug: z.string().optional(),
      product_slug: z.string().optional(),
      role: z.enum(SOURCE_PROJECT_ROLES).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) =>
    out(
      await listSourceProjects({
        sourceSlug: a.source_slug,
        productId: a.product_slug
          ? await getProductIdBySlug(a.product_slug)
          : undefined,
        role: a.role,
      }),
    ),
);

tool(
  "get_project_context",
  {
    description:
      "Everything configured about a project in one call: its connection and source-native key, the product and team it belongs to, its wikis (`wiki` is the default one, `wikis` lists them all — an ADO project usually has several), its repos with the component each implements and the customer each belongs to (null = shared product code), and its area→component rules. Resolve by product_slug, by work_item_id, or by (source_slug + external_key). Call this before search_code, /ingest-wiki or create_ado_work_item so you use the right repo, wiki and project instead of guessing.",
    inputSchema: {
      product_slug: z.string().optional(),
      work_item_id: z.string().optional(),
      source_slug: z.string().optional(),
      external_key: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) =>
    out(
      await resolveProjectContext({
        productSlug: a.product_slug,
        workItemId: a.work_item_id,
        sourceSlug: a.source_slug,
        externalKey: a.external_key,
      }),
    ),
);

tool(
  "add_source_project",
  {
    description:
      "Register a source-native project. role 'knowledge' binds it to a product (product_slug required) so its items ingest there and it can own a wiki, repos and area rules. role 'tracker' is a productless create/reassign target and needs team_slug instead. For Azure DevOps external_key is the project name (a fetched item's groupKey); for Freshdesk the group_id; for GitHub 'owner/repo'. Call list_source_connections and list_products first.",
    inputSchema: {
      source_slug: z.string(),
      external_key: z.string(),
      name: z.string().optional(),
      role: z.enum(SOURCE_PROJECT_ROLES),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      customer_slug: z
        .string()
        .optional()
        .describe(
          "Set ONLY when the whole project exists for one customer (their own ADO project). Every item ingested from it is then theirs by configuration, which beats guessing at the sender's domain. Leave it off for a product project that serves many customers — a wrong value here mis-files everything in it.",
        ),
      wikis: z
        .array(
          z.object({
            identifier: z.string(),
            name: z.string().optional(),
            type: z.string().optional(),
            root_path: z.string().optional(),
            default: z.boolean().optional(),
          }),
        )
        .optional()
        .describe(
          "The project's wikis, from list_ado_wikis — an ADO project usually has several (one project wiki plus a code wiki per repo). Flag one 'default': that is the one every wiki tool uses when no wiki is named, and the first is taken if you flag none. Knowledge projects only.",
        ),
      notes: z.string().optional(),
    },
  },
  async (a) => {
    if (a.role === "knowledge")
      await requireCanEdit({
        productId: a.product_slug
          ? await getProductIdBySlug(a.product_slug)
          : undefined,
      });
    else
      await requireCanManageTeam(
        a.team_slug ? await getTeamIdBySlug(a.team_slug) : null,
      );
    return out(
      await addSourceProject({
        sourceSlug: a.source_slug,
        externalKey: a.external_key,
        name: a.name,
        role: a.role,
        productSlug: a.product_slug,
        teamSlug: a.team_slug,
        customerSlug: a.customer_slug,
        wikis: a.wikis,
        notes: a.notes,
      }),
    );
  },
);

tool(
  "set_project_area_map",
  {
    description:
      "Map an Azure DevOps area path prefix to a component, so items under that area are filed on that component automatically. The longest matching prefix wins, so a rule on a sub-area beats one on the project root. component must be an existing slug/alias from list_components for the project's product.",
    inputSchema: {
      source_project_id: z.string(),
      area_prefix: z.string(),
      component: z.string(),
    },
  },
  async (a) => {
    await requireCanEdit(await sourceProjectScope(a.source_project_id));
    return out(
      await setProjectAreaMap({
        sourceProjectId: a.source_project_id,
        areaPrefix: a.area_prefix,
        componentSlug: a.component,
      }),
    );
  },
);
