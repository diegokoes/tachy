// SSE over fetch (EventSource can't POST a JSON body). Streams the agent turn
// events emitted by POST /api/agent/chat.
import { onUnauthorized } from "./session.svelte";

export interface ChatBody {
  message: string;
  sessionId?: string;
  uploadPaths?: string[];
}

export interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

export async function* chatStream(body: ChatBody, signal?: AbortSignal): AsyncGenerator<SseFrame> {
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) {
    onUnauthorized();
    return;
  }
  if (!res.ok || !res.body) throw new Error(`agent chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) yield { event, data: JSON.parse(data) as Record<string, unknown> };
    }
  }
}

export async function approve(
  turnId: string,
  id: string,
  approveIt: boolean,
  updatedInput?: Record<string, unknown>,
): Promise<void> {
  await fetch("/api/agent/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnId, id, approve: approveIt, updatedInput }),
  });
}

export async function uploadDoc(file: File): Promise<{ path: string; filename: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/agent/uploads", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json();
}
