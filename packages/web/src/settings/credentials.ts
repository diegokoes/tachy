import { validateCredential } from "@tachy/contract";

/** What each credential is called where someone has to recognise it. */
export const AGENT_KEY_LABELS: Record<string, string> = {
  anthropic_oauth_token: "Claude subscription token",
  anthropic_api_key: "Anthropic API key",
  copilot_token: "Copilot GitHub token",
};

/** The vault's own check, run in the field the key was typed into. */
export const agentKeyError = validateCredential;
