import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  badInput,
  forbidden,
  getSourceProject,
  listSourceProjects,
  userTeams,
  type ComposerProject,
  type CreatedTicket,
  type SourceProjectRow,
  type TicketValidation,
} from "@tachy/core";
import {
  composerForm,
  creatableTypes,
  createWorkItem,
  templateValues,
  validateWorkItem,
  workItemDefaults,
  type NewWorkItem,
  type PastedImage,
} from "@tachy/source-azure-devops";
import {
  callerScope,
  callerUserId,
  isAdminIdentity,
  requireCaller,
} from "../authz";
import { adoClientFor } from "../azure-devops";
import { reviewTicket } from "../ticket-review";
import { MAX_UPLOAD_BYTES, tooLarge } from "../upload-limit";

const draftSchema = z.object({
  type: z.string().min(1),
  title: z.string().trim().min(1, "a title is required"),
  fields: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string()).optional(),
  parent_id: z.string().optional(),
  related_ids: z.array(z.string()).optional(),
  work_item_ids: z.array(z.string().uuid()).optional(),
});
type Draft = z.infer<typeof draftSchema>;

const reviewSchema = z.object({
  type: z.string().min(1),
  title: z.string(),
  fields: z
    .array(z.object({ ref: z.string(), name: z.string(), value: z.string() }))
    .max(80)
    .default([]),
  images: z.number().int().min(0).default(0),
  context: z
    .array(
      z.object({
        source: z.string(),
        external_id: z.string(),
        title: z.string(),
        text: z.string().max(20_000),
      }),
    )
    .max(10)
    .default([]),
});

/** The caller's teams, or null for an app admin, who sees every project. */
async function callerTeamIds(c: Context): Promise<Set<string> | null> {
  if (isAdminIdentity(c)) return null;
  const userId = await callerUserId(c);
  if (!userId)
    throw forbidden("no user account is associated with this session");
  return new Set((await userTeams(userId)).map((t) => t.team_id));
}

/**
 * A registered ADO project the caller's team owns. Checked before any remote
 * call, so the PAT is never spent on a project the caller cannot use.
 */
async function ownProject(c: Context, id: string) {
  const project = await getSourceProject(id);
  if (project.source_type !== "azure-devops")
    throw badInput(`'${project.name}' is not an Azure DevOps project`);
  const teams = await callerTeamIds(c);
  if (teams && !teams.has(project.team_id))
    throw forbidden(`'${project.name}' belongs to a team you are not in`);
  const { client, conn } = await adoClientFor(c, project.source_slug);
  return { project, client, conn };
}

const asComposerProject = (p: SourceProjectRow): ComposerProject => ({
  id: p.id,
  name: p.name,
  external_key: p.external_key,
  source_slug: p.source_slug,
  team_slug: p.team_slug,
  product_slug: p.product_slug,
});

/** An ADO team named on the registered project overrides the default team. */
const adoTeamOf = (p: SourceProjectRow) =>
  typeof p.config?.team === "string" && p.config.team ? p.config.team : null;

function toNewWorkItem(
  project: SourceProjectRow,
  connConfig: Record<string, unknown>,
  d: Draft,
  images: PastedImage[] = [],
): NewWorkItem {
  return {
    project: project.external_key,
    type: d.type,
    title: d.title,
    fields: d.fields,
    defaults: workItemDefaults(
      connConfig,
      project.external_key,
      d.type,
      project.config,
    ),
    tags: d.tags,
    parentId: d.parent_id,
    relatedIds: d.related_ids,
    images,
  };
}

/**
 * ADO's rule errors name fields in prose: "Rule Error for field Severity",
 * "field 'System.AreaPath'". Pulled out so the form can mark them.
 */
export function explainAdoError(raw: string): TicketValidation {
  const json = raw.slice(raw.indexOf("{"));
  let message = raw;
  try {
    const parsed = JSON.parse(json) as { message?: string };
    if (parsed.message) message = parsed.message;
  } catch {
    message = raw.replace(/^Azure DevOps \S+ \S+ -> \d+ /, "");
  }
  const fields = new Set<string>();
  for (const m of message.matchAll(/field '([^']+)'/g)) fields.add(m[1]);
  for (const m of message.matchAll(/for field ([^.'"]+?)\./g))
    fields.add(m[1].trim());
  return {
    ok: false,
    message,
    ...(fields.size ? { fields: [...fields] } : {}),
  };
}

export const azure = new Hono()

  .post("/review", zValidator("json", reviewSchema), async (c) => {
    const userId = await requireCaller(c);
    return c.json(
      await reviewTicket(c.req.valid("json"), await callerScope(c), userId),
    );
  })

  .get("/projects", async (c) => {
    const teams = await callerTeamIds(c);
    const rows = (await listSourceProjects()).filter(
      (p) =>
        p.source_type === "azure-devops" && (!teams || teams.has(p.team_id)),
    );
    return c.json(rows.map(asComposerProject));
  })

  .get("/projects/:id/types", async (c) => {
    const { project, client } = await ownProject(c, c.req.param("id"));
    return c.json(await creatableTypes(client, project.external_key));
  })

  .get("/projects/:id/form", async (c) => {
    const type = c.req.query("type");
    if (!type) throw badInput("type is required");
    const { project, client, conn } = await ownProject(c, c.req.param("id"));
    return c.json(
      await composerForm(client, project.external_key, type, {
        team: adoTeamOf(project),
        configDefaults: workItemDefaults(
          conn.config,
          project.external_key,
          type,
          project.config,
        ),
      }),
    );
  })

  .get("/projects/:id/templates/:template", async (c) => {
    const team = c.req.query("team");
    if (!team) throw badInput("team is required");
    const { project, client } = await ownProject(c, c.req.param("id"));
    return c.json(
      await templateValues(
        client,
        project.external_key,
        team,
        c.req.param("template"),
      ),
    );
  })

  .post(
    "/projects/:id/validate",
    zValidator("json", draftSchema),
    async (c) => {
      const { project, client, conn } = await ownProject(c, c.req.param("id"));
      try {
        await validateWorkItem(
          client,
          toNewWorkItem(project, conn.config, c.req.valid("json")),
        );
        return c.json({ ok: true } satisfies TicketValidation);
      } catch (e) {
        return c.json(
          explainAdoError(e instanceof Error ? e.message : String(e)),
        );
      }
    },
  )

  /*
   * Multipart, because pasted images travel with the draft: a `draft` JSON part
   * and one `image:<key>` file per image the HTML fields refer to.
   */
  .post("/projects/:id/items", async (c) => {
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES) throw tooLarge(declared);
    const { project, client, conn } = await ownProject(c, c.req.param("id"));
    const body = await c.req.parseBody();
    if (typeof body.draft !== "string")
      throw badInput("expected a 'draft' part");
    const parsed = draftSchema.safeParse(JSON.parse(body.draft));
    if (!parsed.success)
      throw badInput(parsed.error.issues.map((i) => i.message).join("; "));
    const draft = parsed.data;

    const images: PastedImage[] = [];
    for (const [name, value] of Object.entries(body)) {
      if (!name.startsWith("image:") || !(value instanceof File)) continue;
      images.push({
        key: name.slice("image:".length),
        name: value.name || "pasted.png",
        bytes: new Uint8Array(await value.arrayBuffer()),
      });
    }

    const created = await createWorkItem(
      client,
      toNewWorkItem(project, conn.config, draft, images),
      {
        sourceSlug: project.source_slug,
        userId: await callerUserId(c),
        sourceProjectId: project.id,
        workItemIds: draft.work_item_ids,
      },
    );
    return c.json({
      id: created.id,
      url: created.url,
      title: draft.title,
      type: draft.type,
      project: project.external_key,
    } satisfies CreatedTicket);
  });
