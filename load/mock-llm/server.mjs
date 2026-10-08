// A stand-in for the Anthropic Messages API, so chat turns can be load-tested
// without a provider key or a bill. Point Claude Code at it with
// ANTHROPIC_BASE_URL=http://<host>:<port> and any ANTHROPIC_API_KEY.
//
// Each turn is scripted from the conversation so far: while fewer than
// MOCK_TOOL_ROUNDS tool results have come back, it calls the next tool from
// MOCK_TOOLS (matched by suffix against the tools the request offers);
// then it answers with text. Requests that offer no matching tool (Claude
// Code's own side calls) get a short text answer.
//
//   MOCK_PORT=4010 MOCK_DELAY_MS=800 node load/mock-llm/server.mjs
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? 500);
const ROUNDS = Number(process.env.MOCK_TOOL_ROUNDS ?? 2);
const TOOLS = (process.env.MOCK_TOOLS ?? "search_knowledge,search_reference")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const QUERIES = [
  "printer queue stalls after reboot",
  "line controller failover heartbeat",
  "vpn drops every hour",
  "certificate expired on the gateway",
];

let served = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toolResultsSoFar(messages = []) {
  let n = 0;
  for (const message of messages)
    if (Array.isArray(message.content))
      for (const block of message.content)
        if (block.type === "tool_result") n++;
  return n;
}

function plan(body) {
  const offered = (body.tools ?? []).map((t) => t.name);
  const done = toolResultsSoFar(body.messages);
  const want = TOOLS[done % Math.max(TOOLS.length, 1)];
  const name = want && offered.find((n) => n.endsWith(want));
  if (name && done < ROUNDS)
    return {
      kind: "tool_use",
      block: {
        type: "tool_use",
        id: `toolu_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
        name,
        input: { query: QUERIES[(served + done) % QUERIES.length] },
      },
    };
  return {
    kind: "text",
    block: {
      type: "text",
      text: offered.length
        ? `Mock answer after ${done} tool call(s). Nothing here is real.`
        : "ok",
    },
  };
}

const usage = { input_tokens: 1200, output_tokens: 1 };

function messageJson(body, planned) {
  return {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: body.model ?? "mock",
    content: [planned.block],
    stop_reason: planned.kind === "tool_use" ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 40 },
  };
}

function sse(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function stream(response, body, planned) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const message = messageJson(body, planned);
  sse(response, "message_start", {
    type: "message_start",
    message: { ...message, content: [], stop_reason: null, usage },
  });
  if (planned.kind === "tool_use") {
    sse(response, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { ...planned.block, input: {} },
    });
    sse(response, "content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify(planned.block.input),
      },
    });
  } else {
    sse(response, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    sse(response, "content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: planned.block.text },
    });
  }
  sse(response, "content_block_stop", { type: "content_block_stop", index: 0 });
  sse(response, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: { output_tokens: 40 },
  });
  sse(response, "message_stop", { type: "message_stop" });
  response.end();
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://mock");
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};

  if (
    request.method === "POST" &&
    url.pathname === "/v1/messages/count_tokens"
  ) {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(JSON.stringify({ input_tokens: 1200 }));
  }
  if (request.method === "POST" && url.pathname === "/v1/messages") {
    served++;
    await sleep(DELAY_MS);
    const planned = plan(body);
    if (body.stream) return stream(response, body, planned);
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(JSON.stringify(messageJson(body, planned)));
  }
  if (request.method === "GET" && url.pathname === "/stats") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(JSON.stringify({ served }));
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      type: "error",
      error: { type: "not_found_error", message: `mock: ${url.pathname}` },
    }),
  );
});

server.listen(PORT, () =>
  console.log(
    `mock Anthropic API on :${PORT} (delay ${DELAY_MS} ms, ${ROUNDS} tool rounds)`,
  ),
);
