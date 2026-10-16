import type { WorkItemPeek } from "@tachy/core";
import type { AdoClient, AdoWorkItem, AdoWorkItemType } from "./client";

const PEEK_FIELDS = [
  "System.Id",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.TeamProject",
];

const TYPE_LIST_TTL_MS = 10 * 60 * 1000;

const typeLists = new Map<
  string,
  { expiresAt: number; types: Promise<AdoWorkItemType[]> }
>();

/** A project's types, kept briefly: a process change reaches the board within the TTL. */
function projectTypes(
  client: AdoClient,
  project: string,
): Promise<AdoWorkItemType[]> {
  const key = `${client.orgUrl}|${project}`;
  const kept = typeLists.get(key);
  if (kept && kept.expiresAt > Date.now()) return kept.types;
  const types = client.listWorkItemTypes(project).catch((e) => {
    typeLists.delete(key);
    throw e;
  });
  typeLists.set(key, { expiresAt: Date.now() + TYPE_LIST_TTL_MS, types });
  return types;
}

export function clearTypeLists(): void {
  typeLists.clear();
}

export const itemUrl = (orgUrl: string, project: string, id: number | string) =>
  `${orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${id}`;

/** Ids that are not numbers are left out, like ids ADO does not have. */
export async function peekWorkItems(
  client: AdoClient,
  sourceSlug: string,
  ids: string[],
): Promise<WorkItemPeek[]> {
  const numericIds = ids.filter((id) => /^\d+$/.test(id)).map(Number);
  if (!numericIds.length) return [];
  const found = (
    await client.getWorkItemsBatch(numericIds, PEEK_FIELDS)
  ).filter((workItem): workItem is AdoWorkItem => workItem != null);
  return Promise.all(
    found.map(async (workItem) => {
      const fields = workItem.fields ?? {};
      const project = String(fields["System.TeamProject"] ?? "");
      const typeName = String(fields["System.WorkItemType"] ?? "");
      // The item still reads when its project's types cannot.
      const types = await projectTypes(client, project).catch(() => []);
      const type = types.find((t) => t.name === typeName);
      return {
        id: String(workItem.id),
        title: String(fields["System.Title"] ?? ""),
        type: typeName,
        state: fields["System.State"] ?? null,
        project,
        url: itemUrl(client.orgUrl, project, workItem.id),
        color: type?.color || null,
        icon: type?.icon?.id || null,
        source_slug: sourceSlug,
      };
    }),
  );
}
