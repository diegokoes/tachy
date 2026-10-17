import { onUnauthorized } from "../access/session.svelte";
import {
  isProblemType,
  type AgentEffort,
  type ChatModeName,
  type Mention,
  type UploadLimits,
} from "@tachy/contract";
import { readError } from "../problems";

export interface ChatBody {
  message: string;
  sessionId?: string;
  uploadPaths?: string[];
  artifactId?: string;
  command?: { name: string; args: string };
  mode?: { name: ChatModeName; args: string };
  /** The mode the previous turn ran in, when the user has since left it. */
  leftMode?: ChatModeName;
  mentions?: Mention[];
  /** The conversation's `/model` pick; unset, the settings decide. */
  model?: string;
  effort?: AgentEffort;
  /** Asks for the turn's debug frames, which only an app admin is sent. */
  debug?: boolean;
}

export interface SubcommandMeta {
  name: string;
  args: string;
  description: string;
  /** Handled in the browser; sending it would start no turn. */
  client?: boolean;
}

export interface BuiltinCommandMeta {
  name: string;
  args: string;
  description: string;
  subcommands?: SubcommandMeta[];
  /** Sent by a control, never offered in the menu. */
  hidden?: boolean;
}

export interface ChatModeMeta {
  name: ChatModeName;
  args: string;
  description: string;
}

export interface CommandArtifactMeta {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  scope: string;
}

export interface ChatCommands {
  modes: ChatModeMeta[];
  builtins: BuiltinCommandMeta[];
  artifacts: CommandArtifactMeta[];
  /** This server's own; absent until it answers, when the defaults apply. */
  uploadLimits?: UploadLimits;
}

export async function getCommands(): Promise<ChatCommands> {
  const response = await fetch("/api/agent/commands");
  if (response.status === 401) {
    onUnauthorized();
    return { modes: [], builtins: [], artifacts: [] };
  }
  if (!response.ok) throw new Error(`commands failed: ${response.status}`);
  return response.json();
}

/** The server declined to start a turn: 409 carries the turn already running. */
export class ChatRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly turnId?: string,
  ) {
    super(message);
  }
}

export interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

export async function* chatStream(
  body: ChatBody,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const response = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status === 401) {
    onUnauthorized();
    return;
  }
  if (!response.ok) {
    const refusal = await readError(response);
    const running = isProblemType(refusal.problem, "turn-in-progress")
      ? refusal.problem?.turnId
      : undefined;
    throw new ChatRefused(
      response.status,
      refusal.message,
      typeof running === "string" ? running : undefined,
    );
  }
  if (!response.body) throw new Error(`agent chat failed: ${response.status}`);

  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buffered = "";
  // The `finally` cancels the reader: a consumer that stops early (the caller's
  // catch, the component destroyed mid-turn) leaves this generator suspended at
  // a yield, with the response body open.
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += dec.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffered.indexOf("\n\n")) >= 0) {
        const raw = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        let event = "message";
        let data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (data)
          yield { event, data: JSON.parse(data) as Record<string, unknown> };
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * A turn that has finished (approval timed out, or the TTL reaped it) answers
 * 404. Thrown, so the card does not sit pending with a button that does
 * nothing.
 */
export async function approve(
  turnId: string,
  id: string,
  approveIt: boolean,
  updatedInput?: Record<string, unknown>,
  message?: string,
): Promise<void> {
  const response = await fetch("/api/agent/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turnId,
      id,
      approve: approveIt,
      updatedInput,
      message,
    }),
  });
  if (response.status === 401) {
    onUnauthorized();
    return;
  }
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "this turn already finished; the approval expired"
        : `could not record the decision (${response.status})`,
    );
}

export async function stopTurn(turnId: string): Promise<void> {
  const response = await fetch("/api/agent/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnId }),
  });
  if (response.status === 401) {
    onUnauthorized();
    return;
  }
  if (!response.ok && response.status !== 404)
    throw new Error(`could not stop the turn (${response.status})`);
}

export async function uploadDoc(
  file: File,
): Promise<{ path: string; filename: string; image: boolean }> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/agent/uploads", {
    method: "POST",
    body: form,
  });
  if (response.status === 401) onUnauthorized();
  if (!response.ok)
    throw new Error(
      `could not attach ${file.name}: ${(await readError(response)).message}`,
    );
  const body = await response.json();
  return { ...body, image: file.type.startsWith("image/") };
}
