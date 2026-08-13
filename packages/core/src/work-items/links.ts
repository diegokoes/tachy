import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";

export const WORK_ITEM_LINK_KINDS = [
  "tracked_by",
  "duplicates",
  "relates",
] as const;
export type WorkItemLinkKind = (typeof WORK_ITEM_LINK_KINDS)[number];

export interface WorkItemLinkInput {
  fromWorkItemId: string;
  toWorkItemId?: string | null;
  toSourceProjectId?: string | null;
  toExternalId?: string | null;
  kind: WorkItemLinkKind;
  createdById?: string | null;
}

/**
 * Idempotent by (from, kind) and either end of the target: an external-only link
 * tightens into a work-item link once that item is ingested, rather than
 * becoming a second row.
 */
export async function addWorkItemLink(i: WorkItemLinkInput) {
  if (!i.toWorkItemId && !i.toExternalId)
    throw badInput("a link needs either to_work_item_id or to_external_id");
  return sql.begin(async (tx) => {
    const [existing] = await tx`
      select id from work_item_links
      where from_work_item_id = ${i.fromWorkItemId} and kind = ${i.kind}
        and (to_work_item_id = ${i.toWorkItemId ?? null}::uuid
             or to_external_id = ${i.toExternalId ?? null}::text)
      limit 1
    `;
    if (existing) {
      const [row] = await tx`
        update work_item_links set
          to_work_item_id      = coalesce(${i.toWorkItemId ?? null}::uuid, to_work_item_id),
          to_source_project_id = coalesce(${i.toSourceProjectId ?? null}::uuid, to_source_project_id),
          to_external_id       = coalesce(${i.toExternalId ?? null}::text, to_external_id)
        where id = ${existing.id}
        returning id, kind
      `;
      return row;
    }
    const [row] = await tx`
      insert into work_item_links
        (from_work_item_id, to_work_item_id, to_source_project_id, to_external_id, kind, created_by)
      values (${i.fromWorkItemId}, ${i.toWorkItemId ?? null}, ${i.toSourceProjectId ?? null},
              ${i.toExternalId ?? null}, ${i.kind}, ${i.createdById ?? null})
      returning id, kind
    `;
    return row;
  });
}

export async function listWorkItemLinks(workItemId: string) {
  return sql`
    select l.id, l.kind, l.created_at,
           case when l.from_work_item_id = ${workItemId} then 'out' else 'in' end as direction,
           case when l.from_work_item_id = ${workItemId} then l.to_work_item_id else l.from_work_item_id end as work_item_id,
           l.to_external_id as external_id,
           sp.external_key as project_key, sc.slug as source_slug,
           w.title, w.status, w.external_url, w.external_id as target_external_id
    from work_item_links l
    left join source_projects sp on sp.id = l.to_source_project_id
    left join source_connections sc on sc.id = sp.source_connection_id
    left join work_items w on w.id = case
      when l.from_work_item_id = ${workItemId} then l.to_work_item_id else l.from_work_item_id end
    where l.from_work_item_id = ${workItemId} or l.to_work_item_id = ${workItemId}
    order by l.created_at
  `;
}

export async function deleteWorkItemLink(id: string) {
  const [row] =
    await sql`delete from work_item_links where id = ${id} returning id`;
  if (!row) throw notFound(`Work item link '${id}' not found`);
  return { deleted: true, id };
}

/**
 * Persist the Azure DevOps ids found in a ticket. Ids already ingested are
 * linked to their work item row; the rest are kept as (project, external id)
 * and tighten to a row the next time that item is fetched.
 */
export async function recordAdoRefs(
  fromWorkItemId: string,
  externalIds: string[],
  opts: {
    sourceConnectionId?: string | null;
    sourceProjectId?: string | null;
    createdById?: string | null;
  } = {},
): Promise<number> {
  if (!externalIds.length) return 0;
  const ingested = opts.sourceConnectionId
    ? await sql`
        select id, external_id, source_project_id from work_items
        where source_connection_id = ${opts.sourceConnectionId}
          and external_id = any(${externalIds})
      `
    : [];
  let written = 0;
  for (const externalId of externalIds) {
    const hit = ingested.find((r) => r.external_id === externalId);
    await addWorkItemLink({
      fromWorkItemId,
      toWorkItemId: (hit?.id as string) ?? null,
      toSourceProjectId:
        (hit?.source_project_id as string) ?? opts.sourceProjectId ?? null,
      toExternalId: externalId,
      kind: "tracked_by",
      createdById: opts.createdById ?? null,
    });
    written++;
  }
  return written;
}
