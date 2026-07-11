import { randomUUID } from "node:crypto";
import {
  CopilotClient,
  type PermissionRequest,
  type PermissionRequestResult,
  type SessionConfig,
} from "@github/copilot-sdk";
import { classify, qualify, MCP_SERVER } from "./tools";
import { effectiveModel, type AgentConfig } from "./backend";
import { TurnBase, type ApprovalGate } from "./turn";

export async function copilotPermission(
  request: PermissionRequest,
  gate: ApprovalGate,
): Promise<PermissionRequestResult> {
  if (request.kind !== "mcp" || request.serverName !== MCP_SERVER)
    return {
      kind: "reject",
      feedback: "Only tachy knowledge tools are available.",
    };

  const qualified = qualify(request.toolName);
  const { cls } = classify(qualified);
  if (cls === "read") return { kind: "approve-once" };
  if (cls === "denied")
    return {
      kind: "reject",
      feedback: `Tool ${request.toolName} is not permitted. Only tachy knowledge tools are available.`,
    };

  const input = request.args ?? {};
  const decision = await gate(request.toolCallId ?? randomUUID(), qualified, input);
  if (!decision.approve)
    return {
      kind: "reject",
      feedback: decision.message ?? "Denied by user.",
    };
  if (
    decision.updatedInput &&
    JSON.stringify(decision.updatedInput) !== JSON.stringify(input)
  )
    return {
      kind: "reject",
      feedback: `The user approved this action but edited the input. Call ${request.toolName} again with exactly this input, then stop: ${JSON.stringify(decision.updatedInput)}`,
    };
  return { kind: "approve-once" };
}

export class CopilotTurn extends TurnBase {
  constructor(
    prompt: string,
    cfg: AgentConfig,
    opts: { resume?: string } = {},
  ) {
    super();
    void this.pump(prompt, cfg, opts);
  }

  private async pump(
    prompt: string,
    cfg: AgentConfig,
    opts: { resume?: string },
  ): Promise<void> {
    let client: CopilotClient | undefined;
    try {
      client = new CopilotClient({
        workingDirectory: cfg.cwd,
        logLevel: "error",
        ...(cfg.agentKey ? { gitHubToken: cfg.agentKey } : {}),
      });
      await client.start();

      const sessionConfig: SessionConfig = {
        model: effectiveModel(cfg),
        systemMessage: { mode: "append", content: cfg.systemPromptAppend },
        availableTools: ["mcp:*"],
        mcpServers: {
          [MCP_SERVER]: {
            type: "stdio",
            command: cfg.mcpCommand,
            args: cfg.mcpArgs,
            env: cfg.mcpEnv,
          },
        },
        onPermissionRequest: (request) =>
          copilotPermission(request, this.requestApproval),
      };

      const session = opts.resume
        ? await client.resumeSession(opts.resume, sessionConfig)
        : await client.createSession(sessionConfig);

      let inputTokens = 0;
      let outputTokens = 0;
      let sawUsage = false;
      let premium = 0;
      let lastText = "";

      session.on((event) => {
        switch (event.type) {
          case "assistant.message":
            if (event.data.content) {
              lastText = event.data.content;
              this.q.push({ type: "text", text: event.data.content });
            }
            break;
          case "tool.execution_start": {
            if (event.data.mcpServerName !== MCP_SERVER) break;
            const base = event.data.mcpToolName ?? event.data.toolName;
            if (classify(qualify(base)).cls === "read")
              this.q.push({
                type: "tool_use",
                tool: base,
                input: event.data.arguments ?? {},
                id: event.data.toolCallId,
              });
            break;
          }
          case "assistant.usage":
            sawUsage = true;
            inputTokens += event.data.inputTokens ?? 0;
            outputTokens += event.data.outputTokens ?? 0;
            premium += event.data.cost ?? 0;
            break;
          case "session.error":
            this.q.push({ type: "error", message: event.data.message });
            break;
        }
      });

      // sendAndWait defaults to a 60s timeout; approval waits need far more.
      await session.sendAndWait({ prompt }, 30 * 60_000);

      this.q.push({
        type: "result",
        result: lastText,
        costUsd: 0,
        sessionId: session.sessionId,
        usage: {
          inputTokens: sawUsage ? inputTokens : null,
          outputTokens: sawUsage ? outputTokens : null,
          premiumRequests: premium > 0 ? premium : 1,
        },
      });
    } catch (e) {
      this.q.push({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.settlePending();
      if (client) await client.stop().catch(() => {});
      this.q.close();
    }
  }
}
