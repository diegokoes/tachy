import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import {
  assertCanWriteScope,
  scopeCondition,
  upsertScoped,
  type Scope,
  type ScopeContext,
} from "./scoped";

export interface ArtifactMeta {
  id: string;
  scope: Scope;
  team_id: string | null;
  user_id: string | null;
  slug: string;
  title: string;
  description: string | null;
  updated_at: string;
}

export interface ArtifactRow extends ArtifactMeta {
  body: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function checkSlug(slug: string): void {
  if (!SLUG_RE.test(slug))
    throw badInput(
      `invalid artifact slug '${slug}' (expected lowercase kebab-case, e.g. 'docs-report')`,
    );
}

function visibleCondition({ userId, teamId }: ScopeContext) {
  return sql`
    (scope = 'user' and user_id = ${userId ?? null})
    or (scope = 'team' and team_id = ${teamId ?? null})
    or scope = 'global'
  `;
}

/** Every artifact the caller can use: own user rows ∪ team rows ∪ global. */
export async function listVisibleArtifacts(
  ctx: ScopeContext,
): Promise<ArtifactMeta[]> {
  const rows = await sql`
    select id, scope, team_id, user_id, slug, title, description, updated_at
    from artifacts
    where ${visibleCondition(ctx)}
    order by case scope when 'user' then 0 when 'team' then 1 else 2 end, title
  `;
  return rows as unknown as ArtifactMeta[];
}

export async function getArtifact(
  id: string,
  ctx: ScopeContext,
): Promise<ArtifactRow> {
  const [row] = await sql`
    select id, scope, team_id, user_id, slug, title, description, body, updated_at
    from artifacts
    where id = ${id} and (${visibleCondition(ctx)})
  `;
  if (!row) throw notFound(`Artifact '${id}' not found`);
  return row as unknown as ArtifactRow;
}

export async function upsertArtifact(
  actorUserId: string,
  scope: Scope,
  scopeId: string | undefined,
  slug: string,
  values: { title: string; description?: string | null; body: string },
): Promise<void> {
  checkSlug(slug);
  await assertCanWriteScope(actorUserId, scope, scopeId);
  await upsertScoped("artifacts", scope, scopeId, slug, {
    title: values.title,
    description: values.description ?? null,
    body: values.body,
    created_by: actorUserId,
  });
}

export async function deleteArtifact(
  actorUserId: string,
  scope: Scope,
  scopeId: string | undefined,
  slug: string,
): Promise<boolean> {
  await assertCanWriteScope(actorUserId, scope, scopeId);
  const rows = await sql`
    delete from artifacts
    where ${scopeCondition(scope, scopeId)} and slug = ${slug}
    returning id
  `;
  return rows.length > 0;
}
