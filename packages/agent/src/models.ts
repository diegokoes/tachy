import { createHash } from "node:crypto";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { CopilotClient } from "@github/copilot-sdk";
import { claudeEnv } from "./claude";
import { copilotHome } from "./state";
import {
  AGENT_EFFORTS,
  type AgentAuth,
  type AgentEffort,
  type AgentProvider,
} from "./backend";

/** A model the caller's runtime offers, with the efforts it accepts. */
export interface ModelChoice {
  id: string;
  label: string;
  /** Empty when the model takes no effort setting. */
  efforts: AgentEffort[];
  defaultEffort?: AgentEffort;
}

export interface ModelListConfig {
  provider: AgentProvider;
  agentAuth?: AgentAuth;
  /** Claude only: the caller's Claude Code state directory. */
  configDir?: string;
  /** Copilot only: an empty directory the runtime starts in. */
  sessionCwd?: string;
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
export function listModels(cfg: ModelListConfig): Promise<ModelChoice[]> {
  const who = cfg.agentAuth
    ? createHash("sha256")
        .update(cfg.agentAuth.value)
        .digest("hex")
        .slice(0, 16)
    : "server";
  const key = `${cfg.provider}:${who}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.list;

  const list = withTimeout(
    cfg.provider === "copilot" ? copilotModels(cfg) : claudeModels(cfg),
  );
  cache.set(key, { at: Date.now(), list });
  list.catch(() => cache.delete(key));
  return list;
}

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error("the agent runtime did not list its models in time")),
      TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

async function claudeModels(cfg: ModelListConfig): Promise<ModelChoice[]> {
  const abortController = new AbortController();
  // Streaming input that never sends: the session initialises, answers the
  // control request, and is torn down without a model call.
  async function* idle(): AsyncGenerator<SDKUserMessage> {
    await new Promise((resolve) =>
      abortController.signal.addEventListener("abort", resolve),
    );
  }
  const q = query({
    prompt: idle(),
    options: {
      abortController,
      settingSources: [],
      strictMcpConfig: true,
      tools: [],
      env: claudeEnv(cfg),
    },
  });
  try {
    const rows = await q.supportedModels();
    const byId = new Map<string, ModelChoice>();
    for (const m of rows) {
      const id = m.resolvedModel ?? m.value;
      if (id === "default" || (m.value === "default" && byId.has(id))) continue;
      byId.set(id, {
        id,
        label: m.displayName || id,
        efforts: m.supportsEffort ? efforts(m.supportedEffortLevels) : [],
      });
    }
    return [...byId.values()];
  } finally {
    abortController.abort();
    q.close();
  }
}

async function copilotModels(cfg: ModelListConfig): Promise<ModelChoice[]> {
  const client = new CopilotClient({
    ...(cfg.sessionCwd ? { workingDirectory: cfg.sessionCwd } : {}),
    ...(cfg.agentAuth ? { gitHubToken: cfg.agentAuth.value } : {}),
    baseDirectory: await copilotHome(cfg.configDir),
    logLevel: "error",
  });
  try {
    await client.start();
    const rows = await client.listModels();
    return rows
      .filter((m) => m.policy?.state !== "disabled")
      .map((m) => {
        const levels = m.capabilities.supports.reasoningEffort
          ? efforts(m.supportedReasoningEfforts)
          : [];
        const fallback = m.defaultReasoningEffort;
        return {
          id: m.id,
          label: m.name || m.id,
          efforts: levels,
          ...(fallback && levels.includes(fallback)
            ? { defaultEffort: fallback }
            : {}),
        };
      });
  } finally {
    await client.stop().catch(() => {});
  }
}
