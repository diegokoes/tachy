<script lang="ts">
  import { untrack } from "svelte";
  import { api } from "../api";
  import { chat } from "../chatState.svelte";
  import { session } from "../session.svelte";
  import type { NamedRow } from "../types";
  import {
    ArtifactMark,
    Button,
    Field,
    Modal,
    Panel,
    Scrim,
    Select,
    G,
    Icon,
  } from "../tui";
  import OutputSpecEditor, {
    emptyColumn,
    outputProblem,
    toArtifactSpec,
    type ArtifactSpec,
    type OutputSpec,
  } from "./OutputSpecEditor.svelte";
  import ArtifactThread from "./ArtifactThread.svelte";
  import { clearGlow, crt, glow, jolt, settle, spin, tweenValue } from "../motion";
  import { nextNavKey } from "../nav.svelte";
  import { pushScope } from "../keys.svelte";

  let tabBtn = $state<HTMLButtonElement>();
  let tabIcon = $state<HTMLSpanElement>();
  let tabFrame = $state<SVGSVGElement>();
  let pickerEl = $state<HTMLElement>();
  let thread = $state<ArtifactThread>();
  let firing = $state(false);

  type ArtifactScope = "user" | "team" | "global";

  interface ArtifactMeta {
    id: string;
    scope: ArtifactScope;
    team_id: string | null;
    user_id: string | null;
    slug: string;
    title: string;
    description: string | null;
    spec: ArtifactSpec | null;
    updated_at: string;
  }

  let open = $state(false);
  let items = $state<ArtifactMeta[]>([]);
  let teams = $state<{ id: string; slug: string }[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let armedDelete = $state<string | null>(null);

  const SCOPE_LABELS: Record<ArtifactScope, string> = {
    user: "you",
    team: "team",
    global: "global",
  };
  const grouped = $derived(
    (["user", "team", "global"] as ArtifactScope[])
      .map((scope) => ({ scope, rows: items.filter((a) => a.scope === scope) }))
      .filter((g) => g.rows.length > 0),
  );

  async function load() {
    loading = true;
    error = null;
    try {
      items = await api.get<ArtifactMeta[]>("/artifacts");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function loadTeams() {
    if (session.me?.role === "admin") {
      try {
        const rows = await api.get<NamedRow[]>("/teams");
        teams = rows
          .filter((t) => t.id && t.slug)
          .map((t) => ({ id: t.id as string, slug: t.slug as string }));
        return;
      } catch {}
    }
    teams = (session.me?.teams ?? []).map((t) => ({
      id: t.team_id,
      slug: t.team_slug,
    }));
  }

  function toggle() {
    open = !open;
    armedDelete = null;
    if (open) {
      load();
      loadTeams();
    }
  }

  // Picks up where the tab bar's digits stop, so the row reads 1..n, artifacts.
  const hotkey = $derived(nextNavKey());

  // hidden: the tab carries the digit itself, same as the nav bar.
  $effect(() => {
    const key = String(hotkey);
    return pushScope([
      {
        key,
        label: "artifacts",
        hidden: true,
        run: () => {
          if (!editorOpen) toggle();
        },
      },
    ]);
  });

  $effect(() => {
    const icon = tabIcon;
    if (!icon) return;
    if (!chat.artifact || open) {
      clearGlow(icon);
      return;
    }
    const tween = glow(icon);
    return () => tween?.kill();
  });

  $effect(() => {
    const icon = tabIcon;
    if (!icon) return;
    if (!open) {
      settle(icon);
      return;
    }
    const tweens = spin(icon);
    return () => {
      for (const t of tweens) t.kill();
      settle(icon);
    };
  });

  /* Opening the panel opens the mark up: the hexagon grows from its centre and
     the three rings drift apart inside it, while the rings themselves keep
     exactly the size they had. That is why the frame scales and the mark does
     not — scaling the button would have taken the rings with it.

     One tween drives both, so the frame and the spread can never drift out of
     step. Growing the FRAME (rather than the button) is also what keeps the
     thread attached: the wire is aimed at the frame element, whose client rect
     follows this transform, where the button's would not move at all.

     Closing waits for the wire to retract first. The thread freezes its path
     on outro — it has to, since redrawing mid-retract would jump the drawn
     fraction — so shrinking underneath it would pull the hexagon out from
     under a wire still pointing at where the edge used to be. */
  const SPREAD_SHUT = 30;
  const SPREAD_OPEN = 42;
  const FRAME_OPEN = 1.18;
  const THREAD_RETRACT = 0.22;

  let openT = $state(0);
  const spread = $derived(SPREAD_SHUT + (SPREAD_OPEN - SPREAD_SHUT) * openT);
  const frameScale = $derived(1 + (FRAME_OPEN - 1) * openT);

  /* untrack: the tween writes openT, so reading it tracked would re-run this
     effect on every frame it animates — killing and restarting the tween from
     wherever it had got to. Closing never finished, because each restart also
     re-armed the THREAD_RETRACT delay and the tween spent its life waiting. */
  $effect(() => {
    const to = open ? 1 : 0;
    const tween = tweenValue(untrack(() => openT), to, (v) => (openT = v), {
      duration: open ? 0.44 : 0.28,
      delay: open ? 0 : THREAD_RETRACT,
      ease: open ? "back.out(1.6)" : "power2.inOut",
    });
    return () => tween?.kill();
  });

  // Closing takes the thread (and any send in flight) with it.
  $effect(() => {
    if (!open) firing = false;
  });

  function select(a: ArtifactMeta) {
    if (firing) return;
    const attaching = chat.artifact?.id !== a.id;
    chat.artifact = attaching ? { id: a.id, title: a.title } : undefined;
    if (!attaching || !thread) {
      open = false;
      return;
    }
    firing = true;
    thread.discharge(() => {
      if (tabBtn) jolt(tabBtn);
      open = false;
      firing = false;
    });
  }

  function canWrite(a: ArtifactMeta): boolean {
    if (a.scope === "user") return true;
    if (a.scope === "team")
      return (
        session.me?.role === "admin" ||
        (session.me?.teams ?? []).some((t) => t.team_id === a.team_id)
      );
    return session.me?.role === "admin";
  }

  const teamSlugFor = (teamId: string | null) =>
    teams.find((t) => t.id === teamId)?.slug;

  let editorOpen = $state(false);
  let fetching = $state<string | null>(null);
  let editorMode = $state<"create" | "edit">("create");
  let editorBusy = $state(false);
  let editorError = $state<string | null>(null);
  let fAudience = $state("user");
  let fWasAudience = $state("user");
  let fEditId = $state<string | null>(null);
  let fEditSlug = $state("");
  let fTitle = $state("");
  let fDescription = $state("");
  let fPrompt = $state("");
  let fHasOutput = $state(false);
  let fOutput = $state<OutputSpec>({ format: "xlsx", columns: [] });

  const TEAM_PREFIX = "team:";
  const audienceOf = (a: ArtifactMeta) =>
    a.scope === "team"
      ? `${TEAM_PREFIX}${teamSlugFor(a.team_id) ?? ""}`
      : a.scope;
  const scopeOf = (audience: string): ArtifactScope =>
    audience.startsWith(TEAM_PREFIX) ? "team" : (audience as ArtifactScope);
  const teamOf = (audience: string) =>
    audience.startsWith(TEAM_PREFIX) ? audience.slice(TEAM_PREFIX.length) : "";

  const fScope = $derived(scopeOf(fAudience));
  const fTeam = $derived(teamOf(fAudience));

  const audienceOptions = $derived([
    { value: "user", label: "only me" },
    ...teams.map((t) => ({ value: `team:${t.slug}`, label: `team ${t.slug}` })),
    ...(session.me?.role === "admin"
      ? [{ value: "global", label: "everyone" }]
      : []),
  ]);

  const blankOutput = (): OutputSpec => ({
    format: "xlsx",
    sheet: "",
    filename: "",
    columns: [emptyColumn()],
  });

  const kebab = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  /* The name the agent and `/artifact` use. Nobody should have to invent one,
     so it follows the title — suffixed when that name is already taken where
     the artifact is going, which is also what keeps a move from landing on
     someone else's artifact. */
  function freeSlug(
    base: string,
    scope: ArtifactScope,
    team: string,
    keep: string | null,
  ): string {
    const taken = new Set(
      items
        .filter(
          (a) =>
            a.id !== keep &&
            a.scope === scope &&
            (scope !== "team" || teamSlugFor(a.team_id) === team),
        )
        .map((a) => a.slug),
    );
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  const fSlug = $derived(
    freeSlug(
      kebab(fTitle) || "artifact",
      fScope,
      fTeam,
      fEditId,
    ),
  );

  function openCreate() {
    editorMode = "create";
    fAudience = "user";
    fWasAudience = "user";
    fEditId = null;
    fEditSlug = "";
    fTitle = "";
    fDescription = "";
    fPrompt = "";
    fHasOutput = false;
    fOutput = blankOutput();
    editorError = null;
    editorOpen = true;
  }

  // The prompt is fetched BEFORE the modal opens, so it comes up filled instead
  // of blinking its content in a beat later.
  async function openEdit(a: ArtifactMeta) {
    if (fetching) return;
    fetching = a.id;
    let body = "";
    let failed: string | null = null;
    try {
      const full = await api.get<ArtifactMeta & { body: string }>(
        `/artifacts/${a.id}`,
      );
      body = full.body;
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    }
    fetching = null;
    editorMode = "edit";
    fAudience = audienceOf(a);
    fWasAudience = fAudience;
    fEditId = a.id;
    fEditSlug = a.slug;
    fTitle = a.title;
    fDescription = a.description ?? "";
    fPrompt = body;
    fHasOutput = !!a.spec?.output;
    fOutput = a.spec?.output
      ? { sheet: "", filename: "", ...a.spec.output }
      : blankOutput();
    editorError = failed;
    editorOpen = true;
  }

  async function save() {
    if (!fTitle.trim() || !fPrompt.trim()) {
      editorError = "a name and a prompt are required";
      return;
    }
    const problem = outputProblem(fHasOutput, fOutput);
    if (problem) {
      editorError = problem;
      return;
    }
    const moved = editorMode === "edit" && fAudience !== fWasAudience;
    const wasScope = scopeOf(fWasAudience);
    const wasTeam = teamOf(fWasAudience);
    const wasAttached = !!fEditId && chat.artifact?.id === fEditId;
    const slug = fSlug;
    const rekeyed = editorMode === "edit" && slug !== fEditSlug;

    editorBusy = true;
    editorError = null;
    try {
      await api.put("/artifacts", {
        scope: fScope,
        ...(fScope === "team" ? { team: fTeam } : {}),
        slug,
        title: fTitle.trim(),
        description: fDescription.trim() || undefined,
        body: fPrompt,
        spec: toArtifactSpec(fHasOutput, fOutput) ?? null,
      });
      if (moved || rekeyed)
        await api.delete("/artifacts", {
          scope: wasScope,
          ...(wasScope === "team" ? { team: wasTeam } : {}),
          slug: fEditSlug,
        });
      editorOpen = false;
      await load();
      const now = items.find(
        (a) =>
          a.slug === slug &&
          a.scope === fScope &&
          (fScope !== "team" || teamSlugFor(a.team_id) === fTeam),
      );
      if (wasAttached && now) {
        chat.artifact = { id: now.id, title: now.title };
      }
      if (rekeyed && wasAttached && !now) {
        chat.artifact = undefined;
      }
      // The command menu is cached by ChatView and needs the new slug/title.
      window.dispatchEvent(new Event("artifacts-changed"));
    } catch (e) {
      editorError = e instanceof Error ? e.message : String(e);
    } finally {
      editorBusy = false;
    }
  }

  async function remove(a: ArtifactMeta) {
    if (armedDelete !== a.id) {
      armedDelete = a.id;
      return;
    }
    armedDelete = null;
    try {
      const teamSlug = teamSlugFor(a.team_id);
      await api.delete("/artifacts", {
        scope: a.scope,
        ...(a.scope === "team" ? { team: teamSlug } : {}),
        slug: a.slug,
      });
      if (chat.artifact?.id === a.id) chat.artifact = undefined;
      await load();
      window.dispatchEvent(new Event("artifacts-changed"));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && open && !editorOpen) open = false;
  }}
/>

<div class="edge-slot">
  <button
    bind:this={tabBtn}
    class="edge-tab"
    class:active={open || !!chat.artifact}
    onclick={toggle}
    title="Artifacts: reusable prompt templates to attach as context ({hotkey})"
    aria-label="Artifacts"
    aria-expanded={open}
  >
    <!-- The frame is a drawn shape, not the button's own border: clip-path
         would cut the border off along with everything else outside the
         polygon, leaving the tab with no outline at all. -->
    <svg
      bind:this={tabFrame}
      class="frame"
      viewBox="0 0 100 115"
      style="transform: scale({frameScale})"
      aria-hidden="true"
    >
      <polygon points="50,4 96.3,30.75 96.3,84.25 50,111 3.7,84.25 3.7,30.75" />
    </svg>
    <span bind:this={tabIcon} class="tab-icon"
      ><ArtifactMark size="1em" {spread} /></span
    >
  </button>
</div>

{#if open}
  <Scrim z={6} soft={editorOpen} onclick={() => (open = false)} />

  <div class="stage">
    <aside class="picker" bind:this={pickerEl} transition:crt>
      <Panel title="artifacts" tone="accent" scan>
        {#snippet meta()}
          <span class="head-acts">
            <Button
              variant="ghost"
              tone="ok"
              square
              icon="plus"
              title="new artifact"
              aria-label="new artifact"
              onclick={openCreate}
            />
            <Button
              variant="ghost"
              square
              icon="cancel"
              title="close"
              aria-label="close"
              onclick={() => (open = false)}
            />
          </span>
        {/snippet}

        <div class="pick-body">
          {#if error}<p class="error">{error}</p>{/if}
          {#if loading && items.length === 0}
            <p class="muted">loading…</p>
          {:else if items.length === 0 && !error}
            <p class="muted empty">No artifacts yet</p>
          {/if}
          {#each grouped as g (g.scope)}
            <div class="scope-head">{SCOPE_LABELS[g.scope]}</div>
            <ul class="art-list">
              {#each g.rows as a (a.id)}
                <li class="art-row" class:selected={chat.artifact?.id === a.id}>
                  <button class="art-pick" onclick={() => select(a)}>
                    <span class="art-title">
                      {chat.artifact?.id === a.id ? `${G.selected} ` : ""}{a.title}
                      {#if a.spec?.output}<span
                          class="art-out"
                          title="produces a {a.spec.output.format} file"
                        ><Icon name="download" size="0.9em" /> {a.spec.output.format}</span>{/if}
                    </span>
                    {#if a.description}<span class="art-desc">{a.description}</span>{/if}
                  </button>
                  {#if canWrite(a)}
                    <span class="art-actions">
                      <Button
                        variant="ghost"
                        tone="info"
                        square
                        icon="edit"
                        title="edit"
                        aria-label="edit"
                        busy={fetching === a.id}
                        onclick={() => openEdit(a)}
                      />
                      <Button
                        variant="ghost"
                        tone="danger"
                        square
                        icon={armedDelete === a.id ? "check" : "cancel"}
                        title={armedDelete === a.id ? "click again to delete" : "delete"}
                        aria-label="delete"
                        onclick={() => remove(a)}
                      />
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/each}
        </div>
      </Panel>
    </aside>
  </div>

  <ArtifactThread bind:this={thread} from={pickerEl} to={tabFrame} />
{/if}

{#if editorOpen}
  <Modal
    title={editorMode === "create" ? "new artifact" : "edit artifact"}
    width="60rem"
    confirmLabel="save"
    busy={editorBusy}
    onConfirm={save}
    onCancel={() => (editorOpen = false)}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="ed-form"
      onkeydown={(e) => {
        if (e.key === "Enter") e.stopPropagation();
      }}
    >
      <div class="who">
        <Select
          bind:value={fAudience}
          options={audienceOptions}
          aria-label="who can use it"
        />
      </div>

      <Field label="name" required>
        <input bind:value={fTitle} />
      </Field>

      <Field label="when to use it">
        <input bind:value={fDescription} />
      </Field>

      <Field label="prompt" required>
        <textarea rows="10" bind:value={fPrompt}></textarea>
      </Field>

      <OutputSpecEditor
        bind:enabled={fHasOutput}
        bind:output={fOutput}
        slug={fSlug}
      />

      {#if editorError}<p class="error">{editorError}</p>{/if}
    </div>
  </Modal>
{/if}

<style>
  .edge-slot {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    z-index: 9;
    display: flex;
    align-items: center;
    gap: var(--pad-1);
    pointer-events: none;
  }
  /* A pointy-top hexagon, not the octagon the shape list also offers: at this
     size an octagon just reads as a rounded square, where six sides stay
     legible as a shape. Its vertical flanks suit a tab pinned to the edge, and
     its point echoes the triangle of rings inside it.

     Sized to the polygon's own 92.6 × 107 proportions so the viewBox is never
     stretched, and scaled up from 2.5rem to give the ring triangle room to
     spread without crowding the hexagon's flanks. */
  .edge-tab {
    pointer-events: auto;
    position: relative;
    width: 2.9rem;
    height: 3.35rem;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 1.28rem;
    line-height: 1;
    display: grid;
    place-items: center;
  }
  .frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .frame polygon {
    fill: var(--bg);
    stroke: var(--border);
    stroke-width: 3;
    stroke-linejoin: round;
  }
  /* Sized to fill the hexagon rather than float in it, with the headroom the
     spin needs: the pulse scales the mark to 1.22x, and the rings have to stay
     inside the polygon's narrowest point at full stretch. The ceiling here is
     1.45em; 1.40em sits just under it. */
  .tab-icon {
    position: relative;
    display: inline-block;
    font-size: 1.4em;
    line-height: 1;
  }
  .edge-tab:hover,
  .edge-tab.active {
    color: var(--accent);
  }
  .edge-tab:hover .frame polygon,
  .edge-tab.active .frame polygon {
    stroke: var(--accent);
  }
  /* base.css rings a focused button with an inset box-shadow, which would draw
     a rectangle around a hexagon. Put the ring on the polygon instead. */
  .edge-tab:focus-visible {
    outline: none;
    box-shadow: none;
  }
  .edge-tab:focus-visible .frame polygon {
    stroke: var(--accent);
    stroke-width: 5;
  }


  .stage {
    position: absolute;
    inset: 0;
    z-index: 8;
    display: grid;
    place-items: center;
    padding: var(--pad-4) 6rem var(--pad-4) var(--pad-4);
    pointer-events: none;
  }
  .picker {
    pointer-events: auto;
    width: min(46rem, 100%);
    transform-origin: center;
  }

  .head-acts { display: inline-flex; gap: var(--pad-2); align-items: center; }
  .head-acts :global(.btn.square:focus-visible) {
    border-color: transparent;
    outline: none;
    box-shadow: none;
  }

  .pick-body {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    max-height: min(24rem, 45vh);
    overflow-y: auto;
  }

  .scope-head {
    margin-top: var(--pad-2);
    color: var(--muted);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
    border-bottom: 1px solid var(--border);
    padding-bottom: var(--pad-1);
  }
  .art-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--pad-2);
  }
  .art-row { display: flex; align-items: stretch; gap: var(--pad-1); min-width: 0; }
  .art-row.selected .art-pick { border-color: var(--accent); }
  .art-pick {
    flex: 1;
    min-width: 0;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    padding: var(--pad-2) var(--pad-3);
    background: var(--panel);
  }
  .art-title { font-size: var(--fs-sm); }
  .art-out {
    margin-left: var(--pad-1);
    padding: 0 var(--pad-1);
    border: 1px solid var(--accent);
    color: var(--accent);
    font-size: 0.62rem;
    letter-spacing: var(--label-spacing);
    white-space: nowrap;
  }
  .art-desc {
    color: var(--muted);
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .art-actions { display: flex; flex-direction: column; gap: var(--pad-1); }

  .ed-form {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    text-align: left;
    padding-right: var(--pad-2);
  }
  .ed-form textarea { resize: vertical; max-width: 100%; }

  .who {
    display: grid;
    justify-items: center;
    text-align: center;
    padding-bottom: var(--pad-2);
    border-bottom: 1px solid var(--border);
  }

  .muted { color: var(--muted); }
  .empty {
    margin: auto;
    min-height: 5rem;
    display: grid;
    place-items: center;
    text-align: center;
  }
  .error { color: var(--danger); margin: 0; font-size: 0.8rem; }
</style>
