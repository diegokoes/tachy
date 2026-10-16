import { badInput, errorText } from "@tachy/core/infra";
import {
  changeTagList,
  listSourceProjects,
  stripHtml,
} from "@tachy/core/sources";
import {
  customerStandIn,
  scrubbableCopy,
  scrubStrings,
  TokenMap,
} from "@tachy/core/compliance";
import type {
  WorkItemComposer,
  WorkItemSource,
  RawAttachment,
  RawWorkItem,
  RawMessage,
  ListOptions,
  SourceFactory,
} from "@tachy/core/sources";
import {
  followedChanges,
  itemReading,
  itemUrl,
  listWorkItems,
  peekWorkItems,
  viewLayout,
} from "./browser";
import { composerForm, creatableTypes, templateValues } from "./composer";
import { createWorkItem, explainAdoError, validateWorkItem } from "./create";
import { workItemDefaults } from "./fields";
import { updateEvents } from "./history";
import {
  createAdoClient,
  type AdoComment,
  type AdoRelation,
  type AdoWorkItem,
  type AdoWorkItemSummary,
} from "./client";

const RELATED_CAP = 15;
const ARTIFACT_CAP = 10;
const SYNC_PAGE = 200;

function relationWorkItemId(url: string): number | null {
  const match = url.match(/\/workItems\/(\d+)$/i);
  return match ? Number(match[1]) : null;
}

/**
 * A PR or commit link on a work item. Its last segment is the project, the
 * repo and the id or sha, joined by encoded slashes.
 */
function parseGitArtifact(url: string): {
  kind: "pr" | "commit";
  project: string;
  repo: string;
  ref: string;
} | null {
  const pullRequest = url.match(/^vstfs:\/\/\/Git\/PullRequestId\/(.+)$/i);
  const commit = url.match(/^vstfs:\/\/\/Git\/Commit\/(.+)$/i);
  const raw = pullRequest?.[1] ?? commit?.[1];
  if (!raw) return null;
  const parts = decodeURIComponent(raw).split("/");
  if (parts.length !== 3) return null;
  return {
    kind: pullRequest ? "pr" : "commit",
    project: parts[0],
    repo: parts[1],
    ref: parts[2],
  };
}

/** An attachment's address ends in its id, and may name the file. */
const ATTACHMENT_URL =
  /\/_apis\/wit\/attachments\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\?(.*))?$/i;

const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;

/**
 * The attachment an address names, when it is one of this organisation's. An
 * address elsewhere is never an attachment: the token must not follow it.
 */
function attachmentAt(
  url: string,
  orgUrl: string,
): { id: string; fileName?: string } | null {
  if (!url.toLowerCase().startsWith(`${orgUrl.toLowerCase()}/`)) return null;
  const match = ATTACHMENT_URL.exec(url);
  if (!match) return null;
  const fileName = new URLSearchParams(match[2] ?? "").get("fileName");
  return { id: match[1].toLowerCase(), ...(fileName ? { fileName } : {}) };
}

/** The files linked to a work item as attachments. */
export function attachedFiles(
  relations: AdoRelation[],
  orgUrl: string,
): RawAttachment[] {
  const files: RawAttachment[] = [];
  for (const relation of relations) {
    if (relation.rel !== "AttachedFile") continue;
    const at = attachmentAt(relation.url ?? "", orgUrl);
    if (!at) continue;
    const { name, resourceSize } = relation.attributes ?? {};
    files.push({
      id: at.id,
      name: typeof name === "string" && name ? name : (at.fileName ?? at.id),
      ...(typeof resourceSize === "number" ? { sizeBytes: resourceSize } : {}),
    });
  }
  return files;
}

/** The pictures pasted into an HTML field: each is an attachment its `img` names. */
export function inlineImages(html: string, orgUrl: string): RawAttachment[] {
  const images: RawAttachment[] = [];
  for (const [, src] of html.matchAll(IMG_SRC)) {
    const at = attachmentAt(src.replace(/&amp;/g, "&"), orgUrl);
    if (!at || images.some((image) => image.id === at.id)) continue;
    images.push({ id: at.id, name: at.fileName ?? "image.png", inline: true });
  }
  return images;
}

function scrubIdentity(identity: unknown, map: TokenMap, name: string): void {
  if (!identity || typeof identity !== "object") return;
  const id = identity as Record<string, any>;
  if (id.displayName != null) id.displayName = name;
  if (id.uniqueName != null && typeof id.uniqueName === "string")
    id.uniqueName = map.token("EMAIL", id.uniqueName);
  if (id.imageUrl != null) delete id.imageUrl;
  if (id.descriptor != null) delete id.descriptor;
}

const IDENTITY_FIELD_RE =
  /(CreatedBy|AssignedTo|ChangedBy|ClosedBy|ResolvedBy|ActivatedBy|AuthorizedAs|StateChangedBy)$/;

function redactAdoRaw(
  raw: unknown,
  map: TokenMap,
  customerSlug: string | null,
): unknown {
  const copy = scrubbableCopy(raw);
  if (!copy) return {};
  const name = customerStandIn(customerSlug);
  const fields = copy.fields as Record<string, any> | undefined;
  if (fields && typeof fields === "object") {
    const keys = Object.keys(fields);
    for (const key of keys.filter((k) => IDENTITY_FIELD_RE.test(k)))
      scrubIdentity(fields[key], map, name);
    scrubStrings(
      fields,
      keys.filter((k) => !IDENTITY_FIELD_RE.test(k)),
      map,
    );
  }
  const relations = copy.relations as Record<string, any> | undefined;
  if (relations && typeof relations === "object") {
    for (const group of Object.values(relations)) {
      for (const item of Array.isArray(group) ? group : [group]) {
        if (!item || typeof item !== "object") continue;
        scrubStrings(item, ["title", "comment"], map);
        if (typeof item.author === "string")
          item.author = map.token("USER", item.author);
      }
    }
  }
  return copy;
}

/**
 * Azure DevOps work item adapter (PAT auth, org-wide ids). base_url is
 * https://dev.azure.com/<org>; the projects to sync are the `source_projects`
 * registered against this connection with a product.
 * Read-only: ADO comments have no private flag, so postNote is unsupported.
 */
export const createAzureDevopsSource: SourceFactory = (
  connection,
): WorkItemSource => {
  const client = createAdoClient(connection);
  const configuredProjects = Array.isArray(connection.config.projects)
    ? (connection.config.projects as string[])
    : [];

  /**
   * The registry is the source of truth: a project registered in the admin UI
   * is what gets synced. `config.projects` stays as a fallback for connections
   * that predate the registry, which would otherwise sync nothing.
   */
  async function syncProjects(): Promise<string[]> {
    const registered = await listSourceProjects({
      sourceSlug: connection.slug,
      hasProduct: true,
    });
    return registered.length
      ? [...new Set(registered.map((r) => r.external_key))]
      : configuredProjects;
  }

  function toItem(
    workItem: AdoWorkItem,
    messages: RawMessage[],
    relations?: Record<string, unknown>,
  ): RawWorkItem {
    const fields = workItem.fields ?? {};
    const createdBy = fields["System.CreatedBy"];
    const uniqueName =
      typeof createdBy?.uniqueName === "string" ? createdBy.uniqueName : "";
    return {
      externalId: String(workItem.id),
      externalUrl:
        workItem._links?.html?.href ??
        itemUrl(client.orgUrl, fields["System.TeamProject"] ?? "", workItem.id),
      kind: "work_item",
      title: fields["System.Title"],
      status: fields["System.State"],
      groupKey: fields["System.TeamProject"],
      areaPath: fields["System.AreaPath"],
      assignee: fields["System.AssignedTo"]?.displayName,
      priority: fields["Microsoft.VSTS.Common.Priority"]?.toString(),
      itemType: fields["System.WorkItemType"],
      requester: createdBy?.displayName ?? uniqueName ?? undefined,
      requesterEmail: uniqueName.includes("@") ? uniqueName : undefined,
      raw: {
        fields,
        work_item_type: fields["System.WorkItemType"],
        ...(relations ? { relations } : {}),
      },
      sourceCreatedAt: fields["System.CreatedDate"],
      sourceUpdatedAt: fields["System.ChangedDate"],
      messages,
    };
  }

  async function resolveRelations(
    workItem: AdoWorkItem,
    project: string,
  ): Promise<Record<string, unknown>> {
    const rels: AdoRelation[] = Array.isArray(workItem.relations)
      ? workItem.relations
      : [];
    const parentIds: number[] = [];
    const childIds: number[] = [];
    const relatedIds: number[] = [];
    const artifacts: {
      kind: "pr" | "commit";
      project: string;
      repo: string;
      ref: string;
    }[] = [];

    for (const rel of rels) {
      const url = typeof rel.url === "string" ? rel.url : "";
      if (rel.rel === "ArtifactLink") {
        const art = parseGitArtifact(url);
        if (art && artifacts.length < ARTIFACT_CAP) artifacts.push(art);
        continue;
      }
      const id = relationWorkItemId(url);
      if (id == null) continue;
      if (rel.rel === "System.LinkTypes.Hierarchy-Reverse") parentIds.push(id);
      else if (rel.rel === "System.LinkTypes.Hierarchy-Forward")
        childIds.push(id);
      else relatedIds.push(id);
    }

    const allIds = [...parentIds, ...childIds, ...relatedIds].slice(
      0,
      RELATED_CAP,
    );
    const summaries = new Map<number, AdoWorkItemSummary>();
    if (allIds.length) {
      const fetched = await client.getWorkItemsBatch(allIds, [
        "System.Id",
        "System.Title",
        "System.State",
        "System.WorkItemType",
      ]);
      for (const summary of fetched) {
        summaries.set(Number(summary.id), {
          id: Number(summary.id),
          title: summary.fields?.["System.Title"],
          state: summary.fields?.["System.State"],
          type: summary.fields?.["System.WorkItemType"],
          url: `${client.orgUrl}/_workitems/edit/${summary.id}`,
        });
      }
    }
    const pick = (ids: number[]) =>
      ids.map((id) => summaries.get(id)).filter(Boolean);

    const resolved = await Promise.all(
      artifacts.map(async (art) => {
        try {
          if (art.kind === "pr") {
            const pullRequest = await client.getPullRequest(
              art.project,
              art.repo,
              art.ref,
            );
            return {
              kind: art.kind,
              value: {
                id: pullRequest.pullRequestId,
                title: pullRequest.title,
                status: pullRequest.status,
                repository: pullRequest.repository?.name,
                url: `${client.orgUrl}/${encodeURIComponent(pullRequest.repository?.project?.name ?? project)}/_git/${encodeURIComponent(pullRequest.repository?.name ?? "")}/pullrequest/${pullRequest.pullRequestId}`,
              },
            };
          }
          const commit = await client.getCommit(art.project, art.repo, art.ref);
          return {
            kind: art.kind,
            value: {
              sha: commit.commitId,
              comment: commit.comment,
              author: commit.author?.name,
              url: commit.remoteUrl,
            },
          };
        } catch {
          return {
            kind: art.kind,
            value: {
              ref: art.ref,
              note: "linked but not readable with this PAT",
            },
          };
        }
      }),
    );
    const pullRequests = resolved
      .filter((r) => r.kind === "pr")
      .map((r) => r.value);
    const commits = resolved
      .filter((r) => r.kind === "commit")
      .map((r) => r.value);

    const relationSummary: Record<string, unknown> = {};
    if (parentIds.length) relationSummary.parent = pick(parentIds)[0];
    if (childIds.length) relationSummary.children = pick(childIds);
    if (relatedIds.length) relationSummary.related = pick(relatedIds);
    if (pullRequests.length) relationSummary.pull_requests = pullRequests;
    if (commits.length) relationSummary.commits = commits;
    return relationSummary;
  }

  /**
   * The item as messages: its description, its repro steps and its comments,
   * each with the pictures pasted into it. Attached files belong to the item
   * and not to a message, so they ride on the first one.
   */
  async function itemComments(workItem: AdoWorkItem): Promise<AdoComment[]> {
    const project = workItem.fields?.["System.TeamProject"];
    return project ? client.getComments(project, String(workItem.id)) : [];
  }

  function itemMessages(
    workItem: AdoWorkItem,
    comments: AdoComment[],
  ): RawMessage[] {
    const fields = workItem.fields ?? {};
    const opener = fields["System.CreatedBy"]?.displayName;
    const opened = fields["System.CreatedDate"];
    const messages: RawMessage[] = [];
    const fromHtml = (
      externalId: string,
      html: string,
      message: Partial<RawMessage> & { lead?: string },
    ) => {
      const { lead = "", ...rest } = message;
      const images = inlineImages(html, client.orgUrl);
      messages.push({
        externalId,
        visibility: "internal",
        direction: "incoming",
        bodyText: lead + stripHtml(html),
        ...(images.length ? { attachments: images } : {}),
        ...rest,
      });
    };

    const description = fields["System.Description"];
    if (typeof description === "string" && description.trim())
      fromHtml(`desc-${workItem.id}`, description, {
        author: opener,
        createdAt: opened,
      });
    const repro = fields["Microsoft.VSTS.TCM.ReproSteps"];
    if (typeof repro === "string" && repro.trim())
      fromHtml(`repro-${workItem.id}`, repro, {
        author: opener,
        createdAt: opened,
        lead: "Repro steps:\n",
      });

    const files = attachedFiles(workItem.relations ?? [], client.orgUrl);
    if (files.length && !messages.length)
      messages.push({
        externalId: `files-${workItem.id}`,
        author: opener,
        visibility: "internal",
        direction: "incoming",
        bodyText: "",
        createdAt: opened,
      });
    if (files.length)
      messages[0].attachments = [...(messages[0].attachments ?? []), ...files];

    for (const comment of comments)
      fromHtml(
        `comment-${comment.id}`,
        comment.renderedText ?? comment.text ?? "",
        {
          author: comment.createdBy?.displayName,
          createdAt: comment.createdDate,
        },
      );
    return messages.sort((a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
    );
  }

  async function readWhole(
    externalId: string,
  ): Promise<{ item: RawWorkItem; comments: AdoComment[] }> {
    const workItem = await client.getWorkItem(externalId);
    const comments = await itemComments(workItem);
    const messages = itemMessages(workItem, comments);
    const project = workItem.fields?.["System.TeamProject"];
    const relations = await resolveRelations(workItem, project ?? "");
    // Best effort: the item reads without its history.
    const updates = await client
      .getUpdates(externalId, workItem.rev)
      .catch(() => null);
    const item = {
      ...toItem(workItem, messages, relations),
      ...(updates
        ? { events: updateEvents(updates), historyComplete: true as const }
        : {}),
    };
    return { item, comments };
  }

  const fetchItem = async (externalId: string): Promise<RawWorkItem> =>
    (await readWhole(externalId)).item;

  const defaultsFor = (
    project: string,
    type: string,
    projectConfig?: Record<string, unknown>,
  ) => workItemDefaults(connection.config, project, type, projectConfig);

  const composer: WorkItemComposer = {
    types: (project) => creatableTypes(client, project),
    form: (project, type, opts) =>
      composerForm(client, project, type, {
        team:
          typeof opts.projectConfig?.team === "string" &&
          opts.projectConfig.team
            ? opts.projectConfig.team
            : null,
        configDefaults: defaultsFor(project, type, opts.projectConfig),
      }),
    template: (project, team, id) => templateValues(client, project, team, id),
    async validate(item, projectConfig) {
      try {
        await validateWorkItem(client, {
          ...item,
          defaults: defaultsFor(item.project, item.type, projectConfig),
        });
        return { ok: true };
      } catch (e) {
        return explainAdoError(errorText(e));
      }
    },
    create: (item, ctx, projectConfig) =>
      createWorkItem(
        client,
        {
          ...item,
          defaults: defaultsFor(item.project, item.type, projectConfig),
        },
        ctx,
      ),
  };

  return {
    type: "azure-devops",
    capabilities: { postNote: false, incrementalSync: true },
    redactRaw: redactAdoRaw,
    composer,
    browser: {
      peek: (ids) => peekWorkItems(client, connection.slug, ids),
      list: (project, query) =>
        listWorkItems(client, connection.slug, project, query),
      layout: (project, type) => viewLayout(client, project, type),
      changes: (followed) => followedChanges(client, followed),
      async read(id) {
        const { item, comments } = await readWhole(id);
        return {
          raw: item,
          view: await itemReading(client, connection.slug, item, comments),
        };
      },
    },

    async verify() {
      // connectionData is a preview endpoint and only names the caller, so a
      // failure there must not fail the check - the project list is the proof.
      const [conn, projects] = await Promise.all([
        client.getConnectionData().catch(() => null),
        client.listProjects(),
      ]);
      const user = conn?.authenticatedUser;
      return {
        identity:
          user?.providerDisplayName ?? user?.properties?.Account?.$value,
        groups: projects.map((p) => ({ key: p.name, name: p.name })),
      };
    },

    fetchItem,

    async openAttachment(externalId, attachmentId) {
      const workItem = await client.getWorkItem(externalId);
      const file = itemMessages(workItem, await itemComments(workItem))
        .flatMap((message) => message.attachments ?? [])
        .find((listed) => listed.id === attachmentId.toLowerCase());
      if (!file)
        throw badInput(
          `work item ${externalId} lists no file '${attachmentId}'`,
        );
      const response = await client.openAttachment(file.id);
      const length = Number(response.headers.get("content-length"));
      return {
        name: file.name,
        sizeBytes: file.sizeBytes ?? (length > 0 ? length : undefined),
        body: response.body!,
      };
    },

    async setTags(externalId, change) {
      const workItem = await client.getWorkItem(externalId);
      const current = String(workItem.fields?.["System.Tags"] ?? "")
        .split(";")
        .map((t) => t.trim())
        .filter(Boolean);
      const tags = changeTagList(current, change);
      // `add` on System.Tags appends to what is there; `replace` sets the list.
      await client.updateWorkItem(externalId, [
        ...(workItem.rev != null
          ? [{ op: "test" as const, path: "/rev", value: workItem.rev }]
          : []),
        {
          op: current.length ? "replace" : "add",
          path: "/fields/System.Tags",
          value: tags.join("; "),
        },
      ]);
      return tags;
    },

    async listItems(opts: ListOptions) {
      const projects = opts.groupKey ? [opts.groupKey] : await syncProjects();
      if (projects.length === 0) {
        throw new Error(
          "azure-devops sync needs a project: pass --group=<project>, or register one against this connection in the admin UI",
        );
      }
      const cursor = opts.cursor
        ? (JSON.parse(opts.cursor) as { p: number; since?: string })
        : { p: 0, since: opts.updatedSince };
      if (cursor.p >= projects.length) return { items: [] };

      const project = projects[cursor.p];
      const ids = await client.queryWorkItemIds(
        project,
        cursor.since,
        SYNC_PAGE,
      );
      const fetched = ids.length ? await client.getWorkItemsBatch(ids) : [];
      const items = fetched.map((workItem): RawWorkItem => ({
        ...toItem(workItem, []),
        listed: true,
      }));

      // ChangedDate watermark cursor: the >= query re-fetches boundary items,
      // which the ingest upsert dedupes; a full page that fails to advance the
      // watermark (identical timestamps) is bumped 1ms to guarantee progress.
      let next =
        cursor.p + 1 < projects.length
          ? { p: cursor.p + 1, since: opts.updatedSince }
          : undefined;
      if (ids.length === SYNC_PAGE) {
        const changed = fetched
          .map((workItem) =>
            Date.parse(workItem.fields?.["System.ChangedDate"] ?? ""),
          )
          .filter(Number.isFinite);
        const prev = cursor.since ? Date.parse(cursor.since) : Number.NaN;
        // A full page means this project has more to walk, so the cursor stays
        // on it: moving to the next project would drop the rest of its backlog.
        let mark = changed.length ? Math.max(...changed) : prev;
        if (Number.isFinite(prev) && !(mark > prev)) mark = prev + 1;
        if (!Number.isFinite(mark))
          // Nothing to advance to: continuing would walk this page forever and
          // skipping would lose the backlog behind it. System.ChangedDate is a
          // required field, so this is the API misbehaving.
          throw new Error(
            `Azure DevOps returned ${SYNC_PAGE} work items for '${project}' with no readable System.ChangedDate - cannot advance the sync cursor`,
          );
        next = { p: cursor.p, since: new Date(mark).toISOString() };
      }
      return { items, ...(next ? { nextCursor: JSON.stringify(next) } : {}) };
    },
  };
};
