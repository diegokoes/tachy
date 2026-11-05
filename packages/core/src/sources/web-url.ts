const GITHUB_API = "https://api.github.com";

/** GitHub's web host for an API base: github.com, or an Enterprise host without its `/api/v3`. */
function githubWebBase(baseUrl: string | null): string {
  const api = (baseUrl || GITHUB_API).replace(/\/+$/, "");
  if (api === GITHUB_API) return "https://github.com";
  return api.replace(/\/api\/v3$/, "");
}

/**
 * A source project's own page: an Azure DevOps project under its organization,
 * a GitHub repo (`owner/repo`). Null where the address is not known here, as
 * for a Freshdesk group.
 */
export function projectPageUrl(
  connection: { source_type: string; base_url: string | null },
  externalKey: string,
): string | null {
  if (connection.source_type === "azure-devops" && connection.base_url)
    return `${connection.base_url.replace(/\/+$/, "")}/${encodeURIComponent(externalKey)}`;
  if (connection.source_type === "github")
    return `${githubWebBase(connection.base_url)}/${externalKey}`;
  return null;
}
