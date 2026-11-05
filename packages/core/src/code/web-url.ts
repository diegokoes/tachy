const AZURE_HOST_RE = /^(?:dev\.azure\.com|[a-z0-9-]+\.visualstudio\.com)$/i;

export interface FileRange {
  path: string;
  commit: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
}

interface WebRemote {
  /** Scheme, host and repo path, with no credentials and no `.git`. */
  base: string;
  hostname: string;
  repoPath: string;
}

/** A clone URL read as a web address; null for ssh and file remotes. */
function webRemote(cloneUrl: string): WebRemote | null {
  let remote: URL;
  try {
    remote = new URL(cloneUrl);
  } catch {
    return null;
  }
  if (remote.protocol !== "https:" && remote.protocol !== "http:") return null;
  const repoPath = remote.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
  return {
    base: `${remote.protocol}//${remote.host}${repoPath}`,
    hostname: remote.hostname.toLowerCase(),
    repoPath,
  };
}

/**
 * The repo's page on its host, which serves it at the clone URL's path without
 * `.git`. Null for ssh and file remotes. Credentials in the clone URL are left
 * behind.
 */
export const repoPageUrl = (cloneUrl: string): string | null =>
  webRemote(cloneUrl)?.base ?? null;

/**
 * The page on a repo's host that shows a range of a file at a commit, built
 * from the clone URL. Null for a host whose page URLs are not known here, and
 * for ssh and file remotes. Credentials in the clone URL are left behind.
 */
export function repoFileUrl(cloneUrl: string, range: FileRange): string | null {
  const remote = webRemote(cloneUrl);
  if (!remote) return null;
  const { base, hostname, repoPath } = remote;

  if (hostname === "github.com") {
    const file = range.path.split("/").map(encodeURIComponent).join("/");
    return `${base}/blob/${range.commit}/${file}#L${range.startLine}-L${range.endLine}`;
  }
  if (AZURE_HOST_RE.test(hostname) && repoPath.includes("/_git/")) {
    // Azure selects up to a column, so a whole last line ends at column 1 of
    // the line after it. GC marks the version as a commit.
    const query = new URLSearchParams({
      path: `/${range.path}`,
      version: `GC${range.commit}`,
      line: String(range.startLine),
      lineEnd: String(range.endLine + 1),
      lineStartColumn: "1",
      lineEndColumn: "1",
      lineStyle: "plain",
      _a: "contents",
    });
    return `${base}?${query}`;
  }
  return null;
}
