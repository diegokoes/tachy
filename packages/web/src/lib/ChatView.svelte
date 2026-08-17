<script lang="ts">
  import { tick } from "svelte";
  import { chatStream, approve, uploadDoc, getCommands, type BuiltinCommandMeta, type CommandArtifactMeta } from "./agent";
  import { addEntry, chat, type Entry } from "./chatState.svelte";
  import { renderMarkdown } from "./markdown";
  import { gsap, reducedMotion } from "./gsap";
  import { shatterAll } from "./motion";
  import AsciiScrollbar from "./AsciiScrollbar.svelte";
  import ArtifactPanel from "./chat/ArtifactPanel.svelte";
  import CommandMenu, { matchArtifacts, type CommandPick } from "./chat/CommandMenu.svelte";
  import CompactPanel from "./chat/CompactPanel.svelte";
  import OutputCard, { type OutputFile } from "./chat/OutputCard.svelte";
  import Approval from "./chat/Approval.svelte";
  import JsonModal from "./chat/JsonModal.svelte";
  import Launcher from "./chat/Launcher.svelte";
  import { G, Icon } from "./tui";
  import { pushScope } from "./keys.svelte";

  const short = (tool: string) => tool.replace(/^mcp__tachy__/, "");

  /** MCP results arrive as content blocks; the payload is JSON in the first text block. */
  function toolPayload(result: unknown): Record<string, unknown> | undefined {
    const blocks = Array.isArray(result)
      ? result
      : (result as { content?: unknown })?.content;
    const text = Array.isArray(blocks)
      ? (blocks.find(
          (b) => (b as { type?: string })?.type === "text",
        ) as { text?: string } | undefined)?.text
      : typeof result === "string"
        ? result
        : undefined;
    if (!text) return undefined;
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  
  
  let transcriptEl = $state<HTMLDivElement>();
  let composerEl = $state<HTMLTextAreaElement>();
  let pinned = true;

  $effect(() =>
    pushScope([
      {
        key: "ctrl+k",
        label: "",
        hidden: true,
        inFields: true,
        run: () => composerEl?.focus(),
      },
    ]),
  );

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

  
  $effect(() => {
    if (transcriptEl) snap(true);
  });

  
  
  function appendAssistant(text: string) {
    const last = chat.entries[chat.entries.length - 1];
    if (last && last.kind === "assistant") last.text += text;
    else addEntry({ kind: "assistant", text });
  }

  let commands = $state<{ builtins: BuiltinCommandMeta[]; artifacts: CommandArtifactMeta[] } | null>(null);
  let cmdMenu = $state<CommandMenu>();
  let cmdDismissed = $state(false);

  /** `/name` picks a command; `/artifact <query>` picks that command's argument. */
  const cmdCtx = $derived.by(() => {
    const name = chat.input.match(/^\/([a-z0-9-]*)$/);
    if (name) return { mode: "command" as const, query: name[1] };
    const arg = chat.input.match(/^\/artifact[ \t]+([^\n]*)$/);
    if (arg) return { mode: "artifact" as const, query: arg[1] };
    return null;
  });
  const menuOpen = $derived(cmdCtx !== null && !cmdDismissed && !chat.busy && commands !== null);

  $effect(() => {
    if (cmdCtx && !commands) getCommands().then((c) => (commands = c)).catch(() => {});
  });
  $effect(() => {
    void chat.input;
    cmdDismissed = false;
  });

  function pickCommand(pick: CommandPick) {
    if (pick.kind === "builtin") chat.input = `/${pick.builtin.name} `;
    else {
      chat.artifact = { id: pick.artifact.id, title: pick.artifact.title };
      chat.input = "";
    }
  }

  function composerKeydown(e: KeyboardEvent) {
    if (menuOpen && cmdMenu && (!cmdMenu.empty() || cmdCtx?.mode === "artifact")) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        cmdMenu.move(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        cmdMenu.pick();
        return;
      }
      if (e.key === "Escape") {
        cmdDismissed = true;
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function parseCommand(message: string): { name: string; args: string } | undefined {
    const m = message.match(/^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/);
    if (!m || !commands?.builtins.some((b) => b.name === m[1])) return undefined;
    return { name: m[1], args: m[2]?.trim() ?? "" };
  }

  async function send() {
    const message = chat.input.trim();
    if (!message || chat.busy) return;
    if (cmdCtx?.mode === "artifact") {
      const hits = matchArtifacts(commands?.artifacts ?? [], cmdCtx.query);
      if (hits.length === 1) pickCommand({ kind: "artifact", artifact: hits[0] });
      return;
    }
    const command = parseCommand(message);
    addEntry({ kind: "user", text: message });
    const uploadPaths = chat.uploads.map((u) => u.path);
    chat.input = "";
    chat.uploads = [];
    chat.busy = true;
    clearArmed = false;
    snap(true);
    try {
      for await (const { event, data } of chatStream({ message, sessionId: chat.sessionId, uploadPaths: uploadPaths.length ? uploadPaths : undefined, artifactId: chat.artifact?.id, command })) {
        if (event === "start") chat.turnId = data.turnId as string;
        else if (event === "text") appendAssistant(data.text as string);
        else if (event === "tool_use") {
          const tool = short(data.tool as string);
          if (tool === "compact_work_item") {
            const input = (data.input ?? {}) as Record<string, unknown>;
            addEntry({
              kind: "compact",
              id: data.id as string,
              title: [input.source, input.external_id].filter(Boolean).join(" · "),
            });
          } else if (tool === "export_table") {
            addEntry({ kind: "output", id: data.id as string });
          } else addEntry({ kind: "tool", tool });
        } else if (event === "tool_result" && short(data.tool as string) === "compact_work_item") {
          const panel = chat.entries.find(
            (e) => e.kind === "compact" && e.id === data.id,
          ) as Extract<Entry, { kind: "compact" }> | undefined;
          const payload = toolPayload(data.result);
          const stats = payload?.compaction as Extract<Entry, { kind: "compact" }>["stats"];
          if (panel && stats) {
            panel.stats = stats;
            const t = payload?.ticket as { title?: string } | undefined;
            if (t?.title) panel.title = t.title;
          }
        } else if (event === "tool_result" && short(data.tool as string) === "export_table") {
          const at = chat.entries.findIndex(
            (e) => e.kind === "output" && e.id === data.id,
          );
          if (at >= 0) {
            const file = toolPayload(data.result)?.output as OutputFile | undefined;
            if (file) (chat.entries[at] as Extract<Entry, { kind: "output" }>).file = file;
            else chat.entries.splice(at, 1);
          }
        }
        else if (event === "approval_request")
          addEntry({
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
        else if (event === "error") addEntry({ kind: "error", text: data.message as string });
        snap();
      }
    } catch (e) {
      addEntry({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      snap();
    } finally {
      chat.busy = false;
    }
  }

  
  
  let jsonModal = $state<Extract<Entry, { kind: "approval" }> | null>(null);

  const peek = (json: string) => json.replace(/\s+/g, " ").slice(0, 140);

  async function decide(entry: Extract<Entry, { kind: "approval" }>, ok: boolean) {
    if (!chat.turnId) return;
    let updated: Record<string, unknown> | undefined;
    if (ok) {
      try {
        updated = JSON.parse(entry.editable);
      } catch {
        addEntry({ kind: "error", text: "Edited JSON is invalid - fix it before approving." });
        return;
      }
    }
    await approve(chat.turnId, entry.id, ok, updated);
    
  }

  async function addFiles(files: FileList | null | undefined) {
    for (const file of Array.from(files ?? [])) {
      try {
        chat.uploads.push(await uploadDoc(file));
      } catch (err) {
        addEntry({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  async function onFile(e: Event) {
    await addFiles((e.target as HTMLInputElement).files);
    (e.target as HTMLInputElement).value = "";
  }

  
  let dragDepth = $state(0);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    addFiles(e.dataTransfer?.files);
  }

  
  
  
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
    if (!transcriptEl) return wipe();
    shatterAll(transcriptNodes(), wipe);
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
    {#each chat.entries as e, i (e.key)}
      {#if e.kind === "user"}
        <div class="turn user"><span class="who">{G.marker}you</span><div class="body">{e.text}</div></div>
      {:else if e.kind === "assistant"}
        <div class="turn"><span class="who">{G.marker}tachy</span>
          <div class="body md" class:streaming={chat.busy && i === chat.entries.length - 1}>{@html renderMarkdown(e.text)}</div>
        </div>
      {:else if e.kind === "tool"}
        <div class="tool">{G.tool} {e.tool}</div>
      {:else if e.kind === "compact"}
        <CompactPanel title={e.title} stats={e.stats} />
      {:else if e.kind === "output"}
        <OutputCard file={e.file} />
      {:else if e.kind === "error"}
        <div class="turn"><span class="who err">{G.marker}error</span><div class="body err">{e.text}</div></div>
      {:else if e.kind === "approval"}
        <Approval
          entry={e}
          ondecide={(ok) => decide(e, ok)}
          oninspect={() => (jsonModal = e)}
        />
      {/if}
    {/each}
    {#if chat.busy && chat.entries[chat.entries.length - 1]?.kind !== "assistant"}
      <div class="turn"><span class="who">{G.marker}tachy</span>
        <div class="body waiting"><span class="caret" aria-hidden="true"></span></div>
      </div>
    {/if}
    {#if chat.entries.length === 0}
      <Launcher />
    {/if}
  </div>
  <AsciiScrollbar target={transcriptEl} controls="chat-transcript" />
  <ArtifactPanel />
  </div>

  {#if chat.uploads.length || chat.artifact}
    <div class="attachments">
      {#if chat.artifact}
        <span class="attach artifact-chip">
          ⛬ {chat.artifact.title}
          <button class="chip-x" title="Detach artifact" onclick={() => (chat.artifact = undefined)}>✕</button>
        </span>
      {/if}
      {#each chat.uploads as u}<span class="attach">📎 {u.filename}</span>{/each}
    </div>
  {/if}

  <div class="composer">
    {#if menuOpen && commands}
      <CommandMenu
        bind:this={cmdMenu}
        mode={cmdCtx?.mode ?? "command"}
        query={cmdCtx?.query ?? ""}
        builtins={commands.builtins}
        artifacts={commands.artifacts}
        onpick={pickCommand}
      />
    {/if}
    <label class="upload" title="Attach a document">
      <Icon name="attach" label="Attach a document" />
      <input type="file" onchange={onFile} hidden />
    </label>
    <textarea
      bind:this={composerEl}
      placeholder="Message the assistant… ( / for commands )"
      bind:value={chat.input}
      rows="2"
      onkeydown={composerKeydown}
    ></textarea>
    {#if jsonModal}
      {@const m = jsonModal}
      <JsonModal
        entry={m}
        onclose={() => (jsonModal = null)}
        ondecide={(ok) => decide(m, ok)}
      />
    {/if}

    <div class="send-col">
      <button
        class="clear"
        class:armed={clearArmed}
        onclick={onClear}
        disabled={chat.busy || !chat.entries.length}
        title={clearArmed ? "click again to clear" : "Clear the conversation"}
      >{#if clearArmed}SURE?{:else}<Icon name="erase" label="Clear the conversation" />{/if}</button>
      <button onclick={send} disabled={chat.busy || !chat.input.trim()} title="Send">
        <Icon name="send" label="Send" />
      </button>
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

  /* Stretch with the composer row so Clear+Send always equal the textarea's
     height exactly, splitting it between them. */
  /* Fixed width so arming Clear ("SURE?") can't reflow the column. */
  .send-col {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    align-self: stretch;
    flex: none;
    width: 5.5rem;
  }
  .send-col button {
    width: 100%;
    flex: 1;
    min-height: 0;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
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
  .transcript-wrap { flex: 1; min-height: 0; display: flex; gap: 0.35rem; padding-right: 2.8rem; }
  /* Native bar hidden — the ASCII scrollbar next to it takes over. */
  .transcript { flex: 1; min-width: 0; overflow: auto; scrollbar-width: none; display: flex; flex-direction: column; gap: 0.6rem; padding-right: 0.5rem; }
  .transcript::-webkit-scrollbar { display: none; }
  /* A turn is a speaker marker plus its text — no boxes. Only events
     (approval, compaction, export) get a Panel. */
  .turn { display: flex; flex-direction: column; gap: 0.1rem; max-width: 62rem; }
  .turn .who {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .turn.user .who { color: var(--accent); }
  .turn .who.err { color: var(--danger); }
  .turn .body { white-space: pre-wrap; line-height: 1.6; padding-left: 1ch; }
  .turn .body.md { white-space: normal; }
  .turn .body.err { color: var(--danger); }
  .turn .body.waiting { min-height: 1.5em; }
  .tool { font-size: var(--fs-xs); color: var(--muted); padding-left: 1ch; }

  .attachments { display: flex; gap: 0.4rem; padding: 0.4rem 0; flex-wrap: wrap; align-items: center; }
  .attach { font-size: 0.8rem; color: var(--muted); }
  .artifact-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    padding: 0.05rem 0.6rem;
    color: var(--accent);
  }
  .chip-x { border: none; background: none; padding: 0 0.1rem; color: var(--accent); font-size: 0.8rem; }
  .chip-x:hover { color: var(--danger); }
  .composer { position: relative; display: flex; gap: 0.5rem; align-items: stretch; padding-top: 0.6rem; border-top: 1px solid var(--border); }
  .composer textarea { flex: 1; resize: none; }
  .upload { cursor: pointer; align-self: center; font-size: 1.1rem; }
</style>
