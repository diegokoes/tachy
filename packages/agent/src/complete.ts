import { query } from "@anthropic-ai/claude-agent-sdk";
import { CopilotClient } from "@github/copilot-sdk";
import { claudeEnv } from "./claude";
import {
  effectiveModel,
  type AgentAuth,
  type AgentEffort,
  type AgentProvider,
} from "./backend";

/**
 * The subset of a turn's config a bare completion needs: no MCP server, no cwd,
 * no per-user config dir. Kept separate from AgentConfig so a caller does not
 * have to assemble the MCP plumbing a one-shot call never touches.
 */
export interface CompletionConfig {
  provider: AgentProvider;
  model?: string;
  allowedModels?: string[];
  agentAuth?: AgentAuth;
  systemPrompt?: string;
  effort?: AgentEffort;
  /** Copilot only: an empty directory the session runs from. */
  sessionCwd?: string;
}

export interface CompletionResult {
  text: string;
  costUsd: number;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

/**
 * One prompt in, one answer out — no tools, no MCP subprocess, no streaming to a
 * caller. For utility calls (classifying, reviewing a draft) that would be
 * wasteful to run through the full agent loop. Credential handling matches the
 * turn path: `claudeEnv` strips every outranking credential before setting the
 * caller's own, so a one-shot never bills the server's account.
 */
export async function completeOnce(
  prompt: string,
  cfg: CompletionConfig,
  opts: { timeoutMs?: number } = {},
): Promise<CompletionResult> {
  return cfg.provider === "copilot"
    ? completeCopilot(prompt, cfg, opts)
    : completeClaude(prompt, cfg, opts);
}

async function completeClaude(
  prompt: string,
  cfg: CompletionConfig,
  opts: { timeoutMs?: number },
): Promise<CompletionResult> {
  const controller = new AbortController();
  const timer = opts.timeoutMs
    ? setTimeout(() => controller.abort(), opts.timeoutMs)
    : undefined;
  try {
    let text = "";
    let costUsd = 0;
    let usage: CompletionResult["usage"] = {
      inputTokens: null,
      outputTokens: null,
    };
    for await (const msg of query({
      prompt,
      options: {
        abortController: controller,
        model: effectiveModel(cfg),
        ...(cfg.effort ? { effort: cfg.effort } : {}),
        ...(cfg.systemPrompt ? { systemPrompt: cfg.systemPrompt } : {}),
        settingSources: [],
        strictMcpConfig: true,
        tools: [],
        title: "tachy",
        permissionMode: "default",
        allowedTools: [],
        mcpServers: {},
        includePartialMessages: false,
        env: claudeEnv(cfg),
      },
    })) {
      if (msg.type === "result") {
        const r = msg as {
          result?: string;
          total_cost_usd?: number;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        text = r.result ?? "";
        costUsd = r.total_cost_usd ?? 0;
        usage = {
          inputTokens: r.usage?.input_tokens ?? null,
          outputTokens: r.usage?.output_tokens ?? null,
        };
      }
    }
    return { text, costUsd, usage };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function completeCopilot(
  prompt: string,
  cfg: CompletionConfig,
  opts: { timeoutMs?: number },
): Promise<CompletionResult> {
  const client = new CopilotClient({
    ...(cfg.sessionCwd ? { workingDirectory: cfg.sessionCwd } : {}),
    logLevel: "error",
  });
  try {
    await client.start();
    const session = await client.createSession({
      ...(cfg.agentAuth ? { gitHubToken: cfg.agentAuth.value } : {}),
      model: effectiveModel(cfg),
      ...(cfg.sessionCwd ? { workingDirectory: cfg.sessionCwd } : {}),
      ...(cfg.systemPrompt
        ? { systemMessage: { mode: "append", content: cfg.systemPrompt } }
        : {}),
      skipCustomInstructions: true,
      availableTools: [],
    });

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let sawUsage = false;
    session.on((event) => {
      if (event.type === "assistant.message" && event.data.content)
        text = event.data.content;
      else if (event.type === "assistant.usage") {
        sawUsage = true;
        inputTokens += event.data.inputTokens ?? 0;
        outputTokens += event.data.outputTokens ?? 0;
      }
    });
    await session.sendAndWait({ prompt }, opts.timeoutMs ?? 60_000);
    return {
      text,
      costUsd: 0,
      usage: {
        inputTokens: sawUsage ? inputTokens : null,
        outputTokens: sawUsage ? outputTokens : null,
      },
    };
  } finally {
    await client.stop().catch(() => {});
  }
}
