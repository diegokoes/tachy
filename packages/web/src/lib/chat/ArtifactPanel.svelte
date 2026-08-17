<script lang="ts">
  import { api } from "../api";
  import { chat } from "../chatState.svelte";
  import { session } from "../session.svelte";
  import type { NamedRow } from "../types";
  import { Button, Field, Modal, Panel, Select, G } from "../tui";
  import OutputSpecEditor, {
    emptyColumn,
    outputProblem,
    toArtifactSpec,
    type ArtifactSpec,
    type OutputSpec,
  } from "./OutputSpecEditor.svelte";
  import ArtifactThread from "./ArtifactThread.svelte";
  import { clearGlow, crt, glow, jolt, settle, spin } from "../motion";
  import { nextNavKey, superscript } from "../nav.svelte";
  import { pushScope } from "../keys.svelte";

  let tabBtn = $state<HTMLButtonElement>();
  let tabIcon = $state<HTMLSpanElement>();
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

  /** One list instead of a scope picker plus a team picker to go with it. */
  const audienceOptions = $derived([
    { value: "user", label: "only me" },
    ...teams.map((t) => ({ value: `team:${t.slug}`, label: `team ${t.slug}` })),
    ...(session.me?.role === "admin"
      ? [{ value: "global", label: "everyone" }]
      : []),
  ]);

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
      editorMode === "edit" ? fEditSlug : kebab(fTitle) || "artifact",
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
    /* A row belongs to one scope, so changing the audience writes the artifact
       where it now lives and drops the old copy — and re-attaches it, since a
       moved artifact is a new row with a new id. */
    const moved = editorMode === "edit" && fAudience !== fWasAudience;
    const wasScope = scopeOf(fWasAudience);
    const wasTeam = teamOf(fWasAudience);
    const wasAttached = !!fEditId && chat.artifact?.id === fEditId;
    const slug = fSlug;

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
      if (moved)
        await api.delete("/artifacts", {
          scope: wasScope,
          ...(wasScope === "team" ? { team: wasTeam } : {}),
          slug: fEditSlug,
        });
      editorOpen = false;
      await load();
      if (moved) {
        const now = items.find(
          (a) => a.slug === slug && audienceOf(a) === fAudience,
        );
        if (wasAttached)
          chat.artifact = now ? { id: now.id, title: now.title } : undefined;
      }
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
  <span class="tab-key" aria-hidden="true">{superscript(hotkey)}</span>
  <button
    bind:this={tabBtn}
    class="edge-tab"
    class:active={open || !!chat.artifact}
    onclick={toggle}
    title="Artifacts — reusable prompt templates to attach as context ({hotkey})"
    aria-label="Artifacts"
    aria-expanded={open}
  ><span bind:this={tabIcon} class="tab-icon">{G.artifact}</span></button>
</div>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="scrim"
    class:hushed={editorOpen}
    onclick={() => (open = false)}
  ></div>

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
          {#if loading}
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
                        >{G.file} {a.spec.output.format}</span>{/if}
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

  <ArtifactThread bind:this={thread} from={pickerEl} to={tabBtn} />
{/if}

{#if editorOpen}
  <Modal
    title={editorMode === "create" ? "new artifact" : "edit artifact"}
    width="46rem"
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
        <Field label="who can use it">
          <Select
            bind:value={fAudience}
            options={audienceOptions}
            aria-label="who can use it"
          />
        </Field>
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
    right: 0.4rem;
    top: 50%;
    transform: translateY(-50%);
    z-index: 9;
    display: flex;
    align-items: center;
    gap: var(--pad-1);
    pointer-events: none;
  }
  .edge-tab {
    pointer-events: auto;
    padding: var(--pad-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--muted);
    font-size: 1.15rem;
    line-height: 1;
    display: grid;
    place-items: center;
  }
  .tab-icon {
    display: inline-block;
    line-height: 1;
  }
  .tab-key {
    font-size: var(--fs-xs);
    line-height: 1;
    color: var(--accent);
    transform: translateY(-0.65rem);
  }
  .edge-tab:hover,
  .edge-tab.active {
    color: var(--accent);
    border-color: var(--accent);
  }

  .scrim {
    position: absolute;
    inset: 0;
    z-index: 6;
    background: color-mix(in srgb, var(--bg) 74%, transparent);
  }
  /* The editor lays its own scrim on top; two at 74% stack to solid black. */
  .scrim.hushed {
    background: color-mix(in srgb, var(--bg) 25%, transparent);
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

  /* The form scrolls inside the modal — an output spec with a dozen columns
     is taller than any screen. */
  .ed-form {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    text-align: left;
    min-width: min(28rem, 100%);
    max-height: min(30rem, 58vh);
    overflow-y: auto;
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
