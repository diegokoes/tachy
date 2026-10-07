export const ANTHROPIC_API_KEY_CREDENTIAL = "anthropic_api_key";

/**
 * Claude Code OAuth token minted by `claude setup-token`. Authenticates as the
 * holder's Claude subscription seat rather than against Console API billing.
 */
export const ANTHROPIC_OAUTH_CREDENTIAL = "anthropic_oauth_token";

export const OAUTH_PREFIX = "sk-ant-oat01-";
export const API_KEY_PREFIX = "sk-ant-";
export const API_KEY_EXAMPLE = "sk-ant-api03-";

/**
 * An error message when the value has the wrong shape for the credential
 * name, else null. Shape only: nothing in a token says which Anthropic account
 * minted it. The admin panel calls it before the PUT and the vault again on
 * the way in, so no route stores a malformed value.
 */
export function validateCredential(name: string, value: string): string | null {
  if (name === ANTHROPIC_API_KEY_CREDENTIAL) {
    if (value.startsWith(OAUTH_PREFIX))
      return `${OAUTH_PREFIX} is a Claude Code OAuth token, not an API key. Save it under 'Claude subscription token', or get a key (${API_KEY_EXAMPLE}…) from console.anthropic.com`;
    if (!value.startsWith(API_KEY_PREFIX) || /\s/.test(value))
      return `an Anthropic API key starts with ${API_KEY_EXAMPLE}; get one from console.anthropic.com`;
  }
  if (
    name === ANTHROPIC_OAUTH_CREDENTIAL &&
    (!value.startsWith(OAUTH_PREFIX) || /\s/.test(value))
  )
    return `a Claude subscription token starts with ${OAUTH_PREFIX}. Run 'claude setup-token' to mint one, or save an API key under 'Anthropic API key' instead`;
  return null;
}
