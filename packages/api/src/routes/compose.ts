import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  applyFormConfig,
  badInput,
  FIELD_SHOWS,
  forbidden,
  getComposeConfig,
  getSourceProject,
  listSourceProjects,
  offeredTypes,
  resolveSource,
  setComposeConfig,
  sourceProjectScope,
  typeConfig,
  userTeams,
  type ComposeConfig,
  type ComposerProject,
  type CreatedTicket,
  type NewWorkItem,
  type PastedImage,
  type SourceProjectRow,
} from "@tachy/core";
import {
  assertScopeEditor,
  callerScope,
  callerUserId,
  isAdminIdentity,
  requireCaller,
} from "../authz";
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
  /** The project, when known, so the team's guidance for the type applies. */
  project_id: z.string().uuid().optional(),
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

const fieldDefault = z.union([
  z.object({ macro: z.literal("@me") }).strict(),
  z.object({ value: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
]);

const configSchema = z
  .object({
    types: z.array(z.string().min(1)).max(100).optional(),
    forms: z
      .record(
        z.string(),
        z
          .object({
            fields: z
              .record(
                z.string(),
                z
                  .object({
                    show: z.enum(FIELD_SHOWS).optional(),
                    default: fieldDefault.optional(),
                  })
                  .strict(),
              )
              .optional(),
            order: z.array(z.string()).max(500).optional(),
            guidance: z.string().max(4000).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

/** The caller's teams, or null for an app admin, who sees every project. */
async function callerTeamIds(c: Context): Promise<Set<string> | null> {
  if (isAdminIdentity(c)) return null;
  const userId = await callerUserId(c);
  if (!userId)
    throw forbidden("no user account is associated with this session");
  return new Set((await userTeams(userId)).map((t) => t.team_id));
}

async function assertMember(c: Context, project: SourceProjectRow) {
  const teams = await callerTeamIds(c);
  if (teams && !teams.has(project.team_id))
    throw forbidden(`'${project.name}' belongs to a team you are not in`);
}

/**
 * A registered project the caller's team owns, and its source's composer with
 * the caller's own credential. Checked before any remote call, so a token is
 * never spent on a project the caller cannot use.
 */
async function composeIn(c: Context, id: string) {
  const project = await getSourceProject(id);
  await assertMember(c, project);
  let source;
  try {
    ({ source } = await resolveSource(
      project.source_slug,
      await callerScope(c),
    ));
  } catch (e) {
    // An adapter's env fallback names server variables the person cannot set.
    if (e instanceof Error && e.message.startsWith("Missing"))
      throw badInput(
        `No token for '${project.source_slug}'. Add yours under Settings › credentials, or ask an admin to set the connection's.`,
      );
    throw e;
  }
  if (!source.composer)
    throw badInput(
      `${project.source_type} projects cannot have items created from tachy yet`,
    );
  return { project, composer: source.composer };
}

const asComposerProject = (p: SourceProjectRow): ComposerProject => ({
  id: p.id,
  name: p.name,
  external_key: p.external_key,
  source_slug: p.source_slug,
  source_type: p.source_type,
  team_slug: p.team_slug,
  product_slug: p.product_slug,
});

function toNewItem(
  project: SourceProjectRow,
  d: Draft,
  images: PastedImage[] = [],
): NewWorkItem {
  return {
    project: project.external_key,
    type: d.type,
    title: d.title,
    fields: d.fields,
    tags: d.tags,
    parentId: d.parent_id,
    relatedIds: d.related_ids,
    images,
  };
}

export const compose = new Hono()

  .post("/review", zValidator("json", reviewSchema), async (c) => {
    const userId = await requireCaller(c);
    const { project_id, ...draft } = c.req.valid("json");
    let guidance: string | undefined;
    if (project_id) {
      await assertMember(c, await getSourceProject(project_id));
      guidance = typeConfig(
        await getComposeConfig(project_id),
        draft.type,
      )?.guidance;
    }
    return c.json(
      await reviewTicket({ ...draft, guidance }, await callerScope(c), userId),
    );
  })

  /** `source_type` narrows to one source's projects, for its command group. */
  .get("/projects", async (c) => {
    const teams = await callerTeamIds(c);
    const type = c.req.query("source_type");
    const rows = (await listSourceProjects()).filter(
      (p) =>
        (!type || p.source_type === type) && (!teams || teams.has(p.team_id)),
    );
    return c.json(rows.map(asComposerProject));
  })

  /** `all=1` skips the team's type selection, for the editor that makes it. */
  .get("/projects/:id/types", async (c) => {
    const { project, composer } = await composeIn(c, c.req.param("id"));
    const types = await composer.types(project.external_key);
    return c.json(
      c.req.query("all")
        ? types
        : offeredTypes(types, await getComposeConfig(project.id)),
    );
  })

  /** `raw=1` is the source's own form, before the team's config. */
  .get("/projects/:id/form", async (c) => {
    const type = c.req.query("type");
    if (!type) throw badInput("type is required");
    const { project, composer } = await composeIn(c, c.req.param("id"));
    const form = await composer.form(project.external_key, type, {
      projectConfig: project.config,
    });
    return c.json(
      c.req.query("raw")
        ? form
        : applyFormConfig(
            form,
            typeConfig(await getComposeConfig(project.id), type),
          ),
    );
  })

  .get("/projects/:id/templates/:template", async (c) => {
    const team = c.req.query("team");
    if (!team) throw badInput("team is required");
    const { project, composer } = await composeIn(c, c.req.param("id"));
    if (!composer.template) return c.json({});
    return c.json(
      await composer.template(
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
      const { project, composer } = await composeIn(c, c.req.param("id"));
      if (!composer.validate) return c.json({ ok: true });
      return c.json(
        await composer.validate(
          toNewItem(project, c.req.valid("json")),
          project.config,
        ),
      );
    },
  )

  /*
   * Multipart, because pasted images travel with the draft: a `draft` JSON part
   * and one `image:<key>` file per image the HTML fields refer to.
   */
  .post("/projects/:id/items", async (c) => {
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES) throw tooLarge(declared);
    const { project, composer } = await composeIn(c, c.req.param("id"));
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

    const created = await composer.create(
      toNewItem(project, draft, images),
      {
        sourceSlug: project.source_slug,
        userId: await callerUserId(c),
        sourceProjectId: project.id,
        workItemIds: draft.work_item_ids,
      },
      project.config,
    );
    return c.json({
      id: created.id,
      url: created.url,
      title: draft.title,
      type: draft.type,
      project: project.external_key,
    } satisfies CreatedTicket);
  })

  /** The team's form config, for the flows editor. Its editors only. */
  .get("/projects/:id/config", async (c) => {
    const id = c.req.param("id");
    await assertScopeEditor(c, await sourceProjectScope(id));
    return c.json(await getComposeConfig(id));
  })

  .put("/projects/:id/config", zValidator("json", configSchema), async (c) => {
    const id = c.req.param("id");
    await assertScopeEditor(c, await sourceProjectScope(id));
    return c.json(
      await setComposeConfig(id, c.req.valid("json") as ComposeConfig),
    );
  });
