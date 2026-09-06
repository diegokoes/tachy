import {
  badInput,
  githubToken,
  scrubText,
  sourceFetch,
  TokenMap,
} from "@tachy/core";
import type {
  WorkItemSource,
  RawWorkItem,
  RawMessage,
  ListOptions,
  SourceFactory,
} from "@tachy/core";

function scrubActor(u: unknown, map: TokenMap, name: string): void {
  if (!u || typeof u !== "object") return;
  const a = u as Record<string, any>;
  if (a.login != null) a.login = map.token("USER", String(a.login));
  if (a.email != null && typeof a.email === "string")
    a.email = map.token("EMAIL", a.email);
  if (a.name != null) a.name = name;
}

function redactGithubRaw(
  raw: unknown,
  map: TokenMap,
  customerSlug: string | null,
): unknown {
  if (raw == null || typeof raw !== "object") return {};
  const issue = structuredClone(raw) as Record<string, any>;
  const name = customerSlug || "[CUSTOMER]";
  scrubActor(issue.user, map, name);
  scrubActor(issue.closed_by, map, name);
  scrubActor(issue.assignee, map, name);
  if (Array.isArray(issue.assignees))
    for (const a of issue.assignees) scrubActor(a, map, name);
  if (typeof issue.title === "string")
    issue.title = scrubText(issue.title, map);
  if (typeof issue.body === "string") issue.body = scrubText(issue.body, map);
  return issue;
}

/**
 * `owner/repo#123`, checked rather than merely split: both halves are pasted
 * into a URL path, and the id reaches here from a route parameter. The slash
 * between owner and repo is the only one that belongs there.
 */
const OWNER_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function parseRef(externalId: string): { repo: string; number: string } {
  const [repo, number] = externalId.split("#");
  if (!repo || !number || !OWNER_REPO_RE.test(repo) || !/^\d+$/.test(number))
    throw badInput(
      `Invalid GitHub ref '${externalId}', expected 'owner/repo#123'`,
    );
  return { repo, number };
}

/**
 * GitHub Issues adapter (PAT auth). config.repos lists repos to sync; base_url can be a GitHub Enterprise API URL.
 */
export const createGithubSource: SourceFactory = (cfg): WorkItemSource => {
  const token = cfg.token || githubToken(cfg.slug);
  const api = (cfg.baseUrl || "https://api.github.com").replace(/\/$/, "");
  const configuredRepos = Array.isArray(cfg.config.repos)
    ? (cfg.config.repos as string[])
    : [];

  async function get(path: string): Promise<any> {
    const res = await sourceFetch(`GitHub GET ${path}`, api + path, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "tachy",
      },
    });
    if (!res.ok)
      throw new Error(
        `GitHub GET ${path} -> ${res.status} ${await res.text()}`,
      );
    return res.json();
  }

  function issueToItem(
    repo: string,
    issue: any,
    messages: RawMessage[],
  ): RawWorkItem {
    return {
      externalId: `${repo}#${issue.number}`,
      externalUrl: issue.html_url,
      kind: "issue",
      title: issue.title,
      status: issue.state,
      groupKey: repo,
      requester: issue.user?.login,
      raw: issue,
      sourceCreatedAt: issue.created_at,
      sourceUpdatedAt: issue.updated_at,
      messages,
    };
  }

  function commentToMessage(repo: string, c: any): RawMessage {
    return {
      externalId: `${repo}#c${c.id}`,
      author: c.user?.login,
      visibility: "public",
      direction: "incoming",
      bodyText: c.body ?? "",
      createdAt: c.created_at,
    };
  }

  const PER_PAGE = 100;

  /** One page of one repo — the unit the sync loop advances through. */
  async function listRepoIssuePage(
    repo: string,
    page: number,
    opts: ListOptions,
  ): Promise<{ items: RawWorkItem[]; more: boolean }> {
    const params = new URLSearchParams({
      state: "all",
      per_page: String(PER_PAGE),
      page: String(page),
      sort: "updated",
      direction: "asc",
    });
    if (opts.updatedSince) params.set("since", opts.updatedSince);
    const batch = await get(`/repos/${repo}/issues?${params.toString()}`);
    const arr = Array.isArray(batch) ? batch : [];
    const items: RawWorkItem[] = [];
    for (const issue of arr) {
      if (issue.pull_request) continue;
      items.push(issueToItem(repo, issue, []));
    }
    return { items, more: arr.length === PER_PAGE };
  }

  return {
    type: "github",
    capabilities: { postNote: false, incrementalSync: true },
    redactRaw: redactGithubRaw,

    async verify() {
      const me = await get("/user");
      const identity = me?.login ?? undefined;
      // Repo listing needs a scope the ticket reads don't; treat it as a bonus.
      try {
        const repos = await get("/user/repos?per_page=100&sort=updated");
        return {
          identity,
          groups: (Array.isArray(repos) ? repos : []).map((r: any) => ({
            key: r.full_name,
            name: r.full_name,
          })),
        };
      } catch (e) {
        return {
          identity,
          groups: [],
          groupsNote: e instanceof Error ? e.message : String(e),
        };
      }
    },

    async fetchItem(externalId: string): Promise<RawWorkItem> {
      const { repo, number } = parseRef(externalId);
      const issue = await get(`/repos/${repo}/issues/${number}`);
      const comments: any[] = [];
      for (let page = 1; ; page++) {
        const batch = await get(
          `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`,
        );
        const arr = Array.isArray(batch) ? batch : [];
        comments.push(...arr);
        if (arr.length < 100) break;
      }
      const body: RawMessage = {
        externalId: `${repo}#body${issue.number}`,
        author: issue.user?.login,
        visibility: "public",
        direction: "incoming",
        bodyText: issue.body ?? "",
        createdAt: issue.created_at,
      };
      const messages = [
        body,
        ...comments.map((c) => commentToMessage(repo, c)),
      ].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      return issueToItem(repo, issue, messages);
    },

    /**
     * One page per call, like the other adapters: this used to walk every page
     * of every configured repo into one array before returning, so a real org's
     * backlog was an out-of-memory rather than a slow sync. The cursor is
     * "<repo index>:<page>" — which repo the walk has reached, and where in it.
     */
    async listItems(opts: ListOptions) {
      const repos = opts.groupKey ? [opts.groupKey] : configuredRepos;
      if (repos.length === 0) {
        throw badInput(
          "GitHub sync needs a repo: pass --group=owner/repo or set config.repos on the connection",
        );
      }
      const [at = "0", page = "1"] = (opts.cursor ?? "").split(":");
      let repoIndex = Number(at);
      let pageNumber = Number(page);
      if (!Number.isInteger(repoIndex) || !Number.isInteger(pageNumber))
        throw badInput(`Invalid GitHub sync cursor '${opts.cursor}'`);

      // An empty page mid-walk is not the end of the sync, only the end of one
      // repo, so this advances until it has something or has run out of repos.
      while (repoIndex < repos.length) {
        const { items, more } = await listRepoIssuePage(
          repos[repoIndex],
          pageNumber,
          opts,
        );
        const nextCursor = more
          ? `${repoIndex}:${pageNumber + 1}`
          : repoIndex + 1 < repos.length
            ? `${repoIndex + 1}:1`
            : undefined;
        if (items.length || !nextCursor) return { items, nextCursor };
        [repoIndex, pageNumber] = nextCursor.split(":").map(Number);
      }
      return { items: [] };
    },
  };
};
