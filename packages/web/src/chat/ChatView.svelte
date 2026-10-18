<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import {
    chatStream,
    approve,
    uploadDoc,
    getCommands,
    stopTurn,
    ChatRefused,
    type ChatCommands,
  } from "./agent";
  import {
    addEntry,
    canRestore,
    chat,
    clearChat,
    forgetCleared,
    restoreChat,
    type Entry,
  } from "./chatState.svelte";
  import { renderMarkdown } from "../markdown/markdown";
  import { reflow } from "../motion/motion";
  import { tintSky, type SkyTint } from "../motion/sky.svelte";
  import Scrollbar from "../tui/Scrollbar.svelte";
  import ArtifactPanel from "./ArtifactPanel.svelte";
  import CommandMenu, {
    matchArtifacts,
    DEBUG_COMMAND,
    MODEL_COMMAND,
    STOP_COMMAND,
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
  import { toast } from "../notifications/notify.svelte";
  import PointerText from "../settings/PointerText.svelte";
  import {
    topbar,
    tuckTopbar,
    unveilTopbar,
    veilTopbar,
  } from "../shell/topbar.svelte";
  import { CHAT_UPLOAD_ACCEPT, uploadRefusal } from "@tachy/contract";
  import type { AgentEffort, WorkItemFile } from "@tachy/contract";
  import {
    effortOptions,
    modelOptions,
    parseModel,
    pickOf,
    typedPick,
    type ModelPick,
  } from "./modelCommand";
  import { agentPrefs, loadAgent } from "../settings/prefs.svelte";
  import FileTray from "../work-items/FileTray.svelte";
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
  import ItemPeek from "../work-items/ItemPeek.svelte";
  import {
    clearPeek,
    peek,
    peekedSource,
    peekLater,
    workItemNumber,
  } from "../work-items/peek.svelte";
  import { parseTicketLine, ticketArgs } from "../work-items/ticketCommand";
  import { tallyCalls, tallyLabel } from "./toolCalls";
  import { recordFrame, type TurnSent, type TurnTrace } from "./trace";
  import TracePanel from "./TracePanel.svelte";
  import { isGlobalAdmin } from "../access/session.svelte";
  import Walkthrough from "../code/Walkthrough.svelte";
  import {
    mentionBeingTyped,
    mentionOptions,
    mentionWord,
    parseMentionWord,
    takeTypedMentions,
    withMentions,
    withoutMentionBeingTyped,
  } from "./mentions";
  import {
    ensureMentionables,
    mentionables,
    mentionsNote,
  } from "./mentions.svelte";
  import type { IconName } from "../tui/icons";
  import type { ChatModeName, MentionKind } from "@tachy/contract";
  import type { ShownStep, WalkStep } from "../code/walkthrough";

  /** Tools whose use makes a turn's answer one about code. */
  const CODE_TOOLS = new Set(["search_code", "read_code_file", "code_diff"]);
  const WALKTHROUGH_COMMAND = { name: "walkthrough", args: "" };

  const short = (tool: string) => tool.replace(/^mcp__tachy__/, "");

  const MODE_TINTS: Record<ChatModeName, SkyTint> = {
    analyze: "amber",
    code: "green",
  };
  const MODE_ICONS: Record<ChatModeName, IconName> = {
    analyze: "knowledge",
    code: "code",
  };
  const MENTION_ICONS: Record<MentionKind, IconName> = {
    repo: "repo",
    bucket: "bucket",
    project: "project",
  };

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
  let edgeEl = $state<HTMLElement>();
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

  /** Starts slow and lands at full speed, with no wind-back before it goes. */
  const DOCK_EASE = "power4.in";
  /** Longer than reflow's default: the ease covers little ground in its first half. */
  const DOCK_TRAVEL_S = 0.45;

  // A pre effect, so the dock, the nav and the artifact tab are read where they
  // still sit, and one Flip moves all three. Its landing shows a nav that a
  // clear brought back veiled.
  $effect.pre(() => {
    void empty;
    const play = untrack(() =>
      reflow([topbar.el, dockEl, edgeEl], {
        absolute: false,
        duration: DOCK_TRAVEL_S,
        ease: DOCK_EASE,
        onComplete: unveilTopbar,
      }),
    );
    void tick().then(play);
  });

  // A conversation under way takes the nav's row. The disposer hands it back
  // on clear and when the view goes, so every other section keeps its bar.
  $effect(() => (empty ? undefined : tuckTopbar()));

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

  /** One row holds a run of tool calls, so a search-heavy turn stays short. */
  function noteCall(tool: string) {
    const last = chat.entries[chat.entries.length - 1];
    if (last?.kind === "tools") last.calls.push(tool);
    else addEntry({ kind: "tools", calls: [tool] });
  }

  /** The tools whose result lists the files of the ticket they read. */
  const TICKET_READS = new Set([
    "fetch_work_item",
    "get_context",
    "compact_work_item",
  ]);

  function showFiles(data: Record<string, unknown>) {
    if (!TICKET_READS.has(short(data.tool as string))) return;
    const files = toolPayload(data.result)?.files;
    if (Array.isArray(files) && files.length)
      addEntry({ kind: "files", files: files as WorkItemFile[] });
  }

  function appendAssistant(text: string) {
    const last = chat.entries[chat.entries.length - 1];
    if (last && last.kind === "assistant") last.text += text;
    else addEntry({ kind: "assistant", text });
  }

  let commands = $state<ChatCommands | null>(null);
  let cmdMenu = $state<CommandMenu>();
  let cmdDismissed = $state(false);

  const azCommand = $derived(commands?.builtins.find((b) => b.name === "az"));
  const azCtx = $derived(
    azCommand ? parseAz(chat.input, az.projects ?? []) : null,
  );

  const ticketCtx = $derived(commands ? parseTicketLine(chat.input) : null);
  const mentionCtx = $derived(mentionBeingTyped(chat.input));

  const offeredModels = $derived(agentPrefs.models?.models ?? null);
  const listedModels = $derived(offeredModels ?? []);
  const modelCtx = $derived(parseModel(chat.input, offeredModels));

  /**
   * `/name` picks a command or mode; `/artifact <query>`, `/az …`, a ticket
   * line and `/model …` pick arguments; an `@` word anywhere picks a source.
   */
  const cmdCtx = $derived.by(() => {
    const name = chat.input.match(/^\/([a-z0-9-]*)$/);
    if (name) return { mode: "command" as const, query: name[1] };
    const arg = chat.input.match(/^\/artifact[ \t]+([^\n]*)$/);
    if (arg) return { mode: "artifact" as const, query: arg[1] };
    if (azCtx) return { mode: "options" as const, query: azCtx.query };
    if (ticketCtx) return { mode: "options" as const, query: ticketCtx.id };
    if (modelCtx) return { mode: "options" as const, query: modelCtx.query };
    if (mentionCtx)
      return { mode: "options" as const, query: mentionCtx.query };
    return null;
  });

  // Asked once per visit: the list comes from the runtime, and a failed ask
  // repeated on every keystroke would not fare better.
  let modelsAsked = false;
  $effect(() => {
    if (!modelCtx || modelsAsked) return;
    modelsAsked = true;
    void loadAgent();
  });

  function modelsNote() {
    if (offeredModels?.length) return "no model matches";
    if (offeredModels)
      return "no list to pick from: type a model id, then enter";
    return agentPrefs.error ?? "loading models…";
  }

  const modelMenu = $derived.by(
    (): { options: MenuOption[]; crumb: MenuCrumb } | null => {
      if (!modelCtx) return null;
      const prefs = agentPrefs.prefs;
      if (modelCtx.stage === "model")
        return {
          crumb: {
            cmd: "/model",
            param: "model",
            desc: MODEL_COMMAND.description,
            empty: modelsNote(),
          },
          options: modelOptions(
            listedModels,
            modelCtx.query,
            prefs?.agent_model.value,
          ),
        };
      return {
        crumb: {
          cmd: `/model ${modelCtx.model.label}`,
          param: "effort",
          desc: "how much it reasons before it answers",
          empty: modelCtx.model.efforts.length
            ? "no effort matches"
            : "this model takes no effort: enter to use it",
        },
        options: effortOptions(
          modelCtx.model,
          modelCtx.query,
          prefs?.agent_effort.value,
        ),
      };
    },
  );

  $effect(() => {
    if (mentionCtx) ensureMentionables();
  });

  const mentionMenu = $derived.by(
    (): { options: MenuOption[]; crumb: MenuCrumb } | null => {
      if (!mentionCtx) return null;
      const offered = mentionables.list
        ? mentionOptions(mentionables.list, mentionCtx)
        : [];
      return {
        crumb: {
          cmd: "@",
          param: mentionCtx.kind ?? "source",
          desc: "attach a repo, bucket or project to the conversation",
          empty: mentionsNote(),
        },
        options: offered.map((o) => ({
          value: mentionWord(o.mention),
          label: o.mention.key,
          hint: o.mention.kind,
          desc: o.hint,
          icon: MENTION_ICONS[o.mention.kind],
        })),
      };
    },
  );

  const ticketMenu = $derived.by(
    (): { options: MenuOption[]; crumb: MenuCrumb } | null =>
      ticketCtx
        ? {
            crumb: {
              cmd: `/${ticketCtx.name}`,
              param: "ticket",
              desc: "a Freshdesk ticket number",
            },
            options: [],
          }
        : null,
  );

  $effect(() => {
    if (azCtx?.stage === "project" || azCtx?.stage === "type") ensureProjects();
    if (azCtx?.stage === "type") ensureTypes(azCtx.project.id);
  });

  // Two strings rather than one object, so typing a flag after the id does
  // not restart the lookup.
  const peekSourceType = $derived.by(() => {
    if (azCtx?.stage === "id") return "azure-devops";
    return ticketCtx ? "freshdesk" : null;
  });
  const peekId = $derived.by(() => {
    if (azCtx?.stage === "id") return workItemNumber(azCtx.query);
    return ticketCtx?.id || null;
  });
  $effect(() => {
    if (peekSourceType && peekId) return peekLater(peekSourceType, peekId);
    clearPeek();
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
      if (azCtx.stage === "id")
        return {
          crumb: {
            cmd: "/az explain",
            param: "id",
            desc: "an Azure DevOps work item number",
          },
          options: [],
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
  function peekPreview() {
    if (azCtx?.stage === "id") return explainPeek;
    if (ticketCtx) return ticketPeek;
    return undefined;
  }

  const optionsMenu = $derived(
    azMenu ?? ticketMenu ?? modelMenu ?? mentionMenu,
  );
  const menuOpen = $derived(
    cmdCtx !== null &&
      !cmdDismissed &&
      commands !== null &&
      // A turn under way leaves one command to offer: the one that stops it.
      (!chat.busy || cmdCtx.mode === "command"),
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
  $effect(() => {
    if (chat.debug) return tintSky("red");
  });
  $effect(() => {
    if (chat.mode) return tintSky(MODE_TINTS[chat.mode]);
  });

  function pickCommand(pick: CommandPick) {
    if (pick.kind === "builtin" && pick.builtin.name === STOP_COMMAND.name) {
      chat.input = "";
      void stop();
    } else if (
      pick.kind === "builtin" &&
      pick.builtin.name === DEBUG_COMMAND.name
    ) {
      chat.input = "";
      chat.debug = !chat.debug;
    } else if (pick.kind === "builtin") chat.input = `/${pick.builtin.name} `;
    else if (pick.kind === "mode") pickMode(pick.mode.name);
    else if (pick.kind === "option" && azCtx) pickAz(pick.value);
    else if (pick.kind === "option" && modelCtx) pickModel(pick.value);
    else if (pick.kind === "option") pickMention(pick.value);
    else {
      chat.artifact = { id: pick.artifact.id, title: pick.artifact.title };
      chat.input = "";
    }
  }

  function setModel(picked: ModelPick) {
    chat.model = picked;
    chat.input = "";
  }

  /** A model with efforts moves the line on to them; one without is taken. */
  function pickModel(value: string) {
    // Held in a local for the reason pickAz gives: the line it derives from
    // is cleared on the way.
    const ctx = modelCtx;
    if (!ctx) return;
    if (ctx.stage === "effort")
      return setModel(pickOf(ctx.model, value as AgentEffort));
    const model = listedModels.find((m) => m.id === value);
    if (!model) return;
    if (model.efforts.length) chat.input = `/model ${model.id} `;
    else setModel(pickOf(model));
  }

  function toggleMode(name: ChatModeName) {
    chat.input = "";
    chat.mode = chat.mode === name ? undefined : name;
  }

  /** Entering analyze mode asks for a ticket first; it may be left empty. */
  function pickMode(name: ChatModeName) {
    if (name === "analyze" && chat.mode !== name) chat.input = "/analyze ";
    else toggleMode(name);
  }

  function pickMention(word: string) {
    const mention = parseMentionWord(word);
    if (!mention) return;
    chat.mentions = withMentions(chat.mentions, [mention]);
    chat.input = withoutMentionBeingTyped(chat.input);
  }

  /** `/analyze …` or `/code …` typed whole: the mode, and what follows it. */
  function parseModeLine(
    message: string,
  ): { name: ChatModeName; rest: string } | null {
    const match = message.match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/);
    const mode = commands?.modes.find((m) => m.name === match?.[1]);
    return mode ? { name: mode.name, rest: match?.[2]?.trim() ?? "" } : null;
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
    } else if (ctx.stage === "type") {
      const type = typesOf(ctx.project.id).find((x) => x.name === value);
      chat.input = "";
      openComposer(ctx.project, type, { from: "chat" });
    }
  }

  /** `/az new [project] [type]` sent as a line: whatever it names is preselected. */
  async function openFromLine(message: string) {
    chat.input = "";
    const rest = message.replace(/^\/az[ \t]+new[ \t]*/, "");
    const hit = rest ? matchProject(`${rest} `, await ensureProjects()) : null;
    if (!hit) return openComposer(null, null, { from: "chat" });
    const types = await ensureTypes(hit.project.id);
    const type = types.find(
      (t) => t.name.toLowerCase() === hit.rest.toLowerCase(),
    );
    openComposer(hit.project, type, { from: "chat" });
  }

  /** A draft set aside with the X: the chat says so and offers it back. */
  const draftWaiting = $derived(hasDraft());

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
    // Typed whole and entered with its row dismissed, it still is no message.
    if (message === `/${STOP_COMMAND.name}`) {
      chat.input = "";
      return stop();
    }
    if (!message || chat.busy) return;
    if (message === `/${DEBUG_COMMAND.name}` && isGlobalAdmin()) {
      chat.input = "";
      chat.debug = !chat.debug;
      return;
    }
    if (isAzNew(message)) return openFromLine(message);
    // A `/model` line is never a message: Enter with no row to pick takes the
    // line when it is whole as typed, and otherwise waits for more.
    if (modelCtx) {
      const typed = typedPick(modelCtx, offeredModels);
      if (typed) setModel(typed);
      return;
    }
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
    const typed = await takeMentions(message);
    // Read before the input clears, which clears the lookup it comes from.
    const ticketArgsTyped = ticketLineArgs(typed);
    chat.input = "";
    if (!typed) return;
    const modeLine = parseModeLine(typed);
    if (modeLine && !modeLine.rest) return toggleMode(modeLine.name);
    if (modeLine) {
      chat.mode = modeLine.name;
      return startTurn(typed, undefined, ticketArgsTyped);
    }
    const command = parseCommand(typed);
    return startTurn(
      typed,
      command && ticketArgsTyped
        ? { ...command, args: ticketArgsTyped }
        : command,
    );
  }

  /** Attaches the `@` words that name something; the line without them, or "" for none left. */
  async function takeMentions(message: string): Promise<string> {
    if (!message.includes("@")) return message;
    const list = await ensureMentionables();
    if (!list) return message;
    const { mentions, rest } = takeTypedMentions(message, list);
    chat.mentions = withMentions(chat.mentions, mentions);
    return rest;
  }

  /** A ticket line's arguments with the source the lookup found, if it found one. */
  function ticketLineArgs(message: string): string | undefined {
    const line = parseTicketLine(message);
    return line?.id ? ticketArgs(line, peekedSource(line.id)) : undefined;
  }

  /** The newest answer written from code, the one a walkthrough is made of. */
  const walkableKey = $derived(
    chat.entries.filter((e) => e.kind === "assistant" && e.code).at(-1)?.key,
  );

  async function startTurn(
    message: string,
    command?: { name: string; args: string },
    modeArgs = "",
  ) {
    const leftMode =
      chat.modeOfLastTurn && chat.modeOfLastTurn !== chat.mode
        ? chat.modeOfLastTurn
        : undefined;
    chat.modeOfLastTurn = chat.mode;
    let readCode = false;
    let trace: TurnTrace | undefined;
    addEntry({ kind: "user", text: message });
    const uploadPaths = chat.uploads.map((u) => u.path);
    chat.uploads = [];
    chat.busy = true;
    chat.turnId = undefined;
    stopRequested = false;
    forgetCleared();
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
          mode: chat.mode ? { name: chat.mode, args: modeArgs } : undefined,
          leftMode,
          mentions: chat.mentions.length ? chat.mentions : undefined,
          model: chat.model?.id,
          effort: chat.model?.effort,
          debug: chat.debug || undefined,
        },
        turnAbort.signal,
      )) {
        if (event === "debug") {
          addEntry({
            kind: "trace",
            trace: { sent: data as unknown as TurnSent, calls: [] },
          });
          // Read back from the list: that one is reactive, the literal is not.
          const added = chat.entries[chat.entries.length - 1];
          if (added.kind === "trace") trace = added.trace;
        } else if (trace) recordFrame(trace, event, data);
        chat.queuePosition =
          event === "queued" ? (data.position as number) : null;
        if (event === "tool_result") showFiles(data);
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
          } else noteCall(tool);
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
        else if (event === "stopped") {
          if (data.sessionId) chat.sessionId = data.sessionId as string;
          addEntry({ kind: "stopped" });
        } else if (event === "error")
          addEntry({ kind: "error", text: data.message as string });
        snap();
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (e instanceof ChatRefused && e.status === 409 && e.turnId) {
        addEntry({
          kind: "running",
          turnId: e.turnId,
          text: e.message,
          stopped: false,
        });
        chat.input = message;
      }
      // Any other abort is this component going away, which reports nothing.
      else if (aborted && stopRequested) addEntry({ kind: "stopped" });
      else if (!aborted)
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

  /** The stop mark was pressed before the server had named the turn. */
  let stopRequested = false;

  /**
   * Ends the turn under way. The server answers with `stopped`, which closes
   * the stream. A turn it has not named yet has no id to stop, so its request
   * is dropped instead, and the server gives up a turn nobody is reading.
   */
  async function stop() {
    if (!chat.busy) return;
    if (!chat.turnId) {
      stopRequested = true;
      turnAbort?.abort();
      return;
    }
    try {
      await stopTurn(chat.turnId);
    } catch (e) {
      addEntry({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
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
      const refusal = uploadRefusal(
        file.name,
        file.size,
        commands?.uploadLimits,
      );
      if (refusal) {
        addEntry({ kind: "error", text: refusal });
        continue;
      }
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
  onDestroy(() => {
    turnAbort?.abort();
    unveilTopbar();
  });
  /**
   * The transcript goes at once, and ctrl+z brings it back until the next
   * turn. The nav takes its row back veiled, so the window settles while the
   * dock travels to the centre, and the dock's landing shows it.
   */
  function onClear() {
    if (chat.busy || !chat.entries.length) return;
    veilTopbar();
    clearChat();
    toast("conversation cleared · ctrl+z brings it back", "accent", 6000);
    composerEl?.focus();
  }

  // Bound only while the composer is empty, so text in it keeps the field's
  // own undo.
  $effect(() => {
    if (!canRestore() || chat.input) return;
    return pushScope([
      {
        key: "ctrl+z",
        label: "",
        hidden: true,
        inFields: true,
        run: restoreChat,
      },
    ]);
  });

  // Every mark leaves once it has nothing to act on, and focus would go with
  // it.
  function sendClick() {
    void send();
    composerEl?.focus();
  }

  function stopClick() {
    void stop();
    composerEl?.focus();
  }
</script>

{#snippet explainPeek()}
  <ItemPeek
    state={peek.current}
    sourceLabel="Azure DevOps projects"
    idle={azCtx?.query
      ? "a work item number is digits, like 4521"
      : "type the number, then enter"}
  />
{/snippet}

{#snippet ticketPeek()}
  <ItemPeek
    state={peek.current}
    sourceLabel="Freshdesk groups"
    idle={ticketCtx?.name === "analyze"
      ? "type the ticket number, or enter to switch analyze mode on"
      : "type the ticket number, then enter"}
  />
{/snippet}

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
              ><span class="mk" aria-hidden="true">{G.marker}</span>tachy</span
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
        {:else if entry.kind === "tools"}
          <div class="tool">
            <Icon name="tool" size="1em" weight={7} />
            <span class="calls">
              {#each tallyCalls(entry.calls) as tally, n (n)}
                {#if n > 0}<span class="sep" aria-hidden="true">·</span>{/if}
                <span>{tallyLabel(tally)}</span>
              {/each}
            </span>
          </div>
        {:else if entry.kind === "compact"}
          <CompactPanel title={entry.title} stats={entry.stats} />
        {:else if entry.kind === "output"}
          <OutputCard file={entry.file} />
        {:else if entry.kind === "files"}
          <FileTray files={entry.files} />
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
            <div class="body err"><PointerText text={entry.text} /></div>
          </div>
        {:else if entry.kind === "trace"}
          <TracePanel trace={entry.trace} />
        {:else if entry.kind === "stopped"}
          <div class="tool">
            <Icon name="stop" size="1em" weight={7} />
            <span>stopped</span>
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
      <div class="bar-col">
        <Scrollbar target={transcriptEl} controls="chat-transcript" />
      </div>
    {/if}
    <ArtifactPanel bind:edge={edgeEl} />
  </div>

  <div class="dock" bind:this={dockEl}>
    {#if chat.uploads.length || chat.artifact || chat.model || chat.debug || chat.mode || chat.mentions.length || draftWaiting}
      <div class="attachments">
        {#if chat.mode}
          <span class="attach model-chip">
            <span style:color="var(--star-ink-{MODE_TINTS[chat.mode]})">
              <Icon name={MODE_ICONS[chat.mode]} size="1em" />
            </span>
            {chat.mode} mode
            <button
              class="chip-x"
              aria-label="Leave {chat.mode} mode"
              use:tip={`Leave ${chat.mode} mode`}
              onclick={() => (chat.mode = undefined)}
              ><Icon name="close" size="1em" weight={7} /></button
            >
          </span>
        {/if}
        {#each chat.mentions as mention, i (mentionWord(mention))}
          <span class="attach model-chip">
            <Icon name={MENTION_ICONS[mention.kind]} size="1em" />
            {mention.key}
            <button
              class="chip-x"
              aria-label="Detach {mention.kind} {mention.key}"
              use:tip={`Detach ${mention.kind} ${mention.key}`}
              onclick={() => chat.mentions.splice(i, 1)}
              ><Icon name="close" size="1em" weight={7} /></button
            >
          </span>
        {/each}
        {#if chat.model}
          <span class="attach model-chip">
            <Icon name="ai" size="1em" />
            {chat.model.label}{chat.model.effort
              ? ` · ${chat.model.effort}`
              : ""}
            <button
              class="chip-x"
              aria-label="Back to your settings model"
              use:tip={"Back to your settings model"}
              onclick={() => (chat.model = undefined)}
              ><Icon name="close" size="1em" weight={7} /></button
            >
          </span>
        {/if}
        {#if chat.debug}
          <span class="attach model-chip">
            <Icon name="bug" size="1em" />
            debug
            <button
              class="chip-x"
              aria-label="Switch debug off"
              use:tip={"Switch debug off"}
              onclick={() => (chat.debug = false)}
              ><Icon name="close" size="1em" weight={7} /></button
            >
          </span>
        {/if}
        {#if draftWaiting}
          <button
            class="attach draft-chip"
            onclick={() => openComposer(null, null, { from: "chat" })}
          >
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
          modes={commands.modes}
          activeMode={chat.mode}
          builtins={commands.builtins}
          running={chat.busy}
          debuggable={isGlobalAdmin()}
          artifacts={commands.artifacts}
          options={optionsMenu?.options}
          crumb={optionsMenu?.crumb}
          preview={peekPreview()}
          onpick={pickCommand}
        />
      {/if}
      <label class="upload" use:tip={"Attach a document"}>
        <Icon name="attach" label="Attach a document" />
        <input type="file" accept={CHAT_UPLOAD_ACCEPT} onchange={onFile} />
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
              variant="ghost"
              icon="clear"
              iconSize="1.25em"
              disabled={chat.busy}
              aria-label="Clear the conversation"
              title="Clear the conversation"
              onclick={onClear}
            />
          {/if}
        </span>
        <span class="slot">
          {#if chat.busy}
            <Button
              variant="ghost"
              icon="stop"
              iconSize="1.25em"
              aria-label="Stop"
              title="Stop (/stop)"
              onclick={stopClick}
            />
          {:else if chat.input.trim()}
            <Button
              variant="ghost"
              icon="send"
              iconSize="1.25em"
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

<style>
  .chat {
    --side-w: 3.25rem;
    --upload-w: var(--side-w);
    --composer-gap: 0.5rem;
    /* The artifact tab's width, and the room it keeps from its neighbours. */
    --tab-w: 2.9rem;
    --edge-gap: 0.35rem;
    /* Where ArtifactPanel stands its tab: left of the scrollbar's column,
       which reaches into the padding `main` keeps on that side. */
    --edge-right: calc(var(--scrollbar-w) + var(--edge-gap) - var(--pad-2));
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
  /* The scrollbar is the last thing on the right, on the edge of `main`'s
     padding box; the artifact tab stands between it and the text. */
  .transcript-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: var(--edge-gap);
    margin-right: calc(-1 * var(--pad-2));
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
    padding-right: calc(var(--tab-w) + var(--gap));
  }
  .transcript::-webkit-scrollbar {
    display: none;
  }
  /* Kept whether or not the bar is drawn, so its arrival moves nothing. */
  .bar-col {
    flex: none;
    display: flex;
    width: var(--scrollbar-w);
  }

  /* Nothing said yet: the lede and the dock sit together in the middle. */
  .chat.empty {
    justify-content: center;
  }
  .chat.empty .transcript-wrap {
    flex: none;
    margin-right: 0;
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
    max-width: 70ch;
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
  .calls {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.75ch;
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
  .artifact-chip,
  .model-chip {
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
