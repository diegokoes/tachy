/** A proxied tool call: bindings, a credential with budget, the call, the shaped answer. */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerRow } from "@tachy/contract";
import { resolveCustomer } from "../catalog/customers";
import {
  TokenMap,
  globalRedactionEnabled,
  scrubDeep,
  scrubText,
} from "../compliance/redaction";
import { sql } from "../infra/db";
import { badInput, forbidden, unavailable } from "../infra/errors";
import { errorText } from "../infra/known-secrets";
import { coolDown, cooldownEnd, pickCredential } from "./budget";
import { classifyFailure, openConnection, type McpConnection } from "./connect";
import type { ServerCredential } from "./credentials";
import { countServerCall } from "./traffic";

/** Added to a tool that has a bound argument. */
export const CUSTOMER_ARGUMENT = "tachy_customer";

/** Credentials a pool tries on rate-limit answers. */
const MAX_POOL_ATTEMPTS = 2;

export function boundArguments(
  server: Pick<McpServerRow, "argument_bindings">,
  inputSchema: Record<string, unknown>,
): string[] {
  const properties = (inputSchema.properties ?? {}) as Record<string, unknown>;
  return Object.keys(server.argument_bindings).filter(
    (argument) => argument in properties,
  );
}

async function factValue(
  customerId: string,
  kind: string,
  serverSlug: string,
): Promise<string | null> {
  const [row] = await sql`
    select value from customer_facts
    where customer_id = ${customerId} and kind = ${kind} and unit_id is null
      and label in (${serverSlug}, '')
    order by (label = ${serverSlug}) desc
    limit 1
  `;
  return (row?.value as string | undefined) ?? null;
}

/**
 * Replaces `tachy_customer` with the bound arguments from that customer's
 * facts. Explicit arguments win; a fact labelled with the server slug wins
 * over an unlabelled one.
 */
export async function applyBindings(
  server: Pick<McpServerRow, "slug" | "argument_bindings">,
  bound: string[],
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { [CUSTOMER_ARGUMENT]: customerSlug, ...forwarded } = args;
  if (typeof customerSlug !== "string" || !customerSlug) return forwarded;
  const customer = await resolveCustomer(customerSlug);
  for (const argument of bound) {
    if (forwarded[argument] !== undefined) continue;
    const kind = server.argument_bindings[argument]!;
    const value = await factValue(customer.id, kind, server.slug);
    if (value === null)
      throw badInput(
        `${customer.slug} has no '${kind}' fact to fill ${argument}. Set it with set_customer_fact (kind '${kind}', label '${server.slug}' or empty) once the user confirms the value, or pass ${argument} yourself.`,
      );
    forwarded[argument] = value;
  }
  return forwarded;
}

const connections = new Map<string, Promise<McpConnection>>();

const connectionKey = (serverId: string, credentialKey: string) =>
  `${serverId}|${credentialKey}`;

/** Cached per server and credential for the process lifetime. */
function connectionFor(
  server: McpServerRow,
  credential: ServerCredential,
): Promise<McpConnection> {
  const key = connectionKey(server.id, credential.key);
  const open = connections.get(key);
  if (open) return open;
  const opening = openConnection(server, credential.token);
  connections.set(key, opening);
  opening.catch(() => connections.delete(key));
  return opening;
}

function dropConnection(serverId: string, credentialKey: string): void {
  const key = connectionKey(serverId, credentialKey);
  const open = connections.get(key);
  connections.delete(key);
  open?.then((connection) => connection.close()).catch(() => undefined);
}

export async function closeConnections(): Promise<void> {
  const open = [...connections.values()];
  connections.clear();
  await Promise.allSettled(
    open.map(async (opening) => (await opening).close()),
  );
}

function budgetSpent(server: McpServerRow, resetsAt: Date | null): Error {
  const until = resetsAt ? ` until ${resetsAt.toISOString()}` : "";
  return unavailable(
    `${server.name} has no call budget left${until}. Tell the user, and do not call its tools again before then.`,
  );
}

function tokenRefused(
  server: McpServerRow,
  credential: ServerCredential,
): Error {
  if (server.credential_mode === "personal")
    return forbidden(
      `${server.name} refused your token. Tell the user to save a new one under Settings › Agent.`,
    );
  return forbidden(
    `${server.name} refused the shared token '${credential.key.replace(/^shared:/, "")}'. Tell the user to ask an admin to check the server's token pool.`,
  );
}

/** A rate-limit answer rests the credential; in a pool the call moves to the next. */
export async function callServerTool(
  server: McpServerRow,
  credentials: ServerCredential[],
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const tried = new Set<string>();
  const attempts = Math.min(MAX_POOL_ATTEMPTS, credentials.length);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const pick = await pickCredential(
      server.id,
      credentials.filter((credential) => !tried.has(credential.key)),
      server.rate_windows,
    );
    if (!("credential" in pick)) {
      countServerCall(server.id, { budgetRefused: true });
      throw budgetSpent(server, pick.resetsAt);
    }
    const { credential } = pick;
    tried.add(credential.key);
    try {
      const connection = await connectionFor(server, credential);
      const result = await connection.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { timeout: server.call_timeout_ms },
      );
      countServerCall(server.id, {});
      return result as CallToolResult;
    } catch (err) {
      const failure = classifyFailure(err, server.rate_limit_codes);
      if (failure === "rate_limited") {
        countServerCall(server.id, { rateLimited: true });
        await coolDown(
          server.id,
          credential.key,
          cooldownEnd(server.rate_windows),
        );
        continue;
      }
      dropConnection(server.id, credential.key);
      if (failure === "auth") {
        countServerCall(server.id, { authFailed: true });
        throw tokenRefused(server, credential);
      }
      countServerCall(server.id, {});
      throw new Error(`${server.name}: ${errorText(err)}`);
    }
  }
  throw unavailable(
    `${server.name} is rate limiting tachy's calls. Tell the user to try again in a few minutes, and do not retry now.`,
  );
}

function scrubbed(text: string): string {
  const map = new TokenMap();
  try {
    return JSON.stringify(scrubDeep(JSON.parse(text), map));
  } catch {
    return scrubText(text, map);
  }
}

/** Text only, scrubbed under redaction, cut at the server's limit with a note. A remote error throws. */
export function shapeResult(
  server: Pick<McpServerRow, "name" | "redaction" | "result_max_chars">,
  result: CallToolResult,
): CallToolResult {
  const blocks = result.content ?? [];
  const texts = blocks.flatMap((block) =>
    block.type === "text" ? [block.text] : [],
  );
  let text = texts.length
    ? texts.join("\n")
    : JSON.stringify(result.structuredContent ?? {});
  if (result.isError) throw new Error(`${server.name}: ${text}`);
  if (server.redaction || globalRedactionEnabled()) text = scrubbed(text);
  const notes: string[] = [];
  const omitted = blocks.length - texts.length;
  if (omitted > 0)
    notes.push(
      `note: ${omitted} non-text block(s) of the answer were left out.`,
    );
  if (text.length > server.result_max_chars) {
    text = text.slice(0, server.result_max_chars);
    notes.push(
      `note: the answer was cut at ${server.result_max_chars} characters. Narrow the filters rather than asking for more.`,
    );
  }
  return {
    content: [text, ...notes].map((entry) => ({
      type: "text" as const,
      text: entry,
    })),
  };
}
