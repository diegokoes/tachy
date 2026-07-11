import { scrubText, TokenMap } from "@tachy/core";
import type {
  WorkItemSource,
  RawWorkItem,
  RawMessage,
  ListOptions,
  SourceFactory,
} from "@tachy/core";
import { createAdoClient, type AdoWorkItemSummary } from "./client";

export { createAdoClient } from "./client";
export type { AdoClient, AdoCfg, JsonPatchOp } from "./client";

const RELATED_CAP = 15;
const ARTIFACT_CAP = 10;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function relationWorkItemId(url: string): number | null {
  const m = url.match(/\/workItems\/(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function parseGitArtifact(
  url: string,
): {
  kind: "pr" | "commit";
  project: string;
  repo: string;
  ref: string;
} | null {
  const pr = url.match(/^vstfs:\/\/\/Git\/PullRequestId\/(.+)$/i);
  const commit = url.match(/^vstfs:\/\/\/Git\/Commit\/(.+)$/i);
  const raw = pr?.[1] ?? commit?.[1];
  if (!raw) return null;
  const parts = decodeURIComponent(raw).split("/");
  if (parts.length !== 3) return null;
  return {
    kind: pr ? "pr" : "commit",
    project: parts[0],
    repo: parts[1],
    ref: parts[2],
  };
}

function scrubIdentity(v: unknown, map: TokenMap, name: string): void {
  if (!v || typeof v !== "object") return;
  const id = v as Record<string, any>;
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
  if (raw == null || typeof raw !== "object") return {};
  const t = structuredClone(raw) as Record<string, any>;
  const name = customerSlug || "[CUSTOMER]";
  const fields = t.fields as Record<string, any> | undefined;
  if (fields && typeof fields === "object") {
    for (const k of Object.keys(fields)) {
      if (IDENTITY_FIELD_RE.test(k)) scrubIdentity(fields[k], map, name);
      else if (typeof fields[k] === "string")
        fields[k] = scrubText(fields[k], map);
    }
  }
  const relations = t.relations as Record<string, any> | undefined;
  if (relations && typeof relations === "object") {
    for (const group of Object.values(relations)) {
      if (!Array.isArray(group)) continue;
      for (const item of group) {
        if (item && typeof item === "object" && typeof item.title === "string")
          item.title = scrubText(item.title, map);
      }
    }
  }
  return t;
}

/**
 * Azure DevOps work item adapter (PAT auth, org-wide ids). base_url is
 * https://dev.azure.com/<org>; config.projects lists projects to sync.
 * Read-only: ADO comments have no private flag, so postNote is unsupported.
 */
export const createAzureDevopsSource: SourceFactory = (cfg): WorkItemSource => {
  const client = createAdoClient(cfg);
  const configuredProjects = Array.isArray(cfg.config.projects)
    ? (cfg.config.projects as string[])
    : [];

  function toItem(
    wi: any,
    messages: RawMessage[],
    relations?: Record<string, unknown>,
  ): RawWorkItem {
    const f = wi.fields ?? {};
    const createdBy = f["System.CreatedBy"];
    const uniqueName =
      typeof createdBy?.uniqueName === "string" ? createdBy.uniqueName : "";
    return {
      externalId: String(wi.id),
      externalUrl:
        wi._links?.html?.href ??
        `${client.orgUrl}/${encodeURIComponent(f["System.TeamProject"] ?? "")}/_workitems/edit/${wi.id}`,
      kind: "work_item",
      title: f["System.Title"],
      status: f["System.State"],
      groupKey: f["System.TeamProject"],
      requester: createdBy?.displayName ?? uniqueName ?? undefined,
      requesterEmail: uniqueName.includes("@") ? uniqueName : undefined,
      raw: {
        fields: f,
        work_item_type: f["System.WorkItemType"],
        ...(relations ? { relations } : {}),
      },
      sourceCreatedAt: f["System.CreatedDate"],
      sourceUpdatedAt: f["System.ChangedDate"],
      messages,
    };
  }

  async function resolveRelations(
    wi: any,
    project: string,
  ): Promise<Record<string, unknown>> {
    const rels: any[] = Array.isArray(wi.relations) ? wi.relations : [];
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
      for (const s of fetched) {
        summaries.set(Number(s.id), {
          id: Number(s.id),
          title: s.fields?.["System.Title"],
          state: s.fields?.["System.State"],
          type: s.fields?.["System.WorkItemType"],
          url: `${client.orgUrl}/_workitems/edit/${s.id}`,
        });
      }
    }
    const pick = (ids: number[]) =>
      ids.map((id) => summaries.get(id)).filter(Boolean);

    const pullRequests: unknown[] = [];
    const commits: unknown[] = [];
    for (const art of artifacts) {
      try {
        if (art.kind === "pr") {
          const pr = await client.getPullRequest(
            art.project,
            art.repo,
            art.ref,
          );
          pullRequests.push({
            id: pr.pullRequestId,
            title: pr.title,
            status: pr.status,
            repository: pr.repository?.name,
            url: `${client.orgUrl}/${encodeURIComponent(pr.repository?.project?.name ?? project)}/_git/${encodeURIComponent(pr.repository?.name ?? "")}/pullrequest/${pr.pullRequestId}`,
          });
        } else {
          const c = await client.getCommit(art.project, art.repo, art.ref);
          commits.push({
            sha: c.commitId,
            comment: c.comment,
            author: c.author?.name,
            url: c.remoteUrl,
          });
        }
      } catch {
        (art.kind === "pr" ? pullRequests : commits).push({
          ref: art.ref,
          note: "linked but not readable with this PAT",
        });
      }
    }

    const out: Record<string, unknown> = {};
    if (parentIds.length) out.parent = pick(parentIds)[0];
    if (childIds.length) out.children = pick(childIds);
    if (relatedIds.length) out.related = pick(relatedIds);
    if (pullRequests.length) out.pull_requests = pullRequests;
    if (commits.length) out.commits = commits;
    return out;
  }

  return {
    type: "azure-devops",
    capabilities: { postNote: false, incrementalSync: true },
    redactRaw: redactAdoRaw,

    async fetchItem(externalId: string): Promise<RawWorkItem> {
      const wi = await client.getWorkItem(externalId);
      const f = wi.fields ?? {};
      const project = f["System.TeamProject"];
      const messages: RawMessage[] = [];

      const description = f["System.Description"];
      if (typeof description === "string" && description.trim()) {
        messages.push({
          externalId: `desc-${wi.id}`,
          author: f["System.CreatedBy"]?.displayName,
          visibility: "internal",
          direction: "incoming",
          bodyText: stripHtml(description),
          createdAt: f["System.CreatedDate"],
        });
      }
      const repro = f["Microsoft.VSTS.TCM.ReproSteps"];
      if (typeof repro === "string" && repro.trim()) {
        messages.push({
          externalId: `repro-${wi.id}`,
          author: f["System.CreatedBy"]?.displayName,
          visibility: "internal",
          direction: "incoming",
          bodyText: `Repro steps:\n${stripHtml(repro)}`,
          createdAt: f["System.CreatedDate"],
        });
      }
      if (project) {
        const comments = await client.getComments(project, externalId);
        for (const c of comments) {
          messages.push({
            externalId: `comment-${c.id}`,
            author: c.createdBy?.displayName,
            visibility: "internal",
            direction: "incoming",
            bodyText: stripHtml(c.text ?? ""),
            createdAt: c.createdDate,
          });
        }
      }
      messages.sort((a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
      );

      const relations = await resolveRelations(wi, project ?? "");
      return toItem(wi, messages, relations);
    },

    async listItems(opts: ListOptions) {
      const projects = opts.groupKey ? [opts.groupKey] : configuredProjects;
      if (projects.length === 0) {
        throw new Error(
          "azure-devops sync needs a project: pass --group=<project> or set config.projects on the connection",
        );
      }
      const cursor = opts.cursor
        ? (JSON.parse(opts.cursor) as { p: number; offset: number })
        : { p: 0, offset: 0 };
      if (cursor.p >= projects.length) return { items: [] };

      const project = projects[cursor.p];
      const ids = await client.queryWorkItemIds(project, opts.updatedSince);
      const page = ids.slice(cursor.offset, cursor.offset + 200);
      const fetched = page.length ? await client.getWorkItemsBatch(page) : [];
      const items = fetched.map((wi) => toItem(wi, []));

      const nextOffset = cursor.offset + 200;
      const next =
        nextOffset < ids.length
          ? { p: cursor.p, offset: nextOffset }
          : cursor.p + 1 < projects.length
            ? { p: cursor.p + 1, offset: 0 }
            : undefined;
      return { items, ...(next ? { nextCursor: JSON.stringify(next) } : {}) };
    },
  };
};
