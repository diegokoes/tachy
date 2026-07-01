<script lang="ts">
  import { chatStream, approve, uploadDoc } from "./agent";

  type Entry =
    | { kind: "user"; text: string }
    | { kind: "assistant"; text: string }
    | { kind: "tool"; tool: string }
    | { kind: "approval"; id: string; tool: string; editable: string; status: "pending" | "approved" | "denied" }
    | { kind: "error"; text: string };

  let entries = $state<Entry[]>([]);
  let input = $state("");
  let busy = $state(false);
  let sessionId = $state<string | undefined>(undefined);
  let turnId = $state<string | undefined>(undefined);
  let uploads = $state<{ path: string; filename: string }[]>([]);

  const short = (tool: string) => tool.replace(/^mcp__tachy__/, "");

  function appendAssistant(text: string) {
    const last = entries[entries.length - 1];
    if (last && last.kind === "assistant") last.text += text;
    else entries.push({ kind: "assistant", text });
  }

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    entries.push({ kind: "user", text: message });
    const uploadPaths = uploads.map((u) => u.path);
    input = "";
    uploads = [];
    busy = true;
    try {
      for await (const { event, data } of chatStream({ message, sessionId, uploadPaths: uploadPaths.length ? uploadPaths : undefined })) {
        if (event === "start") turnId = data.turnId as string;
        else if (event === "text") appendAssistant(data.text as string);
        else if (event === "tool_use") entries.push({ kind: "tool", tool: short(data.tool as string) });
        else if (event === "approval_request")
          entries.push({
            kind: "approval",
            id: data.id as string,
            tool: short(data.tool as string),
            editable: JSON.stringify(data.input, null, 2),
            status: "pending",
          });
        else if (event === "approval_resolved") {
          const a = entries.find((e) => e.kind === "approval" && e.id === data.id) as Extract<Entry, { kind: "approval" }> | undefined;
          if (a) a.status = data.approved ? "approved" : "denied";
        } else if (event === "result") sessionId = data.sessionId as string;
        else if (event === "error") entries.push({ kind: "error", text: data.message as string });
      }
    } catch (e) {
      entries.push({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      busy = false;
    }
  }

  async function decide(entry: Extract<Entry, { kind: "approval" }>, ok: boolean) {
    if (!turnId) return;
    let updated: Record<string, unknown> | undefined;
    if (ok) {
      try {
        updated = JSON.parse(entry.editable);
      } catch {
        entries.push({ kind: "error", text: "Edited JSON is invalid — fix it before approving." });
        return;
      }
    }
    await approve(turnId, entry.id, ok, updated);
    // status flips via the approval_resolved event
  }

  async function onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      uploads.push(await uploadDoc(file));
    } catch (err) {
      entries.push({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
    (e.target as HTMLInputElement).value = "";
  }
</script>

<div class="chat">
  <div class="transcript">
    {#each entries as e, i (i)}
      {#if e.kind === "user"}
        <div class="bubble user">{e.text}</div>
      {:else if e.kind === "assistant"}
        <div class="bubble assistant">{e.text}</div>
      {:else if e.kind === "tool"}
        <div class="tool">⚙ {e.tool}</div>
      {:else if e.kind === "error"}
        <div class="bubble error">{e.text}</div>
      {:else if e.kind === "approval"}
        <div class="approval {e.status}">
          <div class="ap-head">Agent wants to run <strong>{e.tool}</strong> — review & approve</div>
          <textarea bind:value={e.editable} disabled={e.status !== "pending"} rows="10"></textarea>
          {#if e.status === "pending"}
            <div class="ap-actions">
              <button class="approve" onclick={() => decide(e, true)}>Approve</button>
              <button onclick={() => decide(e, false)}>Deny</button>
            </div>
          {:else}
            <div class="ap-status">{e.status}</div>
          {/if}
        </div>
      {/if}
    {/each}
    {#if busy}<div class="tool">…thinking</div>{/if}
    {#if entries.length === 0}
      <div class="hint">
        <p>Ask about a ticket, or attach a document to save as knowledge.</p>
        <p class="muted">e.g. "Consult Freshdesk ticket 50912" · "Structure this doc into a knowledge entry"</p>
      </div>
    {/if}
  </div>

  {#if uploads.length}
    <div class="attachments">
      {#each uploads as u}<span class="attach">📎 {u.filename}</span>{/each}
    </div>
  {/if}

  <div class="composer">
    <label class="upload" title="Attach a document">
      📎<input type="file" onchange={onFile} hidden />
    </label>
    <textarea
      placeholder="Message the assistant…"
      bind:value={input}
      rows="2"
      onkeydown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      }}
    ></textarea>
    <button onclick={send} disabled={busy || !input.trim()}>Send</button>
  </div>
</div>

<style>
  .chat { display: flex; flex-direction: column; height: calc(100vh - 120px); }
  .transcript { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 0.6rem; padding-right: 0.5rem; }
  .bubble { max-width: 80%; padding: 0.6rem 0.8rem; border-radius: 10px; white-space: pre-wrap; line-height: 1.5; }
  .bubble.user { align-self: flex-end; background: var(--accent-dim); }
  .bubble.assistant { align-self: flex-start; background: var(--panel); border: 1px solid var(--border); }
  .bubble.error { align-self: flex-start; background: #3d1418; border: 1px solid #5c1a20; color: #ffb4ac; }
  .tool { align-self: flex-start; font-size: 0.8rem; color: var(--muted); }
  .approval { align-self: stretch; border: 1px solid var(--accent); border-radius: 10px; padding: 0.7rem; background: var(--panel); }
  .approval.approved { border-color: #3fb950; }
  .approval.denied { border-color: #f85149; opacity: 0.7; }
  .ap-head { font-size: 0.88rem; margin-bottom: 0.5rem; }
  .approval textarea { width: 100%; font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .ap-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .ap-actions .approve { border-color: #3fb950; color: #3fb950; }
  .ap-status { margin-top: 0.4rem; font-size: 0.82rem; color: var(--muted); text-transform: capitalize; }
  .attachments { display: flex; gap: 0.4rem; padding: 0.4rem 0; }
  .attach { font-size: 0.8rem; color: var(--muted); }
  .composer { display: flex; gap: 0.5rem; align-items: flex-end; padding-top: 0.6rem; border-top: 1px solid var(--border); }
  .composer textarea { flex: 1; resize: none; }
  .upload { cursor: pointer; align-self: center; font-size: 1.1rem; }
  .hint { color: var(--text); }
  .muted { color: var(--muted); }
</style>
