import { z } from "zod";
import {
  resolveSource,
  resolveCurrentUserId,
  recordRun,
  resolveRedactionPolicy,
  scrubText,
  TokenMap,
  resolveProjectContextStrict,
  matchWiki,
  addWorkItemLink,
  badInput,
} from "@tachy/core";
import { createAdoClient, workItemSchema } from "@tachy/source-azure-devops";
import type { AdoClient, JsonPatchOp } from "@tachy/source-azure-devops";
import { tool } from "../server";
import { out } from "../results";
import { sourceSlug } from "../fields";

/**
 * Azure DevOps beyond work-item ingest — its wikis, and creating items in it.
 */

async function resolveAdoClient(sourceSlug: string): Promise<{
  conn: Awaited<ReturnType<typeof resolveSource>>["conn"];
  client: AdoClient;
}> {
  const { conn } = await resolveSource(sourceSlug);
  if (conn.sourceType !== "azure-devops")
    throw badInput(
      `Source '${sourceSlug}' is type '${conn.sourceType}' — this tool needs an azure-devops connection (see list_source_connections)`,
    );
  return {
    conn,
    client: createAdoClient({
      baseUrl: conn.baseUrl ?? "",
      slug: conn.slug,
      config: conn.config,
    }),
  };
}

/**
 * Every ADO tool takes either the raw (source, project) pair or a product_slug
 * that resolves to a registered project — with its wiki and defaults attached.
 */
async function resolveAdoTarget(a: {
  source?: string;
  project?: string;
  product_slug?: string;
}): Promise<{
  sourceSlug: string;
  project: string;
  context: Awaited<ReturnType<typeof resolveProjectContextStrict>> | null;
}> {
  if (a.source && a.project && !a.product_slug)
    return { sourceSlug: a.source, project: a.project, context: null };
  const context = await resolveProjectContextStrict({
    productSlug: a.product_slug,
    sourceSlug: a.source,
    externalKey: a.project,
  });
  if (context.connection.source_type !== "azure-devops")
    throw badInput(
      `project '${context.project.external_key}' belongs to a ${context.connection.source_type} connection — this tool needs azure-devops`,
    );
  return {
    sourceSlug: context.connection.slug,
    project: context.project.external_key,
    context,
  };
}

const projectDefaults = (
  context: Awaited<ReturnType<typeof resolveProjectContextStrict>> | null,
  type: string,
): Record<string, unknown> | undefined =>
  (context?.project.config as any)?.defaults?.[type];

/**
 * A wiki argument is matched against the project's registered wikis first, so
 * either the friendly name or the identifier works; anything unrecognised is
 * passed to Azure DevOps as given, which is what makes an unregistered wiki
 * still reachable. With no argument the project's default is used.
 */
function resolveWikiId(
  context: Awaited<ReturnType<typeof resolveProjectContextStrict>> | null,
  wanted: string | undefined,
): string {
  const registered = context?.wikis ?? [];
  if (wanted) return matchWiki(registered, wanted)?.identifier ?? wanted;
  const fallback = context?.wiki?.identifier;
  if (fallback) return fallback;
  throw badInput(
    registered.length
      ? "this project's registered wikis have no default — name one with `wiki`"
      : "no wiki given and this project has none registered — call list_ado_wikis, or set them on the project",
  );
}

/**
 * A wiki URL's last segment is a display slug, not the page path: spaces become
 * dashes, so "/Customer specific (processes)" arrives as
 * "/Customer-specific-(processes)" and the path endpoint 404s on it. When a path
 * misses, the real page tree is consulted and the dashed form matched back.
 */
async function fetchWikiPage(
  client: { getWikiPage: Function; listWikiPages: Function },
  project: string,
  wikiId: string,
  path: string,
): Promise<{ path: string; content: string; remoteUrl?: string }> {
  try {
    return await client.getWikiPage(project, wikiId, path);
  } catch (e) {
    const flat = (s: string) =>
      s
        .replace(/[-\s]+/g, " ")
        .trim()
        .toLowerCase();
    const paths: string[] = await client
      .listWikiPages(project, wikiId)
      .catch(() => []);
    const hit = paths.find((p) => flat(p) === flat(path));
    if (!hit) throw e;
    return client.getWikiPage(project, wikiId, hit);
  }
}

tool(
  "list_ado_wikis",
  {
    description:
      "List the Azure DevOps wikis in a project (or across the org when project is omitted). Pass either source (+ optional project) or product_slug, which resolves to that product's registered project.",
    inputSchema: {
      source: sourceSlug.optional(),
      project: z.string().optional(),
      product_slug: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    const { sourceSlug, project } = a.product_slug
      ? await resolveAdoTarget(a)
      : { sourceSlug: a.source!, project: a.project! };
    const { client } = await resolveAdoClient(sourceSlug);
    const wikis = await client.listWikis(project);
    return out(
      wikis.map((w: any) => ({
        id: w.id,
        name: w.name,
        type: w.type,
        project: w.projectId ?? project ?? null,
      })),
    );
  },
);

tool(
  "list_ado_wiki_pages",
  {
    description:
      "List page paths of an Azure DevOps wiki (flattened page tree). Use get_ado_wiki_page to fetch a page's content. With product_slug, the project and its default wiki are resolved for you — pass wiki only to reach one of its other wikis. A big wiki runs to hundreds of pages, so narrow with path_prefix rather than raising limit.",
    inputSchema: {
      source: sourceSlug.optional(),
      project: z.string().optional(),
      product_slug: z.string().optional(),
      wiki: z
        .string()
        .optional()
        .describe(
          "One of the project's registered wikis, by name or identifier (get_project_context lists them), or any wiki name/id from list_ado_wikis. Defaults to the project's default wiki.",
        ),
      path_prefix: z.string().optional(),
      limit: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ source, project, product_slug, wiki, path_prefix, limit }) => {
    const target = await resolveAdoTarget({ source, project, product_slug });
    const wikiId = resolveWikiId(target.context, wiki);
    const { client } = await resolveAdoClient(target.sourceSlug);
    let paths = await client.listWikiPages(target.project, wikiId);
    if (path_prefix) paths = paths.filter((p) => p.startsWith(path_prefix));
    const max = limit ?? 100;
    return out({
      wiki: wikiId,
      total: paths.length,
      truncated: paths.length > max,
      pages: paths.slice(0, max),
      ...(paths.length > max
        ? {
            next: "only the first page paths are shown — narrow with path_prefix to see the rest of the tree rather than raising limit.",
          }
        : {}),
    });
  },
);

tool(
  "get_ado_wiki_page",
  {
    description:
      "Fetch one Azure DevOps wiki page's markdown content. READ ONLY — it never saves. To persist the knowledge, classify it (incident lesson → save_knowledge_entry; freeform doc/runbook → save_reference_doc with source set to the page URL, plus the source_project_id and external_key returned here so a re-import supersedes it instead of duplicating). The save call is gated by its own review box.",
    inputSchema: {
      source: sourceSlug.optional(),
      project: z.string().optional(),
      product_slug: z.string().optional(),
      wiki: z
        .string()
        .optional()
        .describe(
          "One of the project's registered wikis, by name or identifier; defaults to the project's default wiki",
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Page path from list_ado_wiki_pages, e.g. '/Delivery Processes & Tools'. A path copied out of a browser URL has dashes where the real path has spaces; that form is recovered automatically, but page_id is the exact way in.",
        ),
      page_id: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          "The numeric id in a wiki URL — .../_wiki/wikis/<wiki>/1648/Start means page_id 1648. Use it when the user pasted a link; it needs no path guessing.",
        ),
      max_chars: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ source, project, product_slug, wiki, path, page_id, max_chars }) => {
    if (!path && page_id == null)
      throw badInput("pass either path or page_id (a wiki URL carries the id)");
    const target = await resolveAdoTarget({ source, project, product_slug });
    const wikiId = resolveWikiId(target.context, wiki);
    const { conn, client } = await resolveAdoClient(target.sourceSlug);
    const page =
      page_id != null
        ? await client.getWikiPageById(target.project, wikiId, page_id)
        : await fetchWikiPage(client, target.project, wikiId, path!);
    const limit = max_chars ?? 20_000;
    const truncated = page.content.length > limit;
    const textOut = truncated ? page.content.slice(0, limit) : page.content;
    const redact = resolveRedactionPolicy(conn.config).enabled;
    const map = new TokenMap();
    return out({
      path: page.path,
      remote_url: page.remoteUrl ?? null,
      source_project_id: target.context?.project.id ?? null,
      external_key: page.path,
      product_slug: target.context?.product?.slug ?? null,
      chars: page.content.length,
      truncated,
      content: redact ? scrubText(textOut, map) : textOut,
      ...(redact
        ? {
            redaction:
              "Placeholders like [EMAIL_1]/[SECRET_1] are intentional redactions — treat them as opaque, never guess the originals.",
          }
        : {}),
      next: "Say where this belongs (reference doc, knowledge entry, or component), then call the matching save — its review box is the approval. Cite remote_url as the doc's source.",
    });
  },
);

tool(
  "get_ado_work_item_schema",
  {
    description:
      "Discover what an Azure DevOps project requires to create a work item. Without type: lists the project's work item types. With type: returns each field's reference name, whether it is required, allowed values, and defaults, plus the defaults configured on the registered project (config.defaults[type]) or on the connection (config.defaults[project][type]). ALWAYS call this before create_ado_work_item — required fields differ per project and type. Pass either source + project, or product_slug.",
    inputSchema: {
      source: sourceSlug.optional(),
      project: z.string().optional(),
      product_slug: z.string().optional(),
      type: z.string().optional().describe("Work item type, e.g. 'Bug'"),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    const target = await resolveAdoTarget(a);
    const { project } = target;
    const type = a.type;
    const { conn, client } = await resolveAdoClient(target.sourceSlug);
    if (!type) {
      const types = await client.listWorkItemTypes(project);
      return out({
        work_item_types: types.map((t: any) => ({
          name: t.name,
          reference_name: t.referenceName,
          description: t.description ?? null,
        })),
        next: "Call again with type to get its fields.",
      });
    }
    const defaults =
      projectDefaults(target.context, type) ??
      ((conn.config as any)?.defaults?.[project]?.[type] as
        Record<string, unknown> | undefined) ??
      {};
    // Shared with GET /source-connections/:slug/work-item-schema, so what the
    // approval box renders and what the model is told are the same projection.
    return out(await workItemSchema(client, project, type, defaults));
  },
);

tool(
  "create_ado_work_item",
  {
    description:
      "Create a work item (Bug, Task, User Story, ...) in an Azure DevOps project. Call get_ado_work_item_schema FIRST and fill every required field — requirements differ per project/type; never guess. Pass either source + project, or product_slug (or the project's external key) to use a registered project — a 'tracker' project is exactly a create target like this. fields is keyed by ADO reference names (e.g. 'System.AreaPath', 'Microsoft.VSTS.Common.Severity'); the project's configured defaults are applied underneath. description is plain text/HTML — ADO renders System.Description as HTML, markdown will NOT render. Pass work_item_id when raising this from a ticket, so the ticket records what tracks it. The review box shows the full field set for the user to edit, so draft it and call; a denial means they want changes, not a retry. Requires a PAT with Work Items Read & Write.",
    inputSchema: {
      source: sourceSlug.optional(),
      project: z.string().optional(),
      product_slug: z.string().optional(),
      type: z.string(),
      title: z.string(),
      description: z.string().optional(),
      fields: z.record(z.string(), z.any()).optional(),
      parent_id: z.string().optional(),
      related_ids: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      work_item_id: z
        .string()
        .optional()
        .describe("The tachy work item this is raised from, if any"),
    },
  },
  async (a) => {
    const target = await resolveAdoTarget(a);
    const project = target.project;
    const { conn, client } = await resolveAdoClient(target.sourceSlug);
    const defaults =
      projectDefaults(target.context, a.type) ??
      ((conn.config as any)?.defaults?.[project]?.[a.type] as
        Record<string, unknown> | undefined) ??
      {};
    const merged: Record<string, unknown> = {
      ...defaults,
      ...(a.fields ?? {}),
    };
    merged["System.Title"] = a.title;
    if (a.description != null)
      merged["System.Description"] =
        /<\/?(p|div|br|ul|ol|li|b|i|em|strong|a|span|h[1-6]|table|tr|td)\b/i.test(
          a.description,
        )
          ? a.description
          : `<div>${a.description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`;
    if (a.tags?.length) merged["System.Tags"] = a.tags.join("; ");

    const patch: JsonPatchOp[] = Object.entries(merged).map(([k, v]) => ({
      op: "add",
      path: `/fields/${k}`,
      value: v,
    }));
    const relation = (rel: string, id: string): JsonPatchOp => ({
      op: "add",
      path: "/relations/-",
      value: {
        rel,
        url: `${client.orgUrl}/_apis/wit/workItems/${id}`,
      },
    });
    if (a.parent_id)
      patch.push(relation("System.LinkTypes.Hierarchy-Reverse", a.parent_id));
    for (const id of a.related_ids ?? [])
      patch.push(relation("System.LinkTypes.Related", id));

    const created = await client.createWorkItem(project, a.type, patch);
    const userId = await resolveCurrentUserId();
    await recordRun({
      userId,
      mode: "create",
      meta: {
        source: target.sourceSlug,
        project,
        type: a.type,
        ado_id: created.id,
      },
    });
    if (a.work_item_id)
      await addWorkItemLink({
        fromWorkItemId: a.work_item_id,
        toSourceProjectId: target.context?.project.id ?? null,
        toExternalId: String(created.id),
        kind: "tracked_by",
        createdById: userId,
      });
    return out({
      created: true,
      id: created.id,
      ...(a.work_item_id ? { linked_to_work_item: a.work_item_id } : {}),
      url:
        created._links?.html?.href ??
        `${client.orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${created.id}`,
    });
  },
);
