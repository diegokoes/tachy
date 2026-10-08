import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeEnv } from "./claude";
import { effectiveModel, type AgentAuth, type AgentEffort } from "./backend";

/**
 * The subset of a turn's config a bare completion needs: no MCP server, no cwd,
 * no per-user config dir. Kept separate from AgentConfig so a caller does not
 * have to assemble the MCP plumbing a one-shot call never touches.
 */
export interface CompletionConfig {
  model?: string;
  allowedModels?: string[];
  agentAuth?: AgentAuth;
  systemPrompt?: string;
  effort?: AgentEffort;
}

export interface CompletionResult {
  text: string;
  costUsd: number;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

/**
 * One prompt in, one answer out - no tools, no MCP subprocess, no streaming to a
 * caller. For utility calls (classifying, reviewing a draft) that would be
 * wasteful to run through the full agent loop. Credential handling matches the
 * turn path: `claudeEnv` strips every outranking credential before setting the
 * caller's own, so a one-shot never bills the server's account.
 */
export async function completeOnce(
  prompt: string,
  config: CompletionConfig,
  opts: { timeoutMs?: number } = {},
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
    for await (const sdkMessage of query({
      prompt,
      options: {
        abortController: controller,
        model: effectiveModel(config),
        ...(config.effort ? { effort: config.effort } : {}),
        ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
        settingSources: [],
        strictMcpConfig: true,
        tools: [],
        title: "tachy",
        permissionMode: "default",
        allowedTools: [],
        mcpServers: {},
        includePartialMessages: false,
        env: claudeEnv(config),
      },
    })) {
      if (sdkMessage.type === "result") {
        const resultMessage = sdkMessage as {
          result?: string;
          total_cost_usd?: number;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        text = resultMessage.result ?? "";
        costUsd = resultMessage.total_cost_usd ?? 0;
        usage = {
          inputTokens: resultMessage.usage?.input_tokens ?? null,
          outputTokens: resultMessage.usage?.output_tokens ?? null,
        };
      }
    }
    return { text, costUsd, usage };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
