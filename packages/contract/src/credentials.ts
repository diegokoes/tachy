export const AGENT_PROVIDERS = ["claude", "copilot"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const AGENT_CREDENTIALS: Record<AgentProvider, string> = {
  claude: "anthropic_api_key",
  copilot: "copilot_token",
};

/**
 * Claude Code OAuth token minted by `claude setup-token`. Authenticates as the
 * holder's Claude subscription seat rather than against Console API billing.
 */
export const ANTHROPIC_OAUTH_CREDENTIAL = "anthropic_oauth_token";

export const OAUTH_PREFIX = "sk-ant-oat01-";
export const API_KEY_PREFIX = "sk-ant-";
export const API_KEY_EXAMPLE = "sk-ant-api03-";

/**
 * Returns an error message if the value is the wrong shape for the given
 * credential name, null otherwise. Shape only: nothing observable in a token
 * says which Anthropic account or organisation minted it.
 *
 * The admin panel calls this before the PUT and the vault calls it again on the
 * way in, so a typo is caught in the field it was typed into and can still
 * never reach storage by another route.
 */
export function validateCredential(name: string, value: string): string | null {
  if (name === AGENT_CREDENTIALS.claude) {
    if (value.startsWith(OAUTH_PREFIX))
      return `${OAUTH_PREFIX} is a Claude Code OAuth token, not an API key — save it under 'Claude subscription token', or get a key (${API_KEY_EXAMPLE}…) from console.anthropic.com`;
    if (!value.startsWith(API_KEY_PREFIX) || /\s/.test(value))
      return `an Anthropic API key starts with ${API_KEY_EXAMPLE} — get one from console.anthropic.com`;
  }
  if (
    name === ANTHROPIC_OAUTH_CREDENTIAL &&
    (!value.startsWith(OAUTH_PREFIX) || /\s/.test(value))
  )
    return `a Claude subscription token starts with ${OAUTH_PREFIX} — run 'claude setup-token' to mint one, or save an API key under 'Anthropic API key' instead`;
  /*
   * GitHub mints several prefixes and keeps adding them, so there is no shape
   * here worth asserting — only that a credential is one value. Anything
   * narrower risks rejecting a token that works, which is worse than not
   * checking.
   */
  if (name === AGENT_CREDENTIALS.copilot && /\s/.test(value))
    return "a GitHub token is a single value with no spaces — copy the whole of it, e.g. from 'gh auth token'";
  return null;
}
