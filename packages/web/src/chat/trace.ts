/** What the server started the turn with: its `debug` frame. */
export interface TurnSent {
  systemPrompt: string;
  /** The user's message as the model gets it, expansions included. */
  prompt: string;
  model?: string;
  effort?: string;
  resumed: boolean;
  autoApprove: string[];
  redactionForced: boolean;
}

/** What Claude Code says it started with: the `session` frame. */
export interface SessionFacts {
  model: string;
  tools: string[];
  mcpServers: { name: string; status: string }[];
  credentialSource: string;
  skills: string[];
  plugins: string[];
}

export interface ToolTrace {
  id: string;
  tool: string;
  input?: unknown;
  /** Unset until the tool answers. */
  result?: unknown;
}

/** One turn as the agent layer saw it, kept only while debug is on. */
export interface TurnTrace {
  sent: TurnSent;
  session?: SessionFacts;
  /** Each model that answered, in order of first use; unset until the result. */
  answeredBy?: string[];
  calls: ToolTrace[];
}

const short = (tool: string) => tool.replace(/^mcp__tachy__/, "");

/** Folds one stream frame into the trace. Frames that say nothing new pass. */
export function recordFrame(
  trace: TurnTrace,
  event: string,
  data: Record<string, unknown>,
): void {
  if (event === "session") trace.session = data as unknown as SessionFacts;
  else if (event === "result" && Array.isArray(data.models))
    trace.answeredBy = data.models as string[];
  else if (event === "tool_use")
    trace.calls.push({
      id: String(data.id ?? ""),
      tool: short(String(data.tool ?? "")),
      input: data.input,
    });
  else if (event === "tool_result") {
    const call = trace.calls.find(
      (c) => c.id === data.id && c.result === undefined,
    );
    // A tool the stream never announced, such as ToolSearch, still answered.
    if (call) call.result = data.result;
    else
      trace.calls.push({
        id: String(data.id ?? ""),
        tool: short(String(data.tool ?? "")),
        result: data.result,
      });
  }
}

const IMAGE_SENT = "[image sent]";

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * A tool result as the model read it. The stream carries a picture as a bare
 * block with no bytes, which is shown as a mark that one was sent.
 */
export function resultText(result: unknown): string {
  if (result === undefined) return "";
  if (typeof result === "string") return pretty(result);
  if (!Array.isArray(result)) return JSON.stringify(result, null, 2);
  return result
    .map((block: { type?: string; text?: string } | null) => {
      if (block?.type === "text") return pretty(block.text ?? "");
      if (block?.type === "image") return IMAGE_SENT;
      return JSON.stringify(block, null, 2);
    })
    .join("\n\n");
}

/** The stand-ins redaction leaves: `[EMAIL_1]`, `[USER_12]`, `[CUSTOMER]`. */
const STAND_IN_RE = /\[(?:[A-Z]+_\d+|CUSTOMER)\]/g;

/** How many distinct values were replaced in `text`. */
export function redactedCount(text: string): number {
  return new Set(text.match(STAND_IN_RE)).size;
}

/**
 * Null when the model that answered is the one asked for, or when there is
 * nothing to compare yet. An alias such as `haiku` matches the full id it
 * resolves to.
 */
export function modelMismatch(trace: TurnTrace): string | null {
  const asked = trace.sent.model;
  const answered = trace.answeredBy ?? [];
  if (!asked || !answered.length) return null;
  // `opus[1m]` asks for a context window, which the answering id leaves out.
  const family = asked.replace(/\[.*\]$/, "");
  if (answered.every((model) => model.includes(family))) return null;
  return `asked ${asked}, answered by ${answered.join(", ")}`;
}

/** The model to name on the collapsed row: what answered, else what started. */
export function ranOn(trace: TurnTrace): string {
  return (
    trace.answeredBy?.join(", ") ||
    trace.session?.model ||
    trace.sent.model ||
    "settings default"
  );
}
