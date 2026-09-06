import { SLUG_RE } from "@tachy/contract";
import { z } from "zod";
import { ARTIFACT_UTILITIES } from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput, forbidden, notFound } from "../infra/errors";
import { tableOutputSchema } from "../exports/table";
import {
  assertCanWriteScope,
  scopeCondition,
  upsertScoped,
  type Scope,
  type ScopeContext,
} from "./scoped";

export const artifactSpecSchema = z
  .object({
    utilities: z.array(z.enum(ARTIFACT_UTILITIES)).optional(),
    output: tableOutputSchema.optional(),
  })
  .strict();
export type ArtifactSpec = z.infer<typeof artifactSpecSchema>;

export interface ArtifactMeta {
  id: string;
  scope: Scope;
  team_id: string | null;
  user_id: string | null;
  slug: string;
  title: string;
  description: string | null;
  spec: ArtifactSpec | null;
  updated_at: string;
}

export interface ArtifactRow extends ArtifactMeta {
  body: string;
}

/** Stored jsonb predates any later schema change, so a spec that no longer parses is dropped, not thrown. */
function readSpec(raw: unknown): ArtifactSpec | null {
  if (!raw) return null;
  const parsed = artifactSpecSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function withSpec<T extends { spec?: unknown }>(row: T): T {
  return { ...row, spec: readSpec(row.spec) };
}

function checkSlug(slug: string): void {
  if (!SLUG_RE.test(slug))
    throw badInput(
      `invalid artifact slug '${slug}' (expected lowercase kebab-case, e.g. 'docs-report')`,
    );
}

function visibleCondition({ userId }: ScopeContext) {
  return sql`
    (scope = 'user' and user_id = ${userId ?? null})
    or (scope = 'team' and team_id in (
      select team_id from team_members where user_id = ${userId ?? null}
    ))
    or scope = 'global'
  `;
}

async function assertCanWriteTeamArtifact(
  userId: string,
  teamId: string,
): Promise<void> {
  const [row] = await sql`
    select 1 from team_members where user_id = ${userId} and team_id = ${teamId} limit 1
  `;
  if (!row) throw forbidden("you must be a member of this team");
}

/** Every artifact the caller can use: own user rows ∪ team rows ∪ global. */
export async function listVisibleArtifacts(
  ctx: ScopeContext,
): Promise<ArtifactMeta[]> {
  const rows = await sql`
    select id, scope, team_id, user_id, slug, title, description, spec, updated_at
    from artifacts
    where ${visibleCondition(ctx)}
    order by case scope when 'user' then 0 when 'team' then 1 else 2 end, title
  `;
  return (rows as unknown as ArtifactMeta[]).map(withSpec);
}

export async function getArtifact(
  id: string,
  ctx: ScopeContext,
): Promise<ArtifactRow> {
  const [row] = await sql`
    select id, scope, team_id, user_id, slug, title, description, body, spec, updated_at
    from artifacts
    where id = ${id} and (${visibleCondition(ctx)})
  `;
  if (!row) throw notFound(`Artifact '${id}' not found`);
  return withSpec(row as unknown as ArtifactRow);
}

/** The caller-visible artifact for `slug`, most specific scope first — the shape `export_table` resolves against. */
export async function getArtifactBySlug(
  slug: string,
  ctx: ScopeContext,
): Promise<ArtifactRow | undefined> {
  const [row] = await sql`
    select id, scope, team_id, user_id, slug, title, description, body, spec, updated_at
    from artifacts
    where slug = ${slug} and (${visibleCondition(ctx)})
    order by case scope when 'user' then 0 when 'team' then 1 else 2 end
    limit 1
  `;
  return row ? withSpec(row as unknown as ArtifactRow) : undefined;
}

export async function upsertArtifact(
  actorUserId: string,
  scope: Scope,
  scopeId: string | undefined,
  slug: string,
  values: {
    title: string;
    description?: string | null;
    body: string;
    spec?: ArtifactSpec | null;
  },
): Promise<void> {
  checkSlug(slug);
  if (scope === "team") {
    if (!scopeId) throw badInput("team scope requires a team id");
    await assertCanWriteTeamArtifact(actorUserId, scopeId);
  } else {
    await assertCanWriteScope(actorUserId, scope, scopeId);
  }
  await upsertScoped("artifacts", scope, scopeId, slug, {
    title: values.title,
    description: values.description ?? null,
    body: values.body,
    spec: values.spec ? sql.json(values.spec as never) : null,
    created_by: actorUserId,
  });
}

export async function deleteArtifact(
  actorUserId: string,
  scope: Scope,
  scopeId: string | undefined,
  slug: string,
): Promise<boolean> {
  if (scope === "team") {
    if (!scopeId) throw badInput("team scope requires a team id");
    await assertCanWriteTeamArtifact(actorUserId, scopeId);
  } else {
    await assertCanWriteScope(actorUserId, scope, scopeId);
  }
  const rows = await sql`
    delete from artifacts
    where ${scopeCondition(scope, scopeId)} and slug = ${slug}
    returning id
  `;
  return rows.length > 0;
}
