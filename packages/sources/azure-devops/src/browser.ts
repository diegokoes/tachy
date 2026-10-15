import type {
  LinkedCode,
  LinkedWorkItem,
  WorkItemFieldInfo,
  WorkItemLayout,
  WorkItemPage,
  WorkItemPeek,
  WorkItemQuery,
  WorkItemReading,
  WorkItemRelations,
  WorkItemRow,
  WorkItemSort,
} from "@tachy/core";
import type {
  AdoClient,
  AdoFields,
  AdoUpdate,
  AdoWorkItem,
  AdoWorkItemSummary,
  AdoWorkItemType,
} from "./client";
import type { FollowedChange, RawWorkItem } from "@tachy/core/sources";
import { projectLayout, readLayout } from "./composer";
import { updateEvents } from "./history";
import { workItemSchema } from "./fields";

const PEEK_FIELDS = [
  "System.Id",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.TeamProject",
];

const LIST_FIELDS = [
  ...PEEK_FIELDS,
  "System.AssignedTo",
  "System.CreatedBy",
  "System.CreatedDate",
  "System.ChangedDate",
];

const SORT_FIELDS: Record<WorkItemSort, string> = {
  changed: "System.ChangedDate",
  created: "System.CreatedDate",
  id: "System.Id",
  title: "System.Title",
  state: "System.State",
  type: "System.WorkItemType",
  assigned: "System.AssignedTo",
};

/** Ids a list query reads at most; the page shown is a slice of them. */
const MAX_LISTED = 1000;

const PROCESS_TTL_MS = 10 * 60 * 1000;

/** Lookups that follow the project's process, kept briefly per organisation. */
const processLookups = new Map<
  string,
  { expiresAt: number; answer: Promise<unknown> }
>();

function keptFor<T>(key: string, load: () => Promise<T>): Promise<T> {
  const kept = processLookups.get(key);
  if (kept && kept.expiresAt > Date.now()) return kept.answer as Promise<T>;
  const answer = load().catch((e) => {
    processLookups.delete(key);
    throw e;
  });
  processLookups.set(key, { expiresAt: Date.now() + PROCESS_TTL_MS, answer });
  return answer;
}

export function clearTypeLists(): void {
  processLookups.clear();
}

const projectTypes = (
  client: AdoClient,
  project: string,
): Promise<AdoWorkItemType[]> =>
  keptFor(`${client.orgUrl}|types|${project}`, () =>
    client.listWorkItemTypes(project),
  );

export const itemUrl = (orgUrl: string, project: string, id: number | string) =>
  `${orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${id}`;

const personName = (identity: unknown): string | null => {
  if (!identity || typeof identity !== "object") return null;
  const { displayName, uniqueName } = identity as Record<string, unknown>;
  if (typeof displayName === "string" && displayName) return displayName;
  return typeof uniqueName === "string" ? uniqueName : null;
};

async function toRows(
  client: AdoClient,
  sourceSlug: string,
  workItems: (AdoWorkItem | null)[],
): Promise<WorkItemRow[]> {
  const found = workItems.filter(
    (workItem): workItem is AdoWorkItem => workItem != null,
  );
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
        assigned_to: personName(fields["System.AssignedTo"]),
        created_by: personName(fields["System.CreatedBy"]),
        created_at: fields["System.CreatedDate"] ?? null,
        changed_at: fields["System.ChangedDate"] ?? null,
      };
    }),
  );
}

/** Ids that are not numbers are left out, like ids ADO does not have. */
export async function peekWorkItems(
  client: AdoClient,
  sourceSlug: string,
  ids: string[],
): Promise<WorkItemPeek[]> {
  const numericIds = ids.filter((id) => /^\d+$/.test(id)).map(Number);
  if (!numericIds.length) return [];
  const rows = await toRows(
    client,
    sourceSlug,
    await client.getWorkItemsBatch(numericIds, PEEK_FIELDS),
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    state: row.state,
    project: row.project,
    url: row.url,
    color: row.color,
    icon: row.icon,
    source_slug: row.source_slug,
  }));
}

/** WIQL takes a string literal in single quotes, a quote inside doubled. */
const wiqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function listWiql(query: WorkItemQuery): string {
  const where = ["[System.TeamProject] = @project"];
  if (query.scope === "assigned") where.push("[System.AssignedTo] = @Me");
  if (query.scope === "created") where.push("[System.CreatedBy] = @Me");
  if (query.scope === "followed") {
    const ids = (query.ids ?? []).filter((id) => /^\d+$/.test(id));
    where.push(`[System.Id] In (${ids.join(", ")})`);
  }
  if (query.type)
    where.push(`[System.WorkItemType] = ${wiqlString(query.type)}`);
  if (query.state) where.push(`[System.State] = ${wiqlString(query.state)}`);
  const text = query.text?.trim();
  if (text) {
    const byTitle = `[System.Title] Contains ${wiqlString(text)}`;
    where.push(
      /^\d+$/.test(text) ? `([System.Id] = ${text} Or ${byTitle})` : byTitle,
    );
  }
  const direction = query.direction === "asc" ? "Asc" : "Desc";
  return `Select [System.Id] From WorkItems Where ${where.join(" And ")} Order By [${SORT_FIELDS[query.sort]}] ${direction}`;
}

export async function listWorkItems(
  client: AdoClient,
  sourceSlug: string,
  project: string,
  query: WorkItemQuery,
): Promise<WorkItemPage> {
  // One more than the cap tells a capped list from one that fits exactly.
  const ids = await client.runWiql(project, listWiql(query), MAX_LISTED + 1);
  const listed = ids.slice(0, MAX_LISTED);
  const pageIds = listed.slice(query.offset, query.offset + query.limit);
  const fetched = pageIds.length
    ? await client.getWorkItemsBatch(pageIds, LIST_FIELDS)
    : [];
  const rows = await toRows(client, sourceSlug, fetched);
  const position = new Map(pageIds.map((id, i) => [String(id), i]));
  rows.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  return { items: rows, total: listed.length, capped: ids.length > MAX_LISTED };
}

/**
 * The type's form as ADO draws it, read-only fields included, with each
 * field's label and type. Without a readable layout, fields still carry names.
 */
export function viewLayout(
  client: AdoClient,
  project: string,
  type: string,
): Promise<WorkItemLayout> {
  return keptFor(`${client.orgUrl}|layout|${project}|${type}`, async () => {
    const info = await client.getProject(project).catch(() => null);
    const [schema, layout] = await Promise.all([
      workItemSchema(client, project, type),
      readLayout(client, info?.id, project, type).catch(() => null),
    ]);
    const projected = layout
      ? projectLayout(layout, schema.fields, { keepReadOnly: true })
      : null;
    const fields: Record<string, WorkItemFieldInfo> = {};
    for (const field of schema.fields)
      fields[field.reference_name] = {
        name: projected?.labels[field.reference_name] ?? field.name,
        ...(field.type ? { type: field.type } : {}),
      };
    return { layout: projected?.layout ?? null, fields };
  });
}

/** `raw.relations` as `fetchItem` resolves them: one level, capped. */
interface ResolvedRelations {
  parent?: AdoWorkItemSummary;
  children?: AdoWorkItemSummary[];
  related?: AdoWorkItemSummary[];
  pull_requests?: Record<string, unknown>[];
  commits?: Record<string, unknown>[];
}

const text = (value: unknown): string | null =>
  value == null || value === "" ? null : String(value);

const linkedItem = (summary: AdoWorkItemSummary): LinkedWorkItem => ({
  id: summary.id,
  title: summary.title ?? null,
  state: summary.state ?? null,
  type: summary.type ?? null,
  url: summary.url ?? "",
});

function linkedPullRequest(pull: Record<string, unknown>): LinkedCode {
  return {
    ref: text(pull.id) ?? text(pull.ref) ?? "",
    title: text(pull.title),
    status: text(pull.status),
    author: null,
    repository: text(pull.repository),
    url: text(pull.url),
    ...(pull.note ? { note: String(pull.note) } : {}),
  };
}

function linkedCommit(commit: Record<string, unknown>): LinkedCode {
  return {
    ref: text(commit.sha) ?? text(commit.ref) ?? "",
    title: text(commit.comment),
    status: null,
    author: text(commit.author),
    repository: null,
    url: text(commit.url),
    ...(commit.note ? { note: String(commit.note) } : {}),
  };
}

export function relationsOf(
  relations: ResolvedRelations = {},
): WorkItemRelations {
  return {
    parent: relations.parent ? linkedItem(relations.parent) : null,
    children: (relations.children ?? []).map(linkedItem),
    related: (relations.related ?? []).map(linkedItem),
    pull_requests: (relations.pull_requests ?? []).map(linkedPullRequest),
    commits: (relations.commits ?? []).map(linkedCommit),
  };
}

/** What the board shows of an item `fetchItem` read. */
export async function itemReading(
  client: AdoClient,
  sourceSlug: string,
  raw: RawWorkItem,
): Promise<WorkItemReading> {
  const { fields = {}, relations } = (raw.raw ?? {}) as {
    fields?: AdoFields;
    relations?: ResolvedRelations;
  };
  const [[item], layout] = await Promise.all([
    toRows(client, sourceSlug, [{ id: Number(raw.externalId), fields }]),
    viewLayout(client, raw.groupKey ?? "", raw.itemType ?? "").catch(
      (): WorkItemLayout => ({ layout: null, fields: {} }),
    ),
  ]);
  return {
    item: { ...item, url: raw.externalUrl ?? item.url },
    fields,
    layout,
    relations: relationsOf(relations),
  };
}

const CHANGE_FIELDS = ["System.Id", "System.Title", "System.TeamProject"];

/** Lines a change note keeps; the item's page has the rest. */
const MAX_CHANGE_LINES = 5;

/** The field's own name without its namespace: `Priority`, not `Microsoft.VSTS.Common.Priority`. */
const shortName = (field: string) => field.split(".").pop() ?? field;

/**
 * What a run of updates changed, one line each: new comments first, then
 * state and assignee from their first value to their last, links, and the
 * names of any other fields.
 */
export function changeLines(updates: AdoUpdate[]): string[] {
  const comments = updates.filter(
    (update) => typeof update.fields?.["System.History"]?.newValue === "string",
  ).length;
  const lines: string[] = [];
  if (comments)
    lines.push(comments === 1 ? "1 new comment" : `${comments} new comments`);
  const spans = new Map<string, { from?: string | null; to?: string | null }>();
  const others = new Set<string>();
  for (const event of updateEvents(updates)) {
    if (event.field === "created") continue;
    if (event.field === "link") {
      lines.push(
        event.newValue
          ? `link added: ${event.newValue}`
          : `link removed: ${event.oldValue}`,
      );
      continue;
    }
    if (event.field !== "status" && event.field !== "assignee") {
      others.add(shortName(event.field));
      continue;
    }
    const span = spans.get(event.field);
    if (span) span.to = event.newValue;
    else spans.set(event.field, { from: event.oldValue, to: event.newValue });
  }
  const status = spans.get("status");
  if (status)
    lines.unshift(`state ${status.from ?? "none"} → ${status.to ?? "none"}`);
  const assignee = spans.get("assignee");
  if (assignee)
    lines.push(assignee.to ? `assigned to ${assignee.to}` : "unassigned");
  if (others.size) lines.push(`also changed: ${[...others].join(", ")}`);
  return lines.slice(0, MAX_CHANGE_LINES);
}

async function readerAccount(client: AdoClient): Promise<string | null> {
  const user = (await client.getConnectionData()).authenticatedUser;
  return user?.properties?.Account?.$value?.toLowerCase() ?? null;
}

export async function followedChanges(
  client: AdoClient,
  followed: { id: string; seenRev: number | null }[],
): Promise<FollowedChange[]> {
  const seenRevs = new Map(followed.map((item) => [item.id, item.seenRev]));
  const ids = followed
    .map((item) => item.id)
    .filter((id) => /^\d+$/.test(id))
    .map(Number);
  if (!ids.length) return [];
  const [workItems, reader] = await Promise.all([
    client.getWorkItemsBatch(ids, CHANGE_FIELDS),
    // Without the reader's name their own changes are reported too.
    readerAccount(client).catch(() => null),
  ]);
  const byOthers = (update: AdoUpdate) =>
    !reader || update.revisedBy?.uniqueName?.toLowerCase() !== reader;
  return Promise.all(
    workItems
      .filter((workItem): workItem is AdoWorkItem => workItem != null)
      .map(async (workItem) => {
        const id = String(workItem.id);
        const rev = workItem.rev ?? 0;
        const fields = workItem.fields ?? {};
        const seenRev = seenRevs.get(id) ?? null;
        const change = {
          id,
          rev,
          title: String(fields["System.Title"] ?? ""),
          url: itemUrl(client.orgUrl, fields["System.TeamProject"] ?? "", id),
        };
        if (seenRev == null || rev <= seenRev) return { ...change, lines: [] };
        const updates = await client.getUpdates(id, rev);
        const newer = updates.filter(
          (update) => (update.rev ?? 0) > seenRev && byOthers(update),
        );
        return { ...change, lines: changeLines(newer) };
      }),
  );
}
