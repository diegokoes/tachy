import { githubToken, scrubText, TokenMap } from "@tachy/core";
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

function parseRef(externalId: string): { repo: string; number: string } {
  const [repo, number] = externalId.split("#");
  if (!repo || !number)
    throw new Error(
      `Invalid GitHub ref '${externalId}', expected 'owner/repo#123'`,
    );
  return { repo, number };
}

/**
 * GitHub Issues adapter (PAT auth). config.repos lists repos to sync; base_url can be a GitHub Enterprise API URL.
 */
export const createGithubSource: SourceFactory = (cfg): WorkItemSource => {
  const token = githubToken(cfg.slug);
  const api = (cfg.baseUrl || "https://api.github.com").replace(/\/$/, "");
  const configuredRepos = Array.isArray(cfg.config.repos)
    ? (cfg.config.repos as string[])
    : [];

  async function get(path: string): Promise<any> {
    const res = await fetch(api + path, {
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

  async function listRepoIssues(
    repo: string,
    opts: ListOptions,
  ): Promise<RawWorkItem[]> {
    const items: RawWorkItem[] = [];
    for (let page = 1; ; page++) {
      const params = new URLSearchParams({
        state: "all",
        per_page: "100",
        page: String(page),
        sort: "updated",
        direction: "asc",
      });
      if (opts.updatedSince) params.set("since", opts.updatedSince);
      const batch = await get(`/repos/${repo}/issues?${params.toString()}`);
      const arr = Array.isArray(batch) ? batch : [];
      for (const issue of arr) {
        if (issue.pull_request) continue;
        items.push(issueToItem(repo, issue, []));
      }
      if (arr.length < 100) break;
    }
    return items;
  }

  return {
    type: "github",
    capabilities: { postNote: false, incrementalSync: true },
    redactRaw: redactGithubRaw,

    async fetchItem(externalId: string): Promise<RawWorkItem> {
      const { repo, number } = parseRef(externalId);
      const issue = await get(`/repos/${repo}/issues/${number}`);
      const comments = await get(`/repos/${repo}/issues/${number}/comments`);
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
        ...(Array.isArray(comments)
          ? comments.map((c) => commentToMessage(repo, c))
          : []),
      ].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      return issueToItem(repo, issue, messages);
    },

    async listItems(opts: ListOptions) {
      const repos = opts.groupKey ? [opts.groupKey] : configuredRepos;
      if (repos.length === 0) {
        throw new Error(
          "GitHub sync needs a repo: pass --group=owner/repo or set config.repos on the connection",
        );
      }
      const items: RawWorkItem[] = [];
      for (const repo of repos)
        items.push(...(await listRepoIssues(repo, opts)));
      return { items };
    },
  };
};
