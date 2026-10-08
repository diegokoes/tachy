import { onUnauthorized } from "../access/session.svelte";

export interface ChatBody {
  message: string;
  sessionId?: string;
  uploadPaths?: string[];
  artifactId?: string;
  command?: { name: string; args: string };
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
}

export interface CommandArtifactMeta {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  scope: string;
}

export async function getCommands(): Promise<{
  builtins: BuiltinCommandMeta[];
  artifacts: CommandArtifactMeta[];
}> {
  const response = await fetch("/api/agent/commands");
  if (response.status === 401) {
    onUnauthorized();
    return { builtins: [], artifacts: [] };
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
    const body = (await Promise.resolve()
      .then(() => response.json())
      .catch(() => ({}))) as {
      error?: string;
      turnId?: string;
    };
    throw new ChatRefused(
      response.status,
      body.error ?? `agent chat failed: ${response.status}`,
      body.turnId,
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
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `could not attach ${file.name}: ${body?.error ?? `upload failed (${response.status} ${response.statusText})`}`,
    );
  return { ...body, image: file.type.startsWith("image/") };
}
