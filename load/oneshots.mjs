// One-shot model calls against the mock LLM (load/mock-llm/server.mjs), made
// the way completeOnce makes them: Claude Code with no tools and no MCP child.
// Report review, ticket review and a flow's agent.ask step are such calls, and
// none of them takes a chat slot. Measures what N at once add to the
// container's memory, which is what a worker's mem_limit has to hold.
//
//   docker compose -p tachy-load -f load/turns.compose.yml exec api-load \
//     node load/oneshots.mjs
//
// LEVELS=1,2,4 sets the concurrency of each round, PROMPT_KB the size of each
// prompt. Run it inside a container: it reads that container's cgroup. Never
// run it with a real provider key.
import { readFileSync, readdirSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

const LEVELS = (process.env.LEVELS ?? "1,2,4").split(",").map(Number);
const PROMPT_KB = Number(process.env.PROMPT_KB ?? 2);
const SYSTEM =
  "You are one step of an automated support flow. Answer the instruction only, from the material given.";
const MATERIAL = "Ticket 7001: the scanner is offline after a reboot. "
  .repeat(Math.ceil((PROMPT_KB * 1024) / 52))
  .slice(0, PROMPT_KB * 1024);

if (!process.env.ANTHROPIC_BASE_URL) {
  console.error(
    "ANTHROPIC_BASE_URL is not set: this would call a real provider",
  );
  process.exit(2);
}

const cgroupBytes = () => {
  try {
    return Number(readFileSync("/sys/fs/cgroup/memory.current", "utf8"));
  } catch {
    return null;
  }
};

/** Summed RSS of the Claude Code processes: counts the pages they share once each. */
function claudeRssBytes() {
  let kb = 0;
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      if (/^Name:\s+claude$/m.test(status))
        kb += Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0);
    } catch {
      // The process ended between the listing and the read.
    }
  }
  return kb * 1024;
}

async function once() {
  let text = "";
  for await (const msg of query({
    prompt: `Summarise this for a developer.\n\n---\n${MATERIAL}`,
    options: {
      systemPrompt: SYSTEM,
      settingSources: [],
      strictMcpConfig: true,
      tools: [],
      title: "tachy",
      permissionMode: "default",
      allowedTools: [],
      mcpServers: {},
      includePartialMessages: false,
      env: {
        ...process.env,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      },
    },
  }))
    if (msg.type === "result") text = msg.result ?? "";
  return text;
}

const mib = (bytes) => Math.round(bytes / 2 ** 20);

for (const n of LEVELS) {
  const baseline = cgroupBytes();
  let peak = baseline ?? 0;
  let peakRss = 0;
  let polling = true;
  const poller = (async () => {
    while (polling) {
      peak = Math.max(peak, cgroupBytes() ?? 0);
      peakRss = Math.max(peakRss, claudeRssBytes());
      await new Promise((r) => setTimeout(r, 250));
    }
  })();

  const t0 = performance.now();
  const answers = await Promise.all(Array.from({ length: n }, once));
  polling = false;
  await poller;

  console.log(
    JSON.stringify({
      concurrent: n,
      ok: answers.filter(Boolean).length,
      totalMs: Math.round(performance.now() - t0),
      promptKb: PROMPT_KB,
      memory:
        baseline === null
          ? "no cgroup visible (run inside the container to measure memory)"
          : {
              baselineMiB: mib(baseline),
              peakMiB: mib(peak),
              perCallMiB: Math.round((peak - baseline) / 2 ** 20 / n),
            },
      claudeRss: { peakMiB: mib(peakRss), perCallMiB: mib(peakRss / n) },
    }),
  );
  await new Promise((r) => setTimeout(r, 2000));
}
process.exit(0);
