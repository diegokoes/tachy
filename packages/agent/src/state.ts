import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { agentHome } from "@tachy/core/infra";

/** One directory per user under the agent home; `_default` for a caller with no account. */
export const userStateDir = (userId?: string | null): string =>
  join(agentHome(), "users", userId ?? "_default");

/**
 * Where a Copilot runtime keeps its state. Its own default is ~/.copilot, which
 * the production container cannot write and no volume holds. Beside the
 * caller's Claude state, a chat resumes across a redeploy and retention finds
 * its sessions.
 */
export async function copilotHome(configDir?: string): Promise<string> {
  const dir = join(configDir ?? userStateDir(), "copilot");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}
