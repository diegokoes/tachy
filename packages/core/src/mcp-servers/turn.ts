/** Linked servers for one turn: resolved by the API, which holds the vault key, read back by the MCP subprocess. */
import { proxiedToolName, type McpServerRow } from "@tachy/contract";
import { rememberSecret } from "../infra/known-secrets";
import { exposedTools } from "./catalog";
import { ownToken, poolTokens, type ServerCredential } from "./credentials";
import { serversFor } from "./servers";

/** Server slug to the credentials its calls may use, as JSON. */
export const TURN_TOKENS_ENV = "TACHY_MCP_SERVER_TOKENS";

export type TurnTokens = Record<string, ServerCredential[]>;

export interface TurnServer {
  slug: string;
  credential: "personal" | "shared" | "missing";
  tools: number;
}

export interface TurnServers {
  tokens: TurnTokens;
  proxiedTools: string[];
  servers: TurnServer[];
}

async function credentialsFor(
  server: McpServerRow,
  userId: string | null,
): Promise<ServerCredential[]> {
  if (server.credential_mode === "shared") return poolTokens(server.slug);
  if (!userId) return [];
  const own = await ownToken(server.slug, userId);
  return own ? [own] : [];
}

/** A personal server without the person's own token is left out. */
export async function resolveTurnServers(
  userId: string | null,
): Promise<TurnServers> {
  const servers = await serversFor(userId);
  const tools = await exposedTools(servers.map((server) => server.id));
  const tokens: TurnTokens = {};
  const proxied = new Set<string>();
  const summary: TurnServer[] = [];
  for (const server of servers) {
    const credentials = await credentialsFor(server, userId);
    const own = tools.filter((tool) => tool.server_id === server.id);
    if (!credentials.length) {
      summary.push({ slug: server.slug, credential: "missing", tools: 0 });
      continue;
    }
    tokens[server.slug] = credentials;
    for (const tool of own)
      proxied.add(proxiedToolName(server.tool_prefix, tool.name));
    summary.push({
      slug: server.slug,
      credential: server.credential_mode,
      tools: own.length,
    });
  }
  return { tokens, proxiedTools: [...proxied], servers: summary };
}

function parseTurnTokens(value: string): TurnTokens {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as TurnTokens)
      : {};
  } catch {
    return {};
  }
}

/** Empty when unset or unreadable. Remembers each token so an echo of it is masked. */
export function readTurnTokens(
  value = process.env[TURN_TOKENS_ENV],
): TurnTokens {
  if (!value) return {};
  const tokens = parseTurnTokens(value);
  for (const credentials of Object.values(tokens))
    for (const credential of Array.isArray(credentials) ? credentials : [])
      rememberSecret(credential.token);
  return tokens;
}
