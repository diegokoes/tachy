import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ModelImage } from "@tachy/core/files";
import { claudeEnv } from "./claude";
import {
  effectiveModel,
  turnUsage,
  type AgentAuth,
  type AgentEffort,
  type SdkUsage,
  type TurnUsage,
} from "./backend";

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
  usage: TurnUsage;
}

/**
 * One prompt in, one answer out - no tools, no MCP subprocess, no streaming to a
 * caller. For utility calls (classifying, reviewing a draft) that would be
 * wasteful to run through the full agent loop. Credential handling matches the
 * turn path: `claudeEnv` passes on no credential of the server's and sets the
 * caller's own, so a one-shot never bills the server's account.
 */
/**
 * A prompt with pictures, as the one user message of a call. The SDK takes
 * images only on a stream of messages, never beside a plain string; they go
 * before the text, where a model reads them best.
 */
export async function* withImages(
  prompt: string,
  images: ModelImage[],
): AsyncGenerator<SDKUserMessage> {
  yield {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        ...images.map((image) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: image.mimeType,
            data: Buffer.from(image.bytes).toString("base64"),
          },
        })),
        { type: "text" as const, text: prompt },
      ],
    },
  };
}

export async function completeOnce(
  prompt: string,
  config: CompletionConfig,
  opts: { timeoutMs?: number; images?: ModelImage[] } = {},
): Promise<CompletionResult> {
  const controller = new AbortController();
  const timer = opts.timeoutMs
    ? setTimeout(() => controller.abort(), opts.timeoutMs)
    : undefined;
  try {
    let text = "";
    let costUsd = 0;
    let usage = turnUsage(undefined);
    for await (const sdkMessage of query({
      prompt: opts.images?.length ? withImages(prompt, opts.images) : prompt,
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
          usage?: SdkUsage;
        };
        text = resultMessage.result ?? "";
        costUsd = resultMessage.total_cost_usd ?? 0;
        usage = turnUsage(resultMessage.usage);
      }
    }
    return { text, costUsd, usage };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
