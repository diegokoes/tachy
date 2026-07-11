import { azureDevopsToken, badInput } from "@tachy/core";

export interface AdoCfg {
  baseUrl: string;
  slug: string;
  config: Record<string, unknown>;
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
  getWorkItem(id: string): Promise<any>;
  getWorkItemsBatch(ids: number[], fields?: string[]): Promise<any[]>;
  getComments(project: string, id: string): Promise<any[]>;
  queryWorkItemIds(project: string, since?: string): Promise<number[]>;
  getPullRequest(project: string, repoId: string, prId: string): Promise<any>;
  getCommit(project: string, repoId: string, sha: string): Promise<any>;
  listWorkItemTypes(project: string): Promise<any[]>;
  getTypeFields(project: string, type: string): Promise<any[]>;
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
  listRepos(project: string): Promise<any[]>;
}

export function createAdoClient(cfg: AdoCfg): AdoClient {
  if (!cfg.baseUrl)
    throw badInput(
      "azure-devops connection needs a base_url like https://dev.azure.com/<org>",
    );
  const orgUrl = cfg.baseUrl.replace(/\/$/, "");
  const token = azureDevopsToken(cfg.slug);
  const auth = "Basic " + Buffer.from(`:${token}`).toString("base64");

  async function req(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(orgUrl + path, {
      ...init,
      headers: {
        Authorization: auth,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      throw new Error(
        `Azure DevOps ${init?.method ?? "GET"} ${path} -> ${res.status} returned non-JSON — check that the PAT is valid and has the required scopes (Work Items, Wiki, Code)`,
      );
    }
    if (!res.ok)
      throw new Error(
        `Azure DevOps ${init?.method ?? "GET"} ${path} -> ${res.status} ${trimmed.slice(0, 2000)}`,
      );
    return JSON.parse(text);
  }

  const proj = (project: string) => `/${encodeURIComponent(project)}`;

  return {
    orgUrl,

    async getWorkItem(id) {
      return req(`/_apis/wit/workitems/${id}?$expand=all&api-version=7.1`);
    },

    async getWorkItemsBatch(ids, fields) {
      const out: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const params = new URLSearchParams({
          ids: chunk.join(","),
          errorPolicy: "omit",
          "api-version": "7.1",
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
      do {
        const params = new URLSearchParams({
          "api-version": "7.1-preview.4",
          $top: "200",
        });
        if (continuation) params.set("continuationToken", continuation);
        const res = await req(
          `${proj(project)}/_apis/wit/workItems/${id}/comments?${params.toString()}`,
        );
        comments.push(...(res.comments ?? []));
        continuation = res.continuationToken || undefined;
      } while (continuation);
      return comments;
    },

    async queryWorkItemIds(project, since) {
      const where = [`[System.TeamProject] = @project`];
      if (since) where.push(`[System.ChangedDate] >= '${since.slice(0, 10)}'`);
      const query = `Select [System.Id] From WorkItems Where ${where.join(" And ")} Order By [System.ChangedDate] Asc`;
      const res = await req(`${proj(project)}/_apis/wit/wiql?api-version=7.1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      return (res.workItems ?? []).map((w: any) => Number(w.id));
    },

    async getPullRequest(project, repoId, prId) {
      return req(
        `${proj(project)}/_apis/git/repositories/${repoId}/pullrequests/${prId}?api-version=7.1`,
      );
    },

    async getCommit(project, repoId, sha) {
      return req(
        `${proj(project)}/_apis/git/repositories/${repoId}/commits/${sha}?api-version=7.1`,
      );
    },

    async listWorkItemTypes(project) {
      const res = await req(
        `${proj(project)}/_apis/wit/workitemtypes?api-version=7.1`,
      );
      return res.value ?? [];
    },

    async getTypeFields(project, type) {
      const res = await req(
        `${proj(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields?$expand=all&api-version=7.1`,
      );
      return res.value ?? [];
    },

    async createWorkItem(project, type, patch) {
      return req(
        `${proj(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json-patch+json" },
          body: JSON.stringify(patch),
        },
      );
    },

    async listWikis(project) {
      const scope = project ? proj(project) : "";
      const res = await req(`${scope}/_apis/wiki/wikis?api-version=7.1`);
      return res.value ?? [];
    },

    async listWikiPages(project, wiki) {
      const params = new URLSearchParams({
        path: "/",
        recursionLevel: "full",
        "api-version": "7.1",
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
        "api-version": "7.1",
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

    async listRepos(project) {
      const res = await req(
        `${proj(project)}/_apis/git/repositories?api-version=7.1`,
      );
      return res.value ?? [];
    },
  };
}
