import { join } from "node:path";
import { agentHome } from "@tachy/core/infra";

/** One directory per user under the agent home; `_default` for a caller with no account. */
export const userStateDir = (userId?: string | null): string =>
  join(agentHome(), "users", userId ?? "_default");
