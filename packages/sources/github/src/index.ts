import { githubToken } from "@tachy/core";
import type {
  WorkItemSource, RawWorkItem, RawMessage, ListOptions, SourceFactory,
} from "@tachy/core";

// externalId is "owner/repo#123" so a single connection can span repos that map
// to different products (groupKey = "owner/repo" -> source_product_map).
function parseRef(externalId: string): { repo: string; number: string } {
  const [repo, number] = externalId.split("#");
  if (!repo || !number) throw new Error(`Invalid GitHub ref '${externalId}', expected 'owner/repo#123'`);
  return { repo, number };
}

/**
 * GitHub Issues adapter (PAT auth). Repos to sync come from the connection's
 * config.repos (["owner/repo", ...]); base_url defaults to the public API and
 * can be set to a GitHub Enterprise API URL. Pull requests are skipped.
 */
export const createGithubSource: SourceFactory = (cfg): WorkItemSource => {
  const token = githubToken(cfg.slug);
  const api = (cfg.baseUrl || "https://api.github.com").replace(/\/$/, "");
  const configuredRepos = Array.isArray(cfg.config.repos) ? (cfg.config.repos as string[]) : [];

  async function get(path: string): Promise<any> {
    const res = await fetch(api + path, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "tachy",
      },
    });
    if (!res.ok) throw new Error(`GitHub GET ${path} -> ${res.status} ${await res.text()}`);
    return res.json();
  }

  function issueToItem(repo: string, issue: any, messages: RawMessage[]): RawWorkItem {
    return {
      externalId: `${repo}#${issue.number}`,
      externalUrl: issue.html_url,
      kind: "issue",
      title: issue.title,
      status: issue.state,                         // 'open' | 'closed'
      groupKey: repo,                              // -> source_product_map ('owner/repo')
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

  async function listRepoIssues(repo: string, opts: ListOptions): Promise<RawWorkItem[]> {
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
        if (issue.pull_request) continue;          // issues endpoint also returns PRs
        items.push(issueToItem(repo, issue, []));  // metadata only on sync
      }
      if (arr.length < 100) break;
    }
    return items;
  }

  return {
    type: "github",
    capabilities: { postNote: false, incrementalSync: true },

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
      const messages = [body, ...(Array.isArray(comments) ? comments.map((c) => commentToMessage(repo, c)) : [])]
        .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      return issueToItem(repo, issue, messages);
    },

    async listItems(opts: ListOptions) {
      // groupKey ('owner/repo') narrows to one repo; otherwise sync all configured repos.
      const repos = opts.groupKey ? [opts.groupKey] : configuredRepos;
      if (repos.length === 0) {
        throw new Error("GitHub sync needs a repo: pass --group=owner/repo or set config.repos on the connection");
      }
      const items: RawWorkItem[] = [];
      for (const repo of repos) items.push(...(await listRepoIssues(repo, opts)));
      return { items };
    },
  };
};
