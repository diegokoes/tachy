<script lang="ts">
  import { tick } from "svelte";
  import { chatStream, approve, uploadDoc } from "./agent";
  import { chat, type Entry } from "./chatState.svelte";
  import { renderMarkdown } from "./markdown";
  import { gsap, SplitText, reducedMotion } from "./gsap";
  import TypeLine from "./TypeLine.svelte";
  import AsciiScrollbar from "./AsciiScrollbar.svelte";

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

  // On (re)mount with a preserved transcript, start at the bottom.
  $effect(() => {
    if (transcriptEl) snap(true);
  });

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
    const last = chat.entries[chat.entries.length - 1];
    if (last && last.kind === "assistant") last.text += text;
    else chat.entries.push({ kind: "assistant", text });
  }

  async function send() {
    const message = chat.input.trim();
    if (!message || chat.busy) return;
    chat.entries.push({ kind: "user", text: message });
    const uploadPaths = chat.uploads.map((u) => u.path);
    chat.input = "";
    chat.uploads = [];
    chat.busy = true;
    clearArmed = false;
    snap(true);
    try {
      for await (const { event, data } of chatStream({ message, sessionId: chat.sessionId, uploadPaths: uploadPaths.length ? uploadPaths : undefined })) {
        if (event === "start") chat.turnId = data.turnId as string;
        else if (event === "text") appendAssistant(data.text as string);
        else if (event === "tool_use") chat.entries.push({ kind: "tool", tool: short(data.tool as string) });
        else if (event === "approval_request")
          chat.entries.push({
            kind: "approval",
            id: data.id as string,
            tool: short(data.tool as string),
            editable: JSON.stringify(data.input, null, 2),
            status: "pending",
          });
        else if (event === "approval_resolved") {
          const a = chat.entries.find((e) => e.kind === "approval" && e.id === data.id) as Extract<Entry, { kind: "approval" }> | undefined;
          if (a) a.status = data.approved ? "approved" : "denied";
        } else if (event === "result") chat.sessionId = data.sessionId as string;
        else if (event === "error") chat.entries.push({ kind: "error", text: data.message as string });
        snap();
      }
    } catch (e) {
      chat.entries.push({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      snap();
    } finally {
      chat.busy = false;
    }
  }

  // The approval JSON is collapsed in the transcript; this holds the entry
  // whose payload is open in the fullscreen editor modal (null = closed).
  let jsonModal = $state<Extract<Entry, { kind: "approval" }> | null>(null);

  const peek = (json: string) => json.replace(/\s+/g, " ").slice(0, 140);

  async function decide(entry: Extract<Entry, { kind: "approval" }>, ok: boolean) {
    if (!chat.turnId) return;
    let updated: Record<string, unknown> | undefined;
    if (ok) {
      try {
        updated = JSON.parse(entry.editable);
      } catch {
        chat.entries.push({ kind: "error", text: "Edited JSON is invalid - fix it before approving." });
        return;
      }
    }
    await approve(chat.turnId, entry.id, ok, updated);
    // status flips via the approval_resolved event
  }

  async function addFiles(files: FileList | null | undefined) {
    for (const file of Array.from(files ?? [])) {
      try {
        chat.uploads.push(await uploadDoc(file));
      } catch (err) {
        chat.entries.push({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  async function onFile(e: Event) {
    await addFiles((e.target as HTMLInputElement).files);
    (e.target as HTMLInputElement).value = "";
  }

  // Drag & drop attachments; enter/leave counting survives child re-entries.
  let dragDepth = $state(0);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    addFiles(e.dataTransfer?.files);
  }

  // Clear is two-stage: first click glitches the transcript and arms the red
  // SURE? button; the second click shatters everything and wipes the state.
  // Arming times out back to normal.
  let clearArmed = $state(false);
  let disarmTimer: ReturnType<typeof setTimeout> | undefined;

  const transcriptNodes = () => Array.from(transcriptEl?.children ?? []) as HTMLElement[];

  function armClear() {
    clearArmed = true;
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(() => (clearArmed = false), 4000);
    if (reducedMotion()) return;
    const nodes = transcriptNodes();
    if (!nodes.length) return;
    for (const n of nodes) n.classList.add("glitching");
    gsap
      .timeline({
        repeat: 2,
        onComplete: () => {
          for (const n of nodes) n.classList.remove("glitching");
          gsap.set(nodes, { clearProps: "x,skewX" });
        },
      })
      .to(nodes, { x: -3, skewX: 10, duration: 0.05 })
      .to(nodes, { x: 3, skewX: -8, duration: 0.05 })
      .to(nodes, { x: 0, skewX: 0, duration: 0.05 });
  }

  function wipe() {
    chat.entries = [];
    chat.sessionId = undefined;
    chat.turnId = undefined;
  }

  function confirmClear() {
    clearTimeout(disarmTimer);
    clearArmed = false;
    if (reducedMotion() || !transcriptEl) return wipe();
    const nodes = transcriptNodes();
    const split = new SplitText(nodes, { type: "chars", reduceWhiteSpace: false });
    const tl = gsap.timeline({
      onComplete: () => {
        split.revert();
        wipe();
      },
    });
    tl.to(split.chars, {
      y: () => gsap.utils.random(60, 200),
      rotation: () => gsap.utils.random(-30, 30),
      opacity: 0,
      duration: 0.6,
      ease: "power1.in",
      stagger: { amount: 0.5 },
    });
    // Whatever SplitText can't split (textareas, buttons) drops with its block.
    tl.to(nodes, { y: 40, opacity: 0, duration: 0.35, ease: "power1.in" }, 0.25);
  }

  function onClear() {
    if (chat.busy || !chat.entries.length) return;
    if (clearArmed) confirmClear();
    else armClear();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && jsonModal) jsonModal = null;
  }}
/>

<div
  class="chat"
  role="region"
  aria-label="Chat"
  ondragenter={(e) => {
    e.preventDefault();
    dragDepth++;
  }}
  ondragover={(e) => e.preventDefault()}
  ondragleave={() => (dragDepth = Math.max(0, dragDepth - 1))}
  ondrop={onDrop}
>
  {#if dragDepth > 0}
    <div class="dropzone">drop to attach</div>
  {/if}
  <div class="transcript-wrap">
  <div class="transcript" id="chat-transcript" bind:this={transcriptEl} onscroll={onScroll}>
    {#each chat.entries as e, i (i)}
      {#if e.kind === "user"}
        <div class="bubble user">{e.text}</div>
      {:else if e.kind === "assistant"}
        <div class="bubble assistant md" class:streaming={chat.busy && i === chat.entries.length - 1}>{@html renderMarkdown(e.text)}</div>
      {:else if e.kind === "tool"}
        <div class="tool">⚙ {e.tool}</div>
      {:else if e.kind === "error"}
        <div class="bubble error">{e.text}</div>
      {:else if e.kind === "approval"}
        <div class="approval {e.status}">
          <div class="ap-head">Agent wants to run <strong>{e.tool}</strong> - review & approve</div>
          {#if e.status === "denied"}
            <pre class="proposal" use:shatter>{peek(e.editable)}</pre>
          {:else}
            <button class="json-peek" title="View full payload" onclick={() => (jsonModal = e)}>
              <span class="peek-text">{peek(e.editable)}</span>
              <span class="peek-hint">⛶ view</span>
            </button>
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
    {#if chat.busy && chat.entries[chat.entries.length - 1]?.kind !== "assistant"}
      <div class="bubble assistant waiting"><span class="caret" aria-hidden="true"></span></div>
    {/if}
    {#if chat.entries.length === 0}
      <div class="hint">
        <TypeLine text="Ask about a ticket, or attach a document to save as knowledge." />
      </div>
    {/if}
  </div>
  <AsciiScrollbar target={transcriptEl} controls="chat-transcript" />
  </div>

  {#if chat.uploads.length}
    <div class="attachments">
      {#each chat.uploads as u}<span class="attach">📎 {u.filename}</span>{/each}
    </div>
  {/if}

  <div class="composer">
    <label class="upload" title="Attach a document">
      📎<input type="file" onchange={onFile} hidden />
    </label>
    <textarea
      placeholder="Message the assistant…"
      bind:value={chat.input}
      rows="2"
      onkeydown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      }}
    ></textarea>
    {#if jsonModal}
      {@const m = jsonModal}
      <!-- Fixed overlay: inspecting/editing the payload never reflows the chat. -->
      <div
        class="json-backdrop"
        role="presentation"
        onclick={(e) => {
          if (e.target === e.currentTarget) jsonModal = null;
        }}
      >
        <div class="json-modal" role="dialog" aria-label="Tool payload">
          <div class="jm-head">
            <span><strong>{m.tool}</strong>  {m.status === "pending" ? "review & edit the payload" : m.status}</span>
            <button class="jm-close" onclick={() => (jsonModal = null)}>✕</button>
          </div>
          <textarea class="jm-editor" bind:value={m.editable} disabled={m.status !== "pending"}></textarea>
          {#if m.status === "pending"}
            <div class="ap-actions">
              <button
                class="approve"
                onclick={() => {
                  decide(m, true);
                  jsonModal = null;
                }}
              >Approve</button>
              <button
                onclick={() => {
                  decide(m, false);
                  jsonModal = null;
                }}
              >Deny</button>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <div class="send-col">
      <button
        class="clear"
        class:armed={clearArmed}
        onclick={onClear}
        disabled={chat.busy || !chat.entries.length}
      >{clearArmed ? "SURE?" : "Clear"}</button>
      <button onclick={send} disabled={chat.busy || !chat.input.trim()}>Send</button>
    </div>
  </div>
</div>

<style>
  .chat { display: flex; flex-direction: column; height: 100%; position: relative; }

  .dropzone {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 75%, transparent);
    border: 2px dashed var(--accent);
    border-radius: 8px;
    color: var(--accent);
    letter-spacing: 0.15em;
    pointer-events: none; /* keep drag events landing on .chat */
  }

  .send-col { display: flex; flex-direction: column; gap: 0.35rem; }
  .send-col button { width: 100%; }
  .clear { color: var(--muted); font-size: 0.85rem; }
  .clear.armed { background: #b91c1c; border-color: #b91c1c; color: #fff; }

  /* Momentary RGB-split while the clear glitch timeline jitters the blocks. */
  :global(.glitching) {
    text-shadow: -2px 0 rgba(255, 64, 64, 0.55), 2px 0 rgba(64, 224, 255, 0.4);
  }

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
  .proposal { margin: 0; font-family: ui-monospace, monospace; font-size: 0.8rem; line-height: 1.45; white-space: pre-wrap; overflow: hidden; max-height: 16rem; }

  /* Collapsed payload: one ellipsized line; the modal shows the real thing. */
  .json-peek {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.45rem 0.6rem;
    cursor: pointer;
  }
  .peek-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .peek-hint { flex: none; font-size: 0.78rem; color: var(--accent); }

  .json-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
  }
  .json-modal {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: min(900px, 92vw);
    height: min(80vh, 60rem);
    padding: 0.9rem 1rem;
    background: var(--panel-solid);
    border: 1px solid var(--accent);
    border-radius: 10px;
  }
  .jm-head { display: flex; align-items: center; justify-content: space-between; font-size: 0.9rem; }
  .jm-close { border-color: transparent; background: transparent; color: var(--muted); font-size: 1rem; }
  .jm-close:hover { color: var(--text); }
  .jm-editor {
    flex: 1;
    resize: none;
    width: 100%;
    font-family: ui-monospace, monospace;
    font-size: 0.82rem;
    line-height: 1.5;
  }
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
