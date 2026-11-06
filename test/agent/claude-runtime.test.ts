/**
 * The bundled Claude Code, started with tachy's own options and gate, against a
 * scripted model: what a model can reach, and what waits for a person.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claudeOptions, turnCanUseTool } from "../../packages/agent/src/claude";
import type { AgentConfig } from "../../packages/agent/src/backend";
import { startTurnTools } from "../../packages/agent/src/turn-tools";
import {
  startScriptedModel,
  type ScriptedCall,
  type ScriptedModel,
} from "./scripted-model";

const STUB_TOOLS = fileURLToPath(
  new URL("../fixtures/stub-tools.mjs", import.meta.url),
);
const TACHY = "mcp__tachy__";
const BUILT_INS_ASKED = ["Bash", "Read", "WebFetch", "Agent"];

const CALLS: ScriptedCall[] = [
  { name: "Bash", input: { command: "id", description: "who" } },
  { name: "Read", input: { file_path: "/etc/hostname" } },
  { name: "WebFetch", input: { url: "https://example.com", prompt: "read" } },
  {
    name: "Agent",
    input: {
      description: "who",
      prompt: "run id",
      subagent_type: "general-purpose",
    },
  },
  { name: `${TACHY}search_knowledge`, input: { query: "vpn" } },
  {
    name: `${TACHY}ingest_context`,
    input: { urls: ["https://example.com/page?d=1"] },
  },
  { name: `${TACHY}ingest_context`, input: { text: "pasted notes" } },
  {
    name: `${TACHY}post_private_note`,
    input: { source: "fd", external_id: "1", body: "note" },
  },
];

interface ToolResult {
  tool: string;
  isError: boolean;
}

interface ScriptedTurn {
  startedWith: string[];
  results: ToolResult[];
  reviewed: string[];
  ran: string[];
}

async function runScriptedTurn(modelUrl: string): Promise<ScriptedTurn> {
  const stateDir = mkdtempSync(join(tmpdir(), "tachy-runtime-"));
  const toolsLog = join(stateDir, "tools.log");
  const config: AgentConfig = {
    mcpCommand: process.execPath,
    mcpArgs: [STUB_TOOLS],
    mcpEnv: { STUB_TOOLS_LOG: toolsLog },
    cwd: stateDir,
    systemPrompt: "runtime test",
    configDir: join(stateDir, "claude"),
    agentAuth: { kind: "anthropic_api_key", value: "sk-ant-api03-runtime" },
  };
  const reviewed: string[] = [];
  const gate = async (_id: string, tool: string, input: unknown) => {
    reviewed.push(tool.slice(TACHY.length));
    if (tool !== `${TACHY}post_private_note`) return { approve: false };
    const edited = { ...(input as object), body: "edited by the person" };
    return { approve: true, updatedInput: edited };
  };
  const tools = await startTurnTools({
    command: config.mcpCommand,
    args: config.mcpArgs,
    env: config.mcpEnv,
    cwd: config.cwd,
  });
  const options = claudeOptions(config, {
    abortController: new AbortController(),
    canUseTool: turnCanUseTool({ tools, gate }),
    toolServer: tools.serverConfig,
  });
  // A turn's own options; the env only points Claude Code at the scripted
  // model and keeps it off the network.
  options.env = {
    ...options.env,
    ANTHROPIC_BASE_URL: modelUrl,
    HOME: stateDir,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };

  const toolNames = new Map<string, string>();
  const turn: ScriptedTurn = {
    startedWith: [],
    results: [],
    reviewed,
    ran: [],
  };
  try {
    for await (const message of query({ prompt: "go", options })) {
      if (message.type === "system" && message.subtype === "init")
        turn.startedWith = message.tools;
      if (message.type === "assistant")
        for (const block of message.message.content)
          if (block.type === "tool_use") toolNames.set(block.id, block.name);
      if (message.type !== "user" || !Array.isArray(message.message.content))
        continue;
      for (const block of message.message.content)
        if (block.type === "tool_result")
          turn.results.push({
            tool: toolNames.get(block.tool_use_id) ?? "",
            isError: block.is_error === true,
          });
    }
  } finally {
    await tools.close();
  }
  if (existsSync(toolsLog))
    turn.ran = readFileSync(toolsLog, "utf8").trim().split("\n");
  return turn;
}

describe("Claude Code under tachy's options", () => {
  let model: ScriptedModel;
  let turn: ScriptedTurn;

  beforeAll(async () => {
    model = await startScriptedModel(CALLS);
    turn = await runScriptedTurn(model.url);
  });

  afterAll(() => model.close());

  it("starts with no built-in tool but ToolSearch", () => {
    expect(
      turn.startedWith.filter((tool) => !tool.startsWith("mcp__")),
    ).toEqual(["ToolSearch"]);
  });

  it("refuses every built-in the model asks for", () => {
    for (const tool of BUILT_INS_ASKED)
      expect(turn.results.find((result) => result.tool === tool)).toEqual({
        tool,
        isError: true,
      });
  });

  it("runs reads and pasted text without a person", () => {
    expect(turn.ran).toContain("search_knowledge");
    expect(turn.ran).toContain("ingest_context text");
  });

  it("puts a URL fetch and a write in front of a person, and runs only what they approve", () => {
    expect(turn.reviewed).toEqual(["ingest_context", "post_private_note"]);
    expect(turn.ran).not.toContain("ingest_context urls");
  });

  it("runs an approved write with the person's edit", () => {
    expect(turn.ran).toContain("post_private_note edited by the person");
  });
});
