import { createHash } from "node:crypto";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeEnv } from "./claude";
import { AGENT_EFFORTS, type AgentAuth, type AgentEffort } from "./backend";

/** A model the caller's runtime offers, with the efforts it accepts. */
export interface ModelChoice {
  id: string;
  label: string;
  /** Empty when the model takes no effort setting. */
  efforts: AgentEffort[];
  defaultEffort?: AgentEffort;
}

export interface ModelListConfig {
  agentAuth?: AgentAuth;
  /** The caller's Claude Code state directory. */
  configDir?: string;
}

const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 30_000;

const cache = new Map<string, { at: number; list: Promise<ModelChoice[]> }>();

const efforts = (levels: readonly string[] | undefined): AgentEffort[] =>
  AGENT_EFFORTS.filter((e) => levels?.includes(e));

/**
 * Asks the runtime a turn would run on, holding the caller's own credential,
 * rather than a hard-coded catalogue: a subscription and an API key are
 * offered different models, and a runtime upgrade adds new ones without a
 * release of ours. Keyed by a digest of the credential, so two people share a
 * list only when they share the key that decides it.
 */
export function listModels(config: ModelListConfig): Promise<ModelChoice[]> {
  const who = config.agentAuth
    ? createHash("sha256")
        .update(config.agentAuth.value)
        .digest("hex")
        .slice(0, 16)
    : "server";
  const key = who;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.list;

  const list = withTimeout(claudeModels(config));
  cache.set(key, { at: Date.now(), list });
  list.catch(() => cache.delete(key));
  return list;
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error("the agent runtime did not list its models in time")),
      TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

async function claudeModels(config: ModelListConfig): Promise<ModelChoice[]> {
  const abortController = new AbortController();
  // Streaming input that never sends: the session initialises, answers the
  // control request, and is torn down without a model call.
  async function* idle(): AsyncGenerator<SDKUserMessage> {
    await new Promise((resolve) =>
      abortController.signal.addEventListener("abort", resolve),
    );
  }
  const session = query({
    prompt: idle(),
    options: {
      abortController,
      settingSources: [],
      strictMcpConfig: true,
      tools: [],
      env: claudeEnv(config),
    },
  });
  try {
    const offered = await session.supportedModels();
    const byId = new Map<string, ModelChoice>();
    for (const model of offered) {
      const id = model.resolvedModel ?? model.value;
      if (id === "default" || (model.value === "default" && byId.has(id)))
        continue;
      byId.set(id, {
        id,
        label: model.displayName || id,
        efforts: model.supportsEffort
          ? efforts(model.supportedEffortLevels)
          : [],
      });
    }
    return [...byId.values()];
  } finally {
    abortController.abort();
    session.close();
  }
}
