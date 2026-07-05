<script lang="ts">
  import { tick } from "svelte";
  import { chatStream, approve, uploadDoc } from "./agent";
  import { renderMarkdown } from "./markdown";
  import { gsap, SplitText, reducedMotion } from "./gsap";
  import TypeLine from "./TypeLine.svelte";
  import AsciiScrollbar from "./AsciiScrollbar.svelte";

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

  // Stick-to-bottom: sending always snaps; streamed growth snaps only while
  // the user hasn't scrolled up to read something.
  let transcriptEl = $state<HTMLDivElement>();
  let pinned = true;

  function onScroll() {
    const el = transcriptEl;
    if (el) pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  async function snap(force = false) {
    if (force) pinned = true;
    await tick();
    const el = transcriptEl;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }

  // Drop & shatter for a denied proposal: chars rain off, then the block
  // collapses. Runs when the denied <pre> replaces the textarea.
  function shatter(node: HTMLElement) {
    if (reducedMotion()) return;
    const split = new SplitText(node, { type: "chars", reduceWhiteSpace: false });
    const tl = gsap.timeline({
      onComplete: () => {
        split.revert();
        node.style.visibility = "hidden";
      },
    });
    tl.to(split.chars, {
      y: () => gsap.utils.random(60, 200),
      rotation: () => gsap.utils.random(-30, 30),
      opacity: 0,
      duration: 0.6,
      ease: "power1.in",
      stagger: { amount: 0.45 },
    });
    tl.to(node, { height: 0, marginTop: 0, duration: 0.3 }, "-=0.15");
    return {
      destroy: () => {
        tl.kill();
        split.revert();
      },
    };
  }

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
    snap(true);
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
        snap();
      }
    } catch (e) {
      entries.push({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      snap();
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
        entries.push({ kind: "error", text: "Edited JSON is invalid - fix it before approving." });
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
  <div class="transcript-wrap">
  <div class="transcript" id="chat-transcript" bind:this={transcriptEl} onscroll={onScroll}>
    {#each entries as e, i (i)}
      {#if e.kind === "user"}
        <div class="bubble user">{e.text}</div>
      {:else if e.kind === "assistant"}
        <div class="bubble assistant md" class:streaming={busy && i === entries.length - 1}>{@html renderMarkdown(e.text)}</div>
      {:else if e.kind === "tool"}
        <div class="tool">⚙ {e.tool}</div>
      {:else if e.kind === "error"}
        <div class="bubble error">{e.text}</div>
      {:else if e.kind === "approval"}
        <div class="approval {e.status}">
          <div class="ap-head">Agent wants to run <strong>{e.tool}</strong> - review & approve</div>
          {#if e.status === "denied"}
            <pre class="proposal" use:shatter>{e.editable}</pre>
          {:else}
            <textarea bind:value={e.editable} disabled={e.status !== "pending"} rows="10"></textarea>
          {/if}
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
    {#if busy && entries[entries.length - 1]?.kind !== "assistant"}
      <div class="bubble assistant waiting"><span class="caret" aria-hidden="true"></span></div>
    {/if}
    {#if entries.length === 0}
      <div class="hint">
        <TypeLine text="Ask about a ticket, or attach a document to save as knowledge." />
      </div>
    {/if}
  </div>
  <AsciiScrollbar target={transcriptEl} controls="chat-transcript" />
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
  .chat { display: flex; flex-direction: column; height: 100%; }

  /* Retro terminal caret: solid block, hard on/off blink — no glow, no fade. */
  .caret {
    display: inline-block;
    width: 0.55em;
    height: 1.05em;
    margin-left: 0.15em;
    vertical-align: text-bottom;
    background: var(--text);
    animation: caret-blink 1.06s steps(2, jump-none) infinite;
  }

  .waiting { min-height: 1.4em; }

  @keyframes caret-blink {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  /* Assistant markdown. Rendered via {@html} so children need :global. */
  .md { white-space: normal; }
  .md :global(p) { margin: 0.4em 0; }
  .md :global(> :first-child) { margin-top: 0; }
  .md :global(> :last-child) { margin-bottom: 0; }
  .md :global(h1), .md :global(h2), .md :global(h3), .md :global(h4) {
    font-size: 1.02em;
    margin: 0.7em 0 0.35em;
    letter-spacing: 0.04em;
  }
  .md :global(ul), .md :global(ol) { margin: 0.4em 0; padding-left: 1.5em; }
  .md :global(li) { margin: 0.15em 0; }
  .md :global(code) {
    background: var(--accent-dim);
    border-radius: 3px;
    padding: 0.05em 0.35em;
    font-size: 0.92em;
  }
  .md :global(pre) {
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.6em 0.8em;
    margin: 0.5em 0;
    overflow-x: auto;
  }
  .md :global(pre code) { background: none; padding: 0; font-size: 0.85em; }
  .md :global(blockquote) {
    margin: 0.5em 0;
    padding-left: 0.8em;
    border-left: 3px solid var(--border);
    color: var(--muted);
  }
  .md :global(table) { border-collapse: collapse; margin: 0.5em 0; display: block; overflow-x: auto; }
  .md :global(th), .md :global(td) { border: 1px solid var(--border); padding: 0.25em 0.6em; }
  .md :global(hr) { border: none; border-top: 1px solid var(--border); margin: 0.7em 0; }

  /* While streaming, the block caret rides the end of the last element. */
  .md.streaming > :global(:last-child)::after {
    content: "";
    display: inline-block;
    width: 0.55em;
    height: 1.05em;
    margin-left: 0.15em;
    vertical-align: text-bottom;
    background: var(--text);
    animation: caret-blink 1.06s steps(2, jump-none) infinite;
  }
  .transcript-wrap { flex: 1; min-height: 0; display: flex; gap: 0.35rem; }
  /* Native bar hidden — the ASCII scrollbar next to it takes over. */
  .transcript { flex: 1; min-width: 0; overflow: auto; scrollbar-width: none; display: flex; flex-direction: column; gap: 0.6rem; padding-right: 0.5rem; }
  .transcript::-webkit-scrollbar { display: none; }
  .bubble { max-width: 80%; padding: 0.6rem 0.8rem; border-radius: 10px; white-space: pre-wrap; line-height: 1.5; }
  .bubble.user { align-self: flex-end; background: var(--accent-dim); }
  .bubble.assistant { align-self: flex-start; background: var(--panel); border: 1px solid var(--border); }
  .bubble.error { align-self: flex-start; background: #3d1418; border: 1px solid #5c1a20; color: #ffb4ac; }
  .tool { align-self: flex-start; font-size: 0.8rem; color: var(--muted); }
  .approval { align-self: stretch; border: 1px solid var(--accent); border-radius: 10px; padding: 0.7rem; background: var(--panel); transition: border-color 0.6s ease, opacity 0.6s ease; }
  .approval.approved { border-color: #3fb950; }
  .approval.denied { border-color: transparent; opacity: 0.7; }
  .ap-head { font-size: 0.88rem; margin-bottom: 0.5rem; }
  .approval textarea { width: 100%; font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .proposal { margin: 0; font-family: ui-monospace, monospace; font-size: 0.8rem; line-height: 1.45; white-space: pre-wrap; overflow: hidden; max-height: 16rem; }
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
