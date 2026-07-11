<script lang="ts">
  import { api } from "../api";
  import { chat } from "../chatState.svelte";
  import { session, canCurateScope } from "../session.svelte";
  import type { NamedRow } from "../types";
  import AsciiModal from "../AsciiModal.svelte";
  import AsciiSelect from "../AsciiSelect.svelte";

  type ArtifactScope = "user" | "team" | "global";

  interface ArtifactMeta {
    id: string;
    scope: ArtifactScope;
    team_id: string | null;
    user_id: string | null;
    slug: string;
    title: string;
    description: string | null;
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
    teams = (session.me?.team_admin ?? []).map((t) => ({
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

  function select(a: ArtifactMeta) {
    chat.artifact =
      chat.artifact?.id === a.id ? undefined : { id: a.id, title: a.title };
    open = false;
  }

  function canWrite(a: ArtifactMeta): boolean {
    if (a.scope === "user") return true;
    if (a.scope === "team") return canCurateScope({ team_id: a.team_id });
    return session.me?.role === "admin";
  }

  const teamOptions = $derived(teams.map((t) => t.slug));
  const scopeOptions = $derived([
    { value: "user", label: "user (only you)" },
    ...(teamOptions.length ? [{ value: "team", label: "team" }] : []),
    ...(session.me?.role === "admin"
      ? [{ value: "global", label: "global (everyone)" }]
      : []),
  ]);
  const teamSlugFor = (teamId: string | null) =>
    teams.find((t) => t.id === teamId)?.slug;

  let editorOpen = $state(false);
  let editorMode = $state<"create" | "edit">("create");
  let editorBusy = $state(false);
  let editorError = $state<string | null>(null);
  let fScope = $state<ArtifactScope>("user");
  let fTeam = $state("");
  let fSlug = $state("");
  let fSlugTouched = $state(false);
  let fTitle = $state("");
  let fDescription = $state("");
  let fBody = $state("");

  const kebab = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  function openCreate() {
    editorMode = "create";
    fScope = "user";
    fTeam = teamOptions[0] ?? "";
    fSlug = "";
    fSlugTouched = false;
    fTitle = "";
    fDescription = "";
    fBody = "";
    editorError = null;
    editorOpen = true;
  }

  async function openEdit(a: ArtifactMeta) {
    editorMode = "edit";
    fScope = a.scope;
    fTeam = teamSlugFor(a.team_id) ?? "";
    fSlug = a.slug;
    fSlugTouched = true;
    fTitle = a.title;
    fDescription = a.description ?? "";
    fBody = "";
    editorError = null;
    editorOpen = true;
    try {
      const full = await api.get<ArtifactMeta & { body: string }>(
        `/artifacts/${a.id}`,
      );
      fBody = full.body;
    } catch (e) {
      editorError = e instanceof Error ? e.message : String(e);
    }
  }

  async function save() {
    if (!fTitle.trim() || !fSlug.trim() || !fBody.trim()) {
      editorError = "title, slug and body are required";
      return;
    }
    editorBusy = true;
    editorError = null;
    try {
      await api.put("/artifacts", {
        scope: fScope,
        ...(fScope === "team" ? { team: fTeam } : {}),
        slug: fSlug.trim(),
        title: fTitle.trim(),
        description: fDescription.trim() || undefined,
        body: fBody,
      });
      editorOpen = false;
      await load();
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

<button
  class="edge-tab"
  class:active={open || !!chat.artifact}
  onclick={toggle}
  title="Artifacts — reusable prompt templates to attach as context"
  aria-label="Artifacts"
>
  <span class="tab-logo" aria-hidden="true">◈</span>
  <span class="tab-label" aria-hidden="true">ARTIFACTS</span>
  <span class="tab-logo" aria-hidden="true">◈</span>
</button>

{#if open}
  <aside class="flyout">
    <div class="fly-head">
      <span class="fly-title">artifacts</span>
      <button class="mini" onclick={openCreate}>+ new</button>
      <button class="ghost fly-close" onclick={() => (open = false)}>✕</button>
    </div>
    <p class="fly-hint muted">
      Reusable context injected ahead of your message — e.g. the style and
      structure for a docs-improvement report.
    </p>
    {#if error}<p class="error">{error}</p>{/if}
    {#if loading}
      <p class="muted">loading…</p>
    {:else if items.length === 0 && !error}
      <p class="muted">No artifacts yet — create one with + new.</p>
    {/if}
    {#each grouped as g (g.scope)}
      <div class="scope-head">{SCOPE_LABELS[g.scope]}</div>
      <ul class="art-list">
        {#each g.rows as a (a.id)}
          <li class="art-row" class:selected={chat.artifact?.id === a.id}>
            <button class="art-pick" onclick={() => select(a)}>
              <span class="art-title">
                {chat.artifact?.id === a.id ? "› " : ""}{a.title}
              </span>
              {#if a.description}<span class="art-desc">{a.description}</span>{/if}
            </button>
            {#if canWrite(a)}
              <span class="art-actions">
                <button class="ghost" title="edit" onclick={() => openEdit(a)}>✎</button>
                <button
                  class="ghost"
                  class:danger={armedDelete === a.id}
                  title="delete"
                  onclick={() => remove(a)}
                >{armedDelete === a.id ? "sure?" : "✕"}</button>
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
  </aside>
{/if}

{#if editorOpen}
  <AsciiModal
    title={editorMode === "create" ? "new artifact" : "edit artifact"}
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
      <div class="ed-row">
        <label>scope
          <AsciiSelect
            bind:value={fScope}
            options={scopeOptions}
            disabled={editorMode === "edit"}
          />
        </label>
        {#if fScope === "team"}
          <label>team
            <AsciiSelect
              bind:value={fTeam}
              options={teamOptions}
              disabled={editorMode === "edit"}
            />
          </label>
        {/if}
        <label>slug
          <input
            bind:value={fSlug}
            oninput={() => (fSlugTouched = true)}
            disabled={editorMode === "edit"}
            placeholder="docs-report"
          />
        </label>
      </div>
      <label>title
        <input
          bind:value={fTitle}
          oninput={() => {
            if (!fSlugTouched) fSlug = kebab(fTitle);
          }}
          placeholder="Docs improvement report"
        />
      </label>
      <label>description
        <input bind:value={fDescription} placeholder="when to use this (shown in the picker)" />
      </label>
      <label>body
        <textarea
          rows="10"
          bind:value={fBody}
          placeholder="The prompt/context injected ahead of your message — style, structure, audience…"
        ></textarea>
      </label>
      {#if editorError}<p class="error">{editorError}</p>{/if}
    </div>
  </AsciiModal>
{/if}

<style>
  .edge-tab {
    align-self: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.45rem;
    max-height: 100%;
    overflow: hidden;
    padding: 0.55rem 0.1rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
  }
  .tab-logo {
    font-size: 0.85rem;
    line-height: 1;
  }
  .tab-label {
    writing-mode: vertical-rl;
    text-orientation: upright;
    font-size: 0.58rem;
    letter-spacing: 0.3em;
    line-height: 1;
  }
  .edge-tab:hover,
  .edge-tab.active {
    color: var(--accent);
    border-color: var(--accent);
  }

  .flyout {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 7;
    width: min(21rem, 90%);
    overflow-y: auto;
    padding: 0.75rem 0.9rem;
    background: var(--panel-solid);
    border: 1px solid var(--accent);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .fly-head { display: flex; align-items: center; gap: 0.5rem; }
  .fly-title { flex: 1; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.8rem; }
  .fly-close { padding: 0.1rem 0.4rem; }
  .fly-hint { margin: 0; font-size: 0.75rem; line-height: 1.4; }

  .scope-head {
    margin-top: 0.4rem;
    color: var(--muted);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.15rem;
  }
  .art-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .art-row { display: flex; align-items: flex-start; gap: 0.25rem; }
  .art-row.selected .art-pick { border-color: var(--accent); }
  .art-pick {
    flex: 1;
    min-width: 0;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.4rem 0.55rem;
    background: var(--panel);
  }
  .art-title { font-size: 0.85rem; }
  .art-desc {
    color: var(--muted);
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .art-actions { display: flex; flex-direction: column; gap: 0.15rem; }
  .art-actions .ghost { padding: 0.1rem 0.35rem; font-size: 0.75rem; }
  .art-actions .danger { color: var(--danger); border-color: var(--danger); }

  .ed-form { display: flex; flex-direction: column; gap: 0.5rem; text-align: left; }
  .ed-row { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: flex-end; }
  .ed-form label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .ed-form input, .ed-form textarea { font: inherit; color: var(--text); }
  .ed-form textarea { resize: vertical; min-width: 26rem; max-width: 100%; }

  .muted { color: var(--muted); }
  .error { color: var(--danger); margin: 0; font-size: 0.8rem; }
</style>
