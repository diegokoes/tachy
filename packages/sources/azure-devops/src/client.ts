import { azureDevopsToken, badInput, sourceFetch } from "@tachy/core";

/** The released Azure DevOps REST version. Everything in 7.2 is still preview. */
const API_VERSION = "7.1";
// No released version exists for these two, so they stay pinned to preview:
//   work item comments -> the 7.1 reference itself documents 7.1-preview.4
//   connectionData     -> not in the public REST reference at all
/**
 * At $top=200 this is 20k comments on one work item — far past anything real,
 * and the point at which a continuation token that never clears is a bug rather
 * than a big ticket.
 */
const MAX_PAGES = 100;

const API_COMMENTS = "7.1-preview.4";
const API_CONNECTION_DATA = "7.1-preview.1";

/**
 * Every request carries the version; only the preview endpoints above name their
 * own. Concatenated rather than built through URL/searchParams, which would
 * re-encode the `$` operators and the pre-encoded wiki page paths.
 */
const withVersion = (path: string) =>
  path.includes("api-version=")
    ? path
    : `${path}${path.includes("?") ? "&" : "?"}api-version=${API_VERSION}`;

export interface AdoCfg {
  baseUrl: string;
  slug: string;
  config: Record<string, unknown>;
  token?: string;
}

export interface AdoWorkItemSummary {
  id: number;
  title?: string;
  state?: string;
  type?: string;
  url?: string;
}

export interface JsonPatchOp {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
}

export interface AdoClient {
  readonly orgUrl: string;
  getConnectionData(): Promise<any>;
  listProjects(): Promise<{ id: string; name: string }[]>;
  getWorkItem(id: string): Promise<any>;
  getWorkItemsBatch(ids: number[], fields?: string[]): Promise<any[]>;
  getComments(project: string, id: string): Promise<any[]>;
  queryWorkItemIds(
    project: string,
    since?: string,
    top?: number,
  ): Promise<number[]>;
  getPullRequest(project: string, repoId: string, prId: string): Promise<any>;
  getCommit(project: string, repoId: string, sha: string): Promise<any>;
  listWorkItemTypes(project: string): Promise<any[]>;
  getTypeFields(project: string, type: string): Promise<any[]>;
  /**
   * Account-wide field definitions. The per-type endpoint above returns what a
   * type requires and allows but carries NO data type, so the widget a field
   * deserves is only knowable by joining these two on referenceName.
   */
  listFields(): Promise<any[]>;
  createWorkItem(
    project: string,
    type: string,
    patch: JsonPatchOp[],
  ): Promise<any>;
  listWikis(project?: string): Promise<any[]>;
  listWikiPages(project: string, wiki: string): Promise<string[]>;
  getWikiPage(
    project: string,
    wiki: string,
    path: string,
  ): Promise<{ path: string; content: string; remoteUrl?: string }>;
  getWikiPageById(
    project: string,
    wiki: string,
    id: string | number,
  ): Promise<{ path: string; content: string; remoteUrl?: string }>;
  listRepos(project: string): Promise<any[]>;
}

export function createAdoClient(cfg: AdoCfg): AdoClient {
  if (!cfg.baseUrl)
    throw badInput(
      "azure-devops connection needs a base_url like https://dev.azure.com/<org>",
    );
  const orgUrl = cfg.baseUrl.replace(/\/$/, "");
  const token = cfg.token || azureDevopsToken(cfg.slug);
  const auth = "Basic " + Buffer.from(`:${token}`).toString("base64");

  async function req(path: string, init?: RequestInit): Promise<any> {
    const method = init?.method ?? "GET";
    const res = await sourceFetch(
      `Azure DevOps ${method} ${path}`,
      orgUrl + withVersion(path),
      {
        ...init,
        headers: {
          Authorization: auth,
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
      },
    );
    const text = await res.text();
    const trimmed = text.trim();
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403 || res.status === 203
          ? " — check that the PAT is valid and has the required scopes (Work Items, Wiki, Code)"
          : "";
      throw new Error(
        `Azure DevOps ${method} ${path} -> ${res.status} ${trimmed.slice(0, 2000)}${hint}`,
      );
    }
    if (!trimmed) return {};
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      throw new Error(
        `Azure DevOps ${method} ${path} -> ${res.status} returned non-JSON — check that the PAT is valid and has the required scopes (Work Items, Wiki, Code)`,
      );
    }
    return JSON.parse(text);
  }

  const proj = (project: string) => `/${encodeURIComponent(project)}`;

  return {
    orgUrl,

    async getConnectionData() {
      return req(`/_apis/connectionData?api-version=${API_CONNECTION_DATA}`);
    },

    async listProjects() {
      const res = await req("/_apis/projects?$top=500");
      return (res.value ?? []).map((p: any) => ({ id: p.id, name: p.name }));
    },

    async getWorkItem(id) {
      return req(
        `/_apis/wit/workitems/${encodeURIComponent(String(id))}?$expand=all`,
      );
    },

    async getWorkItemsBatch(ids, fields) {
      const out: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const params = new URLSearchParams({
          ids: chunk.join(","),
          errorPolicy: "omit",
        });
        if (fields?.length) params.set("fields", fields.join(","));
        const res = await req(`/_apis/wit/workitems?${params.toString()}`);
        out.push(...(res.value ?? []));
      }
      return out;
    },

    async getComments(project, id) {
      const comments: any[] = [];
      let continuation: string | undefined;
      // A server that echoes the same continuation token would otherwise spin
      // here for as long as the process runs.
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
          "api-version": API_COMMENTS,
          $top: "200",
        });
        if (continuation) params.set("continuationToken", continuation);
        const res = await req(
          `${proj(project)}/_apis/wit/workItems/${encodeURIComponent(String(id))}/comments?${params.toString()}`,
        );
        comments.push(...(res.comments ?? []));
        continuation = res.continuationToken || undefined;
        if (!continuation) break;
      }
      return comments;
    },

    async queryWorkItemIds(project, since, top) {
      const where = [`[System.TeamProject] = @project`];
      if (since) {
        const d = new Date(since);
        if (Number.isNaN(d.getTime()))
          throw badInput(`invalid updatedSince date: ${since}`);
        where.push(`[System.ChangedDate] >= '${d.toISOString()}'`);
      }
      const query = `Select [System.Id] From WorkItems Where ${where.join(" And ")} Order By [System.ChangedDate] Asc`;
      const params = new URLSearchParams({
        timePrecision: "true",
        $top: String(top ?? 200),
      });
      const res = await req(
        `${proj(project)}/_apis/wit/wiql?${params.toString()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        },
      );
      return (res.workItems ?? []).map((w: any) => Number(w.id));
    },

    async getPullRequest(project, repoId, prId) {
      return req(
        `${proj(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/pullrequests/${encodeURIComponent(String(prId))}`,
      );
    },

    async getCommit(project, repoId, sha) {
      return req(
        `${proj(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/commits/${encodeURIComponent(sha)}`,
      );
    },

    async listWorkItemTypes(project) {
      const res = await req(`${proj(project)}/_apis/wit/workitemtypes`);
      return res.value ?? [];
    },

    async listFields() {
      const res = await req(`/_apis/wit/fields`);
      return res.value ?? [];
    },

    async getTypeFields(project, type) {
      const res = await req(
        `${proj(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields?$expand=all`,
      );
      return res.value ?? [];
    },

    async createWorkItem(project, type, patch) {
      return req(
        `${proj(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json-patch+json" },
          body: JSON.stringify(patch),
        },
      );
    },

    async listWikis(project) {
      const scope = project ? proj(project) : "";
      const res = await req(`${scope}/_apis/wiki/wikis`);
      return res.value ?? [];
    },

    async listWikiPages(project, wiki) {
      const params = new URLSearchParams({
        path: "/",
        recursionLevel: "full",
      });
      const res = await req(
        `${proj(project)}/_apis/wiki/wikis/${encodeURIComponent(wiki)}/pages?${params.toString()}`,
      );
      const paths: string[] = [];
      const walk = (page: any) => {
        if (!page) return;
        if (page.path) paths.push(page.path);
        for (const sub of page.subPages ?? []) walk(sub);
      };
      walk(res);
      return paths;
    },

    async getWikiPage(project, wiki, path) {
      const params = new URLSearchParams({
        path,
        includeContent: "true",
      });
      const res = await req(
        `${proj(project)}/_apis/wiki/wikis/${encodeURIComponent(wiki)}/pages?${params.toString()}`,
      );
      return {
        path: res.path ?? path,
        content: res.content ?? "",
        remoteUrl: res.remoteUrl,
      };
    },

    /**
     * The id a wiki URL carries (.../_wiki/wikis/foo.wiki/1648/Start). Worth its
     * own call because the trailing segment of that URL is a display slug, not
     * the page path — dashes where the path has spaces — so it does not round-trip
     * through the path endpoint.
     */
    async getWikiPageById(project, wiki, id) {
      const res = await req(
        `${proj(project)}/_apis/wiki/wikis/${encodeURIComponent(wiki)}/pages/${encodeURIComponent(String(id))}?includeContent=true`,
      );
      return {
        path: res.path ?? "",
        content: res.content ?? "",
        remoteUrl: res.remoteUrl,
      };
    },

    async listRepos(project) {
      const res = await req(`${proj(project)}/_apis/git/repositories`);
      return res.value ?? [];
    },
  };
}
