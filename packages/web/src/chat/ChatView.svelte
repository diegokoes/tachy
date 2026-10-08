<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import {
    chatStream,
    approve,
    uploadDoc,
    getCommands,
    stopTurn,
    ChatRefused,
    type BuiltinCommandMeta,
    type CommandArtifactMeta,
  } from "./agent";
  import { addEntry, chat, type Entry } from "./chatState.svelte";
  import { renderMarkdown } from "../markdown/markdown";
  import { gsap, reducedMotion } from "../motion/gsap";
  import { reflow, shatterAll } from "../motion/motion";
  import Scrollbar from "../tui/Scrollbar.svelte";
  import ArtifactPanel from "./ArtifactPanel.svelte";
  import CommandMenu, {
    matchArtifacts,
    type CommandPick,
    type MenuCrumb,
    type MenuOption,
  } from "./CommandMenu.svelte";
  import CompactPanel from "./CompactPanel.svelte";
  import OutputCard, { type OutputFile } from "./OutputCard.svelte";
  import Approval from "./Approval.svelte";
  import Launcher from "./Launcher.svelte";
  import { ArtifactMark, Button, Caret, caretSide, G, Icon, tip } from "../tui";
  import { pushScope } from "../keys/keys.svelte";
  import type { WorkItemTypeOption, CreatedTicket } from "@tachy/contract";
  import TicketComposer from "../work-items/TicketComposer.svelte";
  import TicketCard from "../work-items/TicketCard.svelte";
  import {
    composer,
    hasDraft,
    openComposer,
  } from "../work-items/composer.svelte";
  import {
    az,
    ensureProjects,
    ensureTypes,
    typesNote,
    typesOf,
  } from "../work-items/az.svelte";
  import {
    isAzNew,
    matches,
    matchProject,
    parseAz,
  } from "../work-items/azCommand";
  import { typeColor, typeIcon } from "../work-items/ado-icons";
  import Walkthrough from "../code/Walkthrough.svelte";
  import { parseCode, scopeOptions, withScopeWord } from "../code/codeCommand";
  import { codeScope, ensureRepos, scopeNote } from "../code/codeScope.svelte";
  import type { ShownStep, WalkStep } from "../code/walkthrough";

  /** Tools whose use makes a turn's answer one about code. */
  const CODE_TOOLS = new Set(["search_code", "read_code_file", "code_diff"]);
  const WALKTHROUGH_COMMAND = { name: "walkthrough", args: "" };

  const short = (tool: string) => tool.replace(/^mcp__tachy__/, "");

  /** MCP results arrive as content blocks; the payload is JSON in the first text block. */
  function toolPayload(result: unknown): Record<string, unknown> | undefined {
    const blocks = Array.isArray(result)
      ? result
      : (result as { content?: unknown })?.content;
    const firstText = (found: unknown[]) =>
      (
        found.find((b) => (b as { type?: string })?.type === "text") as
          { text?: string } | undefined
      )?.text;
    const plain = typeof result === "string" ? result : undefined;
    const text = Array.isArray(blocks) ? firstText(blocks) : plain;
    if (!text) return undefined;
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  let transcriptEl = $state<HTMLDivElement>();
  let composerEl = $state<HTMLTextAreaElement>();
  let dockEl = $state<HTMLDivElement>();
  let pinned = true;

  // Where the composer's text is scrolled to, and how much of its width a
  // scrollbar has taken: the resting caret is laid out over it to match.
  let rest = $state({ scroll: 0, gutter: 0 });

  function restSync() {
    const el = composerEl;
    if (!el) return;
    rest = {
      scroll: el.scrollTop,
      gutter: el.offsetWidth - el.clientWidth - el.clientLeft * 2,
    };
  }

  $effect(() => {
    void chat.input;
    restSync();
  });

  const empty = $derived(chat.entries.length === 0);

  // A pre effect, so the dock is read where it still sits: centred before the
  // first message, at the foot after it.
  $effect.pre(() => {
    void empty;
    const play = untrack(() => reflow([dockEl], { absolute: false }));
    void tick().then(play);
  });

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

  let commands = $state<{
    builtins: BuiltinCommandMeta[];
    artifacts: CommandArtifactMeta[];
  } | null>(null);
  let cmdMenu = $state<CommandMenu>();
  let cmdDismissed = $state(false);

  const azCommand = $derived(commands?.builtins.find((b) => b.name === "az"));
  const azCtx = $derived(
    azCommand ? parseAz(chat.input, az.projects ?? []) : null,
  );

  const codeCtx = $derived(
    commands?.builtins.some((b) => b.name === "code")
      ? parseCode(chat.input)
      : null,
  );

  /** `/name` picks a command; `/artifact <query>`, `/az …` and `/code @…` pick arguments. */
  const cmdCtx = $derived.by(() => {
    const name = chat.input.match(/^\/([a-z0-9-]*)$/);
    if (name) return { mode: "command" as const, query: name[1] };
    const arg = chat.input.match(/^\/artifact[ \t]+([^\n]*)$/);
    if (arg) return { mode: "artifact" as const, query: arg[1] };
    if (azCtx) return { mode: "options" as const, query: azCtx.query };
    if (codeCtx) return { mode: "options" as const, query: codeCtx.query };
    return null;
  });

  $effect(() => {
    if (codeCtx) ensureRepos();
  });

  /** Picked to search every linked repo: the menu closes and the line stays. */
  const EVERY_REPO = "";

  const codeMenu = $derived.by(
    (): { options: MenuOption[]; crumb: MenuCrumb } | null => {
      if (!codeCtx) return null;
      const scopes = scopeOptions(codeScope.repos ?? [], codeCtx.query).map(
        (o): MenuOption => ({
          value: o.word,
          label: o.label,
          hint: o.hint,
          desc: o.desc,
          icon: o.kind === "repo" ? "repo" : "project",
        }),
      );
      const everywhere: MenuOption = {
        value: EVERY_REPO,
        label: "all linked repos",
        desc: "or type @ at any point to narrow",
        icon: "search",
      };
      return {
        crumb: {
          cmd: "/code",
          param: "scope",
          desc: "repos and projects to answer from",
          empty: scopeNote(),
        },
        options:
          codeCtx.fresh && scopes.length ? [everywhere, ...scopes] : scopes,
      };
    },
  );

  $effect(() => {
    if (azCtx && azCtx.stage !== "sub") ensureProjects();
    if (azCtx?.stage === "type") ensureTypes(azCtx.project.id);
  });

  function projectsEmpty() {
    if (!az.projects) return "loading projects…";
    return az.projects.length
      ? "no project matches"
      : "none of your teams has an Azure DevOps project registered";
  }

  const azMenu = $derived.by(
    (): { options: MenuOption[]; crumb: MenuCrumb } | null => {
      if (!azCtx) return null;
      if (azCtx.stage === "sub")
        return {
          crumb: {
            cmd: "/az",
            param: "subcommand",
            desc: azCommand?.description,
          },
          options: (azCommand?.subcommands ?? [])
            .filter((s) => s.name.startsWith(azCtx.query))
            .map((s) => ({
              value: s.name,
              label: s.name,
              hint: s.args,
              desc: s.description,
            })),
        };
      if (azCtx.stage === "project")
        return {
          crumb: {
            cmd: "/az new",
            param: "project",
            desc: "your team's Azure DevOps projects",
            empty: az.projectsError ?? projectsEmpty(),
          },
          options: (az.projects ?? [])
            .filter((p) => matches(azCtx.query, p.name, p.external_key))
            .map((p) => ({
              value: p.id,
              label: p.name,
              hint: p.name === p.external_key ? p.source_slug : p.external_key,
              desc: p.product_slug ?? p.team_slug,
            })),
        };
      return {
        crumb: {
          cmd: `/az new ${azCtx.project.name}`,
          param: "type",
          desc: "what you are raising",
          empty: typesNote(azCtx.project.id),
          grid: true,
        },
        options: typesOf(azCtx.project.id)
          .filter((t) => matches(azCtx.query, t.name))
          .map((t) => ({
            value: t.name,
            label: t.name,
            icon: typeIcon(t.icon),
            color: typeColor(t.color),
          })),
      };
    },
  );
  const optionsMenu = $derived(azMenu ?? codeMenu);
  const menuOpen = $derived(
    cmdCtx !== null && !cmdDismissed && !chat.busy && commands !== null,
  );

  $effect(() => {
    if (cmdCtx && !commands)
      getCommands()
        .then((c) => (commands = c))
        .catch(() => {});
  });
  $effect(() => {
    const refresh = () =>
      getCommands()
        .then((c) => (commands = c))
        .catch(() => {});
    window.addEventListener("artifacts-changed", refresh);
    return () => window.removeEventListener("artifacts-changed", refresh);
  });
  $effect(() => {
    void chat.input;
    cmdDismissed = false;
  });

  function pickCommand(pick: CommandPick) {
    if (pick.kind === "builtin") chat.input = `/${pick.builtin.name} `;
    else if (pick.kind === "option" && azCtx) pickAz(pick.value);
    else if (pick.kind === "option") pickCode(pick.value);
    else {
      chat.artifact = { id: pick.artifact.id, title: pick.artifact.title };
      chat.input = "";
    }
  }

  function pickCode(word: string) {
    if (word === EVERY_REPO) cmdDismissed = true;
    else chat.input = withScopeWord(chat.input, word);
  }

  function pickAz(value: string) {
    // Held in a local: azCtx derives from the input, so clearing the input
    // below would null it before the composer opens.
    const ctx = azCtx;
    if (!ctx) return;
    if (ctx.stage === "sub") chat.input = `/az ${value} `;
    else if (ctx.stage === "project") {
      const project = az.projects?.find((x) => x.id === value);
      if (project) chat.input = `/az new ${project.name} `;
    } else {
      const type = typesOf(ctx.project.id).find((x) => x.name === value);
      chat.input = "";
      openComposer(ctx.project, type);
    }
  }

  /** `/az new [project] [type]` sent as a line: whatever it names is preselected. */
  async function openFromLine(message: string) {
    chat.input = "";
    const rest = message.replace(/^\/az[ \t]+new[ \t]*/, "");
    const hit = rest ? matchProject(`${rest} `, await ensureProjects()) : null;
    if (!hit) return openComposer();
    const types = await ensureTypes(hit.project.id);
    const type = types.find(
      (t) => t.name.toLowerCase() === hit.rest.toLowerCase(),
    );
    openComposer(hit.project, type);
  }

  function ticketMade(ticket: CreatedTicket, type: WorkItemTypeOption) {
    addEntry({ kind: "ticket", ticket, icon: type.icon, color: type.color });
    snap(true);
  }

  /** A draft set aside with the X: the chat says so and offers it back. */
  const draftWaiting = $derived(!composer.open && hasDraft());

  function composerKeydown(e: KeyboardEvent) {
    if (
      menuOpen &&
      cmdMenu &&
      (!cmdMenu.empty() || cmdCtx?.mode === "artifact")
    ) {
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
        e.preventDefault();
        cmdDismissed = true;
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function parseCommand(
    message: string,
  ): { name: string; args: string } | undefined {
    const match = message.match(/^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/);
    if (!match || !commands?.builtins.some((b) => b.name === match[1]))
      return undefined;
    return { name: match[1], args: match[2]?.trim() ?? "" };
  }

  async function send() {
    const message = chat.input.trim();
    if (!message || chat.busy) return;
    if (isAzNew(message)) return openFromLine(message);
    if (cmdCtx?.mode === "artifact") {
      const hits = matchArtifacts(commands?.artifacts ?? [], cmdCtx.query);
      if (hits.length === 1)
        pickCommand({ kind: "artifact", artifact: hits[0] });
      return;
    }
    // The list is otherwise only fetched while a bare `/name` is being typed, so
    // a command that arrived already written - the wiki's "draft with agent"
    // puts one in the composer - would go out as plain text without this.
    if (message.startsWith("/") && !commands)
      commands = await getCommands().catch(() => null);
    const command = parseCommand(message);
    chat.input = "";
    return startTurn(message, command);
  }

  /** The newest answer written from code, the one a walkthrough is made of. */
  const walkableKey = $derived(
    chat.entries.filter((e) => e.kind === "assistant" && e.code).at(-1)?.key,
  );

  async function startTurn(
    message: string,
    command?: { name: string; args: string },
  ) {
    let readCode = false;
    addEntry({ kind: "user", text: message });
    const uploadPaths = chat.uploads.map((u) => u.path);
    chat.uploads = [];
    chat.busy = true;
    clearArmed = false;
    snap(true);
    // Aborted when the view goes away, so a turn left running does not hold its
    // response open behind a component nobody is looking at any more.
    turnAbort?.abort();
    turnAbort = new AbortController();
    try {
      for await (const { event, data } of chatStream(
        {
          message,
          sessionId: chat.sessionId,
          uploadPaths: uploadPaths.length ? uploadPaths : undefined,
          artifactId: chat.artifact?.id,
          command,
        },
        turnAbort.signal,
      )) {
        chat.queuePosition =
          event === "queued" ? (data.position as number) : null;
        if (event === "start") chat.turnId = data.turnId as string;
        else if (event === "text") appendAssistant(data.text as string);
        else if (event === "tool_use") {
          const tool = short(data.tool as string);
          readCode ||= CODE_TOOLS.has(tool);
          if (tool === "show_code_walkthrough") {
            const input = (data.input ?? {}) as {
              title?: string;
              steps?: WalkStep[];
            };
            if (input.steps?.length)
              addEntry({
                kind: "walkthrough",
                id: data.id as string,
                title: input.title ?? "walkthrough",
                steps: input.steps,
              });
          } else if (tool === "compact_work_item") {
            const input = (data.input ?? {}) as Record<string, unknown>;
            addEntry({
              kind: "compact",
              id: data.id as string,
              title: [input.source, input.external_id]
                .filter(Boolean)
                .join(" · "),
            });
          } else if (tool === "export_table") {
            addEntry({ kind: "output", id: data.id as string });
          } else addEntry({ kind: "tool", tool });
        } else if (
          event === "tool_result" &&
          short(data.tool as string) === "compact_work_item"
        ) {
          const panel = chat.entries.find(
            (e) => e.kind === "compact" && e.id === data.id,
          ) as Extract<Entry, { kind: "compact" }> | undefined;
          const payload = toolPayload(data.result);
          const stats = payload?.compaction as Extract<
            Entry,
            { kind: "compact" }
          >["stats"];
          if (panel && stats) {
            panel.stats = stats;
            const ticket = payload?.ticket as { title?: string } | undefined;
            if (ticket?.title) panel.title = ticket.title;
          }
        } else if (
          event === "tool_result" &&
          short(data.tool as string) === "show_code_walkthrough"
        ) {
          const at = chat.entries.findIndex(
            (e) => e.kind === "walkthrough" && e.id === data.id,
          );
          const shown = toolPayload(data.result)?.shown as
            ShownStep[] | undefined;
          // A refused walkthrough has no ranges to show; the agent says why.
          if (at >= 0 && !shown) chat.entries.splice(at, 1);
          else if (at >= 0)
            (
              chat.entries[at] as Extract<Entry, { kind: "walkthrough" }>
            ).shown = shown;
        } else if (
          event === "tool_result" &&
          short(data.tool as string) === "export_table"
        ) {
          const at = chat.entries.findIndex(
            (e) => e.kind === "output" && e.id === data.id,
          );
          if (at >= 0) {
            const file = toolPayload(data.result)?.output as
              OutputFile | undefined;
            if (file)
              (chat.entries[at] as Extract<Entry, { kind: "output" }>).file =
                file;
            else chat.entries.splice(at, 1);
          }
        } else if (event === "approval_request")
          addEntry({
            kind: "approval",
            id: data.id as string,
            tool: short(data.tool as string),
            input: (data.input ?? {}) as Record<string, unknown>,
            status: "pending",
          });
        else if (event === "approval_resolved") {
          const approval = chat.entries.find(
            (e) => e.kind === "approval" && e.id === data.id,
          ) as Extract<Entry, { kind: "approval" }> | undefined;
          if (approval) approval.status = data.approved ? "approved" : "denied";
        } else if (event === "result")
          chat.sessionId = data.sessionId as string;
        else if (event === "error")
          addEntry({ kind: "error", text: data.message as string });
        snap();
      }
    } catch (e) {
      // An abort is this component going away, not something to report.
      if (e instanceof ChatRefused && e.status === 409 && e.turnId) {
        addEntry({
          kind: "running",
          turnId: e.turnId,
          text: e.message,
          stopped: false,
        });
        chat.input = message;
      } else if (!(e instanceof DOMException && e.name === "AbortError"))
        addEntry({
          kind: "error",
          text: e instanceof Error ? e.message : String(e),
        });
      snap();
    } finally {
      chat.busy = false;
      chat.queuePosition = null;
      const answer = chat.entries[chat.entries.length - 1];
      if (readCode && answer?.kind === "assistant") answer.code = true;
    }
  }

  async function stopRunning(entry: Extract<Entry, { kind: "running" }>) {
    try {
      await stopTurn(entry.turnId);
      entry.stopped = true;
    } catch (e) {
      addEntry({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function decide(
    entry: Extract<Entry, { kind: "approval" }>,
    ok: boolean,
    reason?: string,
  ) {
    if (!chat.turnId) return;
    try {
      await approve(
        chat.turnId,
        entry.id,
        ok,
        ok ? entry.input : undefined,
        reason,
      );
    } catch (e) {
      addEntry({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function addFiles(files: FileList | null | undefined) {
    for (const file of Array.from(files ?? [])) {
      try {
        chat.uploads.push(await uploadDoc(file));
      } catch (err) {
        addEntry({
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        });
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

  let turnAbort: AbortController | undefined;
  onDestroy(() => turnAbort?.abort());
  let clearArmed = $state(false);
  let disarmTimer: ReturnType<typeof setTimeout> | undefined;

  const transcriptNodes = () =>
    Array.from(transcriptEl?.children ?? []) as HTMLElement[];

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
    if (clearArmed) {
      confirmClear();
      composerEl?.focus();
    } else armClear();
  }

  // Both marks leave once they have nothing to act on, and focus would go with
  // them.
  function sendClick() {
    void send();
    composerEl?.focus();
  }
</script>

{#if composer.open}
  <div class="chat">
    <TicketComposer oncreated={ticketMade} />
  </div>
{:else}
  <div
    class="chat bare"
    class:empty
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
      <div
        class="transcript"
        id="chat-transcript"
        bind:this={transcriptEl}
        onscroll={onScroll}
      >
        {#each chat.entries as entry, i (entry.key)}
          {#if entry.kind === "user"}
            <div class="turn user">
              <span class="who"
                >you<span class="mk" aria-hidden="true">{G.marker}</span></span
              >
              <div class="body">{entry.text}</div>
            </div>
          {:else if entry.kind === "assistant"}
            <div class="turn">
              <span class="who"
                ><span class="mk" aria-hidden="true">{G.marker}</span
                >tachy</span
              >
              <div
                class="body md"
                class:streaming={chat.busy && i === chat.entries.length - 1}
              >
                {@html renderMarkdown(entry.text)}
              </div>
              {#if entry.key === walkableKey && !chat.busy}
                <Button
                  size="sm"
                  square
                  icon="flows"
                  title="Walk me through it"
                  onclick={() =>
                    startTurn("walk me through it", WALKTHROUGH_COMMAND)}
                />
              {/if}
            </div>
          {:else if entry.kind === "tool"}
            <div class="tool">
              <Icon name="tool" size="1em" weight={7} />
              {entry.tool}
            </div>
          {:else if entry.kind === "compact"}
            <CompactPanel title={entry.title} stats={entry.stats} />
          {:else if entry.kind === "output"}
            <OutputCard file={entry.file} />
          {:else if entry.kind === "walkthrough"}
            <Walkthrough
              title={entry.title}
              steps={entry.steps}
              shown={entry.shown}
            />
          {:else if entry.kind === "ticket"}
            <TicketCard
              ticket={entry.ticket}
              icon={entry.icon}
              color={entry.color}
            />
          {:else if entry.kind === "error"}
            <div class="turn">
              <span class="who err">{G.marker}error</span>
              <div class="body err">{entry.text}</div>
            </div>
          {:else if entry.kind === "running"}
            <div class="turn">
              <span class="who err">{G.marker}busy</span>
              <div class="body err">
                {#if entry.stopped}stopped. send your message again.{:else}{entry.text}
                  <Button size="sm" onclick={() => stopRunning(entry)}
                    >stop it</Button
                  >{/if}
              </div>
            </div>
          {:else if entry.kind === "approval"}
            <Approval
              {entry}
              ondecide={(ok, reason) => decide(entry, ok, reason)}
            />
          {/if}
        {/each}
        {#if chat.busy && chat.entries[chat.entries.length - 1]?.kind !== "assistant"}
          <div class="turn">
            <span class="who">{G.marker}tachy</span>
            <div class="body waiting">
              {#if chat.queuePosition}<span class="muted"
                  >waiting for a free chat slot · #{chat.queuePosition}
                </span>{/if}<Caret />
            </div>
          </div>
        {/if}
        {#if empty}
          <Launcher />
        {/if}
      </div>
      {#if !empty}
        <Scrollbar target={transcriptEl} controls="chat-transcript" />
      {/if}
      <ArtifactPanel />
    </div>

    <div class="dock" bind:this={dockEl}>
      {#if chat.uploads.length || chat.artifact || draftWaiting}
        <div class="attachments">
          {#if draftWaiting}
            <button class="attach draft-chip" onclick={() => openComposer()}>
              <Icon name="review" size="1em" />
              draft {composer.type?.name ?? "work item"}{composer.title.trim()
                ? `: ${composer.title.trim()}`
                : ""}
            </button>
          {/if}
          {#if chat.artifact}
            <span class="attach artifact-chip">
              <ArtifactMark size="1em" />
              {chat.artifact.title}
              <button
                class="chip-x"
                aria-label="Detach artifact"
                use:tip={"Detach artifact"}
                onclick={() => (chat.artifact = undefined)}
                ><Icon name="close" size="1em" weight={7} /></button
              >
            </span>
          {/if}
          {#each chat.uploads as upload, i (upload.path)}
            {#if i > 0}<span class="sep" aria-hidden="true">~~</span>{/if}
            <span class="attach">
              <Icon name={upload.image ? "image" : "file"} size="1.1em" />
              {upload.filename}
              <button
                class="chip-x"
                aria-label="Remove attachment"
                use:tip={"Remove attachment"}
                onclick={() => chat.uploads.splice(i, 1)}
                ><Icon name="close" size="1em" weight={7} /></button
              >
            </span>
          {/each}
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
            options={optionsMenu?.options}
            crumb={optionsMenu?.crumb}
            onpick={pickCommand}
          />
        {/if}
        <label class="upload" use:tip={"Attach a document"}>
          <Icon name="attach" label="Attach a document" />
          <input type="file" onchange={onFile} />
        </label>
        <span class="field">
          <textarea
            bind:this={composerEl}
            aria-label="Message the assistant, / for commands"
            bind:value={chat.input}
            rows="2"
            onscroll={restSync}
            onkeydown={composerKeydown}></textarea>
          <span
            class="rest"
            aria-hidden="true"
            style:padding-right="calc(var(--pad-3) + {rest.gutter}px)"
            ><span class="rest-line" style:translate="0 {-rest.scroll}px"
              ><span class="typed">{chat.input}</span><span class="mark"
                ><Caret side={caretSide(chat.input, chat.input.length)} /></span
              ></span
            ></span
          >
        </span>
        <div class="send-col">
          <span class="slot">
            {#if chat.entries.length}
              <Button
                variant={clearArmed ? "danger" : "ghost"}
                icon={clearArmed ? "confirm" : "clear"}
                iconSize="1.25em"
                morph
                disabled={chat.busy}
                aria-label="Clear the conversation"
                title={clearArmed
                  ? "click again to clear"
                  : "Clear the conversation"}
                onclick={onClear}
              />
            {/if}
          </span>
          <span class="slot">
            {#if chat.input.trim()}
              <Button
                variant="ghost"
                icon="send"
                iconSize="1.25em"
                disabled={chat.busy}
                aria-label="Send"
                title="Send"
                onclick={sendClick}
              />
            {/if}
          </span>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .chat {
    --side-w: 3.25rem;
    --upload-w: var(--side-w);
    --composer-gap: 0.5rem;
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
  }

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

  /* The upload mark's mirror: the same column on the other side of the
     textarea, its two marks as bare as that one and as far from the edge. */
  .send-col {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    align-self: stretch;
    flex: none;
    width: var(--side-w);
  }
  /* Each mark keeps its half of the column whether or not it is there, so
     one appearing never moves the other. */
  .slot {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .send-col :global(.btn) {
    --btn-edge: transparent;
    flex: 1;
    min-height: 0;
    padding: 0;
    justify-content: flex-start;
    font-size: 1.1rem;
    background: transparent;
  }
  .send-col :global(.btn.ghost:hover:not(:disabled)),
  .send-col :global(.btn.ghost:focus-visible:not(:disabled)) {
    color: var(--accent);
  }
  .send-col :global(.btn:hover:not(:disabled) svg),
  .send-col :global(.btn:focus-visible:not(:disabled) svg) {
    filter: brightness(1.35);
  }
  .send-col :global(.btn:focus-visible:not(:disabled)) {
    border-color: transparent;
    box-shadow: none;
  }

  /* Momentary RGB-split while the clear glitch timeline jitters the blocks. */
  :global(.glitching) {
    text-shadow:
      -2px 0 rgba(255, 64, 64, 0.55),
      2px 0 rgba(64, 224, 255, 0.4);
  }

  /* The caret riding the end of a streaming message. A pseudo-element cannot
     hold tui/Caret, so it is drawn to match: same stroke, same beat. */
  .md.streaming > :global(:last-child)::after {
    display: inline-block;
    width: 0.165em;
    height: 1.09em;
    margin-left: 0.06em;
    vertical-align: text-bottom;
    border-radius: 1em;
    background: var(--text);
    animation: caret-beat 1.2s infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .md.streaming > :global(:last-child)::after {
      animation: none;
    }
  }

  .waiting {
    min-height: 1.4em;
  }

  /* Assistant markdown. Rendered via {@html} so children need :global. */
  .md {
    white-space: normal;
  }
  .md :global(p) {
    margin: 0.4em 0;
  }
  .md :global(> :first-child) {
    margin-top: 0;
  }
  .md :global(> :last-child) {
    margin-bottom: 0;
  }
  .md :global(h1),
  .md :global(h2),
  .md :global(h3),
  .md :global(h4) {
    font-size: 1.02em;
    margin: 0.7em 0 0.35em;
    letter-spacing: 0.04em;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 0.4em 0;
    padding-left: 1.5em;
  }
  .md :global(li) {
    margin: 0.15em 0;
  }
  .md :global(code) {
    background: var(--accent-dim);
    border-radius: 3px;
    padding: 0.05em 0.35em;
    font-size: 0.92em;
  }
  .md :global(pre) {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.6em 0.8em;
    margin: 0.5em 0;
    overflow-x: auto;
  }
  .md :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.85em;
  }
  .md :global(blockquote) {
    margin: 0.5em 0;
    padding-left: 0.8em;
    border-left: 3px solid var(--border);
    color: var(--muted);
  }
  .md :global(table) {
    border-collapse: collapse;
    margin: 0.5em 0;
    display: block;
    overflow-x: auto;
  }
  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--border);
    padding: 0.25em 0.6em;
  }
  .md :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.7em 0;
  }

  /* While streaming, the caret rides the end of the last element. */
  .md.streaming > :global(:last-child)::after {
    content: "";
  }
  .transcript-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 0.35rem;
    padding-right: 2.8rem;
  }
  /* Native bar hidden - the ASCII scrollbar next to it takes over. */
  .transcript {
    flex: 1;
    min-width: 0;
    overflow: auto;
    scrollbar-width: none;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding-right: 0.5rem;
  }
  .transcript::-webkit-scrollbar {
    display: none;
  }

  /* Nothing said yet: the lede and the dock sit together in the middle. */
  .chat.empty {
    justify-content: center;
  }
  .chat.empty .transcript-wrap {
    flex: none;
    padding-right: 0;
  }
  .chat.empty .transcript {
    align-items: center;
    overflow: visible;
    padding-right: 0;
  }

  /* A turn is a speaker marker over its text, on a plate of its own: there
     is no window behind it, only the sky. Prose is on the UI face; code,
     tool traces and event panels stay mono. */
  .turn {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    width: fit-content;
    max-width: 60ch;
  }
  .turn .who {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .turn .who.err {
    color: var(--danger);
  }
  .turn .body {
    font-family: var(--font-prose);
    white-space: pre-wrap;
    line-height: 1.6;
    padding: var(--pad-2) var(--pad-3);
    background: var(--panel-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .turn .body.md {
    white-space: normal;
  }
  .turn .body.err {
    color: var(--danger);
  }
  .turn .body.waiting {
    min-height: 1.5em;
  }
  /* A tool line is a trace, not prose - it keeps the terminal face. */
  .tool {
    display: flex;
    align-items: center;
    gap: 0.5ch;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
    padding-left: 1ch;
  }

  /* The user's turn is positioned right and its text stays left-aligned:
     reading returns to the left edge on every line, so ragged-left costs a
     re-scan. Only the marker sits on the right. */
  .turn.user {
    align-self: flex-end;
    max-width: 46ch;
    text-align: left;
  }
  .turn.user .who {
    align-self: flex-end;
    color: var(--accent);
  }
  /* Same glyph as tachy's, mirrored - no second marker to keep in step. */
  .turn.user .mk {
    display: inline-block;
    transform: scaleX(-1);
  }
  .turn.user .body {
    background: color-mix(in srgb, var(--accent) 14%, var(--panel-solid));
  }

  /* The textarea is what sits on the nav's centre line, not the row: the
     upload mark gets a column as wide as the send column, and the row steps
     right by half of the padding `main` keeps on that side only. */
  .dock {
    position: relative;
    left: calc(var(--pad-2) / 2);
    width: 100%;
    max-width: 46rem;
    align-self: center;
  }

  /* Indented past the upload mark so the row starts where the textarea does. */
  .attachments {
    display: flex;
    gap: var(--pad-3);
    padding: var(--pad-2) 0 var(--pad-2)
      calc(var(--upload-w) + var(--composer-gap));
    flex-wrap: wrap;
    align-items: center;
  }
  .draft-chip {
    background: none;
    border: 1px dashed var(--accent);
    border-radius: var(--radius-chip);
    padding: 0 var(--pad-2);
    cursor: pointer;
  }
  .draft-chip:hover,
  .draft-chip:focus-visible {
    color: var(--accent);
  }
  .attach {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .sep {
    color: var(--muted);
    opacity: 0.55;
    user-select: none;
  }
  .artifact-chip {
    color: var(--accent);
  }
  .chip-x {
    display: inline-flex;
    align-items: center;
    border: none;
    background: none;
    padding: 0 var(--pad-1);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .chip-x:hover {
    color: var(--text);
  }
  .composer {
    position: relative;
    display: flex;
    gap: var(--composer-gap);
    align-items: stretch;
  }
  .field {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .composer textarea {
    flex: 1;
    resize: none;
    background: var(--panel-bg);
  }
  .composer textarea:not(:focus-visible) {
    border-color: var(--border-bare);
  }
  /* The caret kept at the end of the text while the composer is not focused,
     so it reads as writeable before it is clicked. The text is laid out again
     over the textarea, unseen, to carry the caret to where it ends. */
  .rest {
    position: absolute;
    inset: 0;
    padding: var(--pad-2) var(--pad-3);
    border: 1px solid transparent;
    overflow: hidden;
    pointer-events: none;
  }
  .field:focus-within .rest {
    display: none;
  }
  .rest-line {
    display: block;
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
  .typed {
    visibility: hidden;
  }
  /* A line tall and centred in it, which is where tui/CaretHost puts the
     focused caret. Left on the baseline it sat higher, and dropped on focus. */
  .mark {
    display: inline-flex;
    align-items: center;
    height: 1lh;
    vertical-align: top;
    width: 0;
    margin-left: -0.115em;
    color: var(--accent);
    opacity: 0.55;
  }
  /* A <label>, not a <button> - it has to wrap the file input - so it borrows
     the mark's hover language rather than inheriting it from Button. */
  .upload {
    width: var(--upload-w);
    display: flex;
    justify-content: flex-end;
    cursor: pointer;
    align-self: center;
    font-size: 1.1rem;
    color: var(--muted);
  }
  /* Hidden from sight only: a `hidden` input leaves the tab order, and the
     keyboard has no other way to attach. */
  .upload input {
    position: absolute;
    width: 1px;
    height: 1px;
    min-height: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .upload:has(input:focus-visible) {
    outline: 1px solid currentColor;
    outline-offset: 2px;
  }
  .upload :global(svg) {
    transition:
      stroke-width 0.12s ease,
      filter 0.12s ease;
  }
  .upload:hover,
  .upload:has(input:focus-visible) {
    color: var(--accent);
  }
  .upload:hover :global(svg),
  .upload:has(input:focus-visible) :global(svg) {
    stroke-width: var(--sw-hover, 9);
    filter: brightness(1.35);
  }
  @media (prefers-reduced-motion: reduce) {
    .upload :global(svg) {
      transition: none;
    }
  }
</style>
