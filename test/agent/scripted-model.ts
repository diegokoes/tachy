/** A stand-in for the Anthropic Messages API that answers with scripted tool calls. */
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface ScriptedCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ScriptedModel {
  url: string;
  /** The messages of the latest request that offered tools. */
  transcript(): { role: string; content: unknown }[];
  close(): Promise<void>;
}

type Block = Record<string, any>;

const FINAL_TEXT = "done";

const toolCallsSoFar = (messages: { role: string; content: unknown }[]) =>
  messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      Array.isArray(message.content) ? (message.content as Block[]) : [],
    )
    .filter((block) => block.type === "tool_use").length;

/** The next scripted call, or the closing text; side calls offering no tools get text. */
function nextBlock(body: Record<string, any>, calls: ScriptedCall[]): Block {
  const offersTools = Array.isArray(body.tools) && body.tools.length > 0;
  const done = toolCallsSoFar(body.messages ?? []);
  if (!offersTools || done >= calls.length)
    return { type: "text", text: FINAL_TEXT };
  return {
    type: "tool_use",
    id: `toolu_scripted_${done}`,
    name: calls[done].name,
    input: calls[done].input,
  };
}

function sendEvent(response: ServerResponse, event: string, data: object) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function answer(response: ServerResponse, block: Block, streamed: boolean) {
  const stopReason = block.type === "tool_use" ? "tool_use" : "end_turn";
  const message = {
    id: "msg_scripted",
    type: "message",
    role: "assistant",
    model: "claude-scripted",
    content: [block],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  if (!streamed) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(message));
    return;
  }
  const opening =
    block.type === "tool_use"
      ? { ...block, input: {} }
      : { ...block, text: "" };
  const delta =
    block.type === "tool_use"
      ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
      : { type: "text_delta", text: block.text };
  response.writeHead(200, { "content-type": "text/event-stream" });
  sendEvent(response, "message_start", {
    type: "message_start",
    message: { ...message, content: [], stop_reason: null },
  });
  sendEvent(response, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: opening,
  });
  sendEvent(response, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta,
  });
  sendEvent(response, "content_block_stop", {
    type: "content_block_stop",
    index: 0,
  });
  sendEvent(response, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  sendEvent(response, "message_stop", { type: "message_stop" });
  response.end();
}

export async function startScriptedModel(
  calls: ScriptedCall[],
): Promise<ScriptedModel> {
  let transcript: { role: string; content: unknown }[] = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const path = new URL(request.url ?? "/", "http://model").pathname;
    if (request.method === "POST" && path === "/v1/messages/count_tokens") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ input_tokens: 1 }));
      return;
    }
    if (request.method === "POST" && path === "/v1/messages") {
      const body = JSON.parse(raw);
      if (Array.isArray(body.tools) && body.tools.length)
        transcript = body.messages ?? [];
      answer(response, nextBlock(body, calls), body.stream === true);
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ type: "error", error: { type: "not_found_error" } }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    transcript: () => transcript,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
