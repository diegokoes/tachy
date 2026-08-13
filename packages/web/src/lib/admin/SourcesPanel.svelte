<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { session } from "../session.svelte";
  import AsciiSelect from "../AsciiSelect.svelte";
  import DeleteButton from "./DeleteButton.svelte";
  import { TIP, csv, errText, type Connection, type SourceProject } from "./shared";

  type SourceType = "freshdesk" | "azure-devops" | "github";
  type Probe = {
    ok: boolean;
    error?: string;
    identity?: string;
    groups?: { key: string; name: string }[];
    groupsNote?: string;
  };

  const SPEC: Record<SourceType, {
    label: string;
    hostLabel: string;
    hostPlaceholder: string;
    tokenLabel: string;
    tokenHint: string;
    groupLabel: string;
    groupPlaceholder: string;
    configKey: "projects" | "repos" | null;
  }> = {
    freshdesk: {
      label: "Freshdesk",
      hostLabel: "domain",
      hostPlaceholder: "acme.freshdesk.com",
      tokenLabel: "API key",
      tokenHint: "Freshdesk profile → API key (a per-agent key; tickets are read with that agent's permissions).",
      groupLabel: "group",
      groupPlaceholder: "group id",
      configKey: null,
    },
    "azure-devops": {
      label: "Azure DevOps",
      hostLabel: "organization",
      hostPlaceholder: "my-org  (or https://dev.azure.com/my-org)",
      tokenLabel: "PAT",
      tokenHint: "A personal access token, org-scoped: it reaches every project you have permissions on. Scopes: Work Items (read, or read & write to create tickets), Wiki read, Code read.",
      groupLabel: "project",
      groupPlaceholder: "project name",
      configKey: "projects",
    },
    github: {
      label: "GitHub",
      hostLabel: "API base URL",
      hostPlaceholder: "https://api.github.com  (or GHE /api/v3)",
      tokenLabel: "token",
      tokenHint: "A PAT with repo/issues read access.",
      groupLabel: "repo",
      groupPlaceholder: "owner/repo",
      configKey: "repos",
    },
  };

  const isGlobalAdmin = $derived(session.me?.role === "admin" || !session.me);

  let connections = $state<Connection[]>([]);
  let projects = $state<SourceProject[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let showForm = $state(false);
  let editingSlug = $state<string | null>(null);
  let form = $state({
    sourceType: "freshdesk" as SourceType,
    slug: "",
    host: "",
    token: "",
    groups: "",
    redaction: false,
  });
  let slugTouched = $state(false);

  /** Per-connection probe results — also the group vocabulary for the map form. */
  let probes = $state<Record<string, Probe>>({});
  let testing = $state<string | null>(null);

  const spec = $derived(SPEC[form.sourceType]);
  const configOf = (c: Connection) => (c.config ?? {}) as Record<string, unknown>;
  const redactionOn = (c: Connection) =>
    ((configOf(c).redaction as { enabled?: boolean } | undefined)?.enabled) === true;
  const groupsOf = (c: Connection): string[] => {
    const key = SPEC[c.source_type as SourceType]?.configKey;
    const v = key ? configOf(c)[key] : undefined;
    return Array.isArray(v) ? (v as string[]) : [];
  };

  const registered = $derived(
    new Set(projects.map((p) => `${p.source_slug} ${p.external_key}`)),
  );

  function hostToBaseUrl(type: SourceType, host: string): string {
    const v = host.trim().replace(/\/+$/, "");
    if (!v) return type === "github" ? "https://api.github.com" : "";
    if (type === "azure-devops")
      return /^https?:\/\//i.test(v) ? v : `https://dev.azure.com/${v}`;
    const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    return withScheme.replace(/\/api\/v2$/, "");
  }

  function baseUrlToHost(type: SourceType, baseUrl: string | null): string {
    const v = (baseUrl ?? "").replace(/\/+$/, "");
    if (type === "azure-devops") return v.replace(/^https?:\/\/dev\.azure\.com\//i, "");
    if (type === "freshdesk") return v.replace(/^https?:\/\//i, "");
    return v;
  }

  /** Derive a connection slug from the host, e.g. acme.freshdesk.com → acme-freshdesk. */
  function suggestSlug(type: SourceType, host: string): string {
    const raw = host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    const stem =
      type === "azure-devops"
        ? raw.replace(/^dev\.azure\.com\//i, "").split("/")[0]
        : raw.split("/")[0].split(".")[0];
    const base = stem.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!base) return "";
    return type === "freshdesk" ? `${base}-freshdesk` : type === "azure-devops" ? `${base}-ado` : base;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      [connections, projects] = await Promise.all([
        api.get<Connection[]>("/source-connections"),
        api.get<SourceProject[]>("/source-projects"),
      ]);
    } catch (e) {
      error = errText(e);
    } finally {
      loading = false;
    }
  }

  function openAdd() {
    editingSlug = null;
    slugTouched = false;
    form = { sourceType: "freshdesk", slug: "", host: "", token: "", groups: "", redaction: false };
    showForm = true;
  }

  function openEdit(c: Connection) {
    const type = c.source_type as SourceType;
    editingSlug = c.slug;
    slugTouched = true;
    form = {
      sourceType: type,
      slug: c.slug,
      host: baseUrlToHost(type, c.base_url),
      token: "",
      groups: groupsOf(c).join(", "),
      redaction: redactionOn(c),
    };
    showForm = true;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    error = null;
    try {
      // Merge, never replace: the connection's config also carries keys this
      // form knows nothing about (per-project work item defaults).
      const existing = editingSlug
        ? { ...configOf(connections.find((c) => c.slug === editingSlug)!) }
        : {};
      const config: Record<string, unknown> = existing;
      const key = spec.configKey;
      if (key) config[key] = csv(form.groups);
      if (form.redaction) config.redaction = { enabled: true };
      else delete config.redaction;
      await api.post("/source-connections", {
        sourceType: form.sourceType,
        slug: form.slug.trim(),
        baseUrl: hostToBaseUrl(form.sourceType, form.host),
        config,
        ...(form.token.trim() ? { token: form.token.trim() } : {}),
      });
      const saved = form.slug.trim();
      showForm = false;
      form.token = "";
      await load();
      await test(saved);
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function del(c: Connection) {
    error = null;
    try {
      await api.delete(`/source-connections/${c.slug}`);
      delete probes[c.slug];
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  async function test(slug: string) {
    testing = slug;
    try {
      probes[slug] = await api.post<Probe>(`/source-connections/${slug}/test`, {});
    } catch (e) {
      probes[slug] = { ok: false, error: errText(e) };
    } finally {
      testing = null;
    }
  }

  onMount(load);
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<h4>Connections</h4>
<table>
  <thead><tr>
    <th class="tip" title={TIP.slug}>slug</th>
    <th>type</th>
    <th>base URL</th>
    <th class="tip" title="API key / PAT for this connection, and which scope it came from. Personal keys are set in My settings.">token</th>
    <th class="tip" title="Redacts PII out of this source's payloads before the model sees them.">redaction</th>
    <th></th>
  </tr></thead>
  <tbody>
    {#each connections as r (r.id)}
      {@const probe = probes[r.slug]}
      <tr>
        <td>{r.slug}</td>
        <td>{SPEC[r.source_type as SourceType]?.label ?? r.source_type}</td>
        <td class="muted">{r.base_url ?? ""}</td>
        <td>
          <span class="badge" class:on={!!r.token_source}>{r.token_source ?? "unset"}</span>
        </td>
        <td>{redactionOn(r) ? "on" : "off"}</td>
        <td class="actions">
          <button class="mini" onclick={() => test(r.slug)} disabled={testing === r.slug}>
            {testing === r.slug ? "…" : "test"}
          </button>
          {#if isGlobalAdmin}
            <button class="icon-btn" title="edit" aria-label="edit" onclick={() => openEdit(r)}>✎</button>
            <DeleteButton onConfirm={() => del(r)} />
          {/if}
        </td>
      </tr>
      {#if probe}
        <tr class="probe-row">
          <td colspan="6">
            {#if !probe.ok}
              <span class="error">✕ {probe.error}</span>
            {:else}
              <span class="ok-text">✓ connected{probe.identity ? ` as ${probe.identity}` : ""}</span>
              {#if probe.groupsNote}
                <div class="muted note">
                  This token can't list {SPEC[r.source_type as SourceType]?.groupLabel ?? "group"}s
                  — fine for fetching, it just means you type the key in yourself when
                  registering the project.
                  <span class="reason">{probe.groupsNote}</span>
                </div>
              {/if}
              {#if probe.groups?.length}
                <div class="groups">
                  <span class="muted">
                    {SPEC[r.source_type as SourceType]?.groupLabel ?? "group"}s visible to this token —
                    highlighted ones are registered as projects; register the rest under
                    <strong>Org › projects</strong>:
                  </span>
                  <div class="chips">
                    {#each probe.groups as g (g.key)}
                      <span class="chip" class:mapped={registered.has(`${r.slug} ${g.key}`)}>{g.name}</span>
                    {/each}
                  </div>
                </div>
              {/if}
            {/if}
          </td>
        </tr>
      {/if}
    {/each}
    {#if !loading && connections.length === 0}
      <tr><td colspan="6" class="muted">No source connections yet.</td></tr>
    {/if}
  </tbody>
</table>

{#if isGlobalAdmin}
  <div class="add-area">
    {#if !showForm}
      <button onclick={openAdd}>+ add connection</button>
    {:else}
      <form class="conn-form" onsubmit={save}>
        <div class="add-form">
          <label>type
            <AsciiSelect value={form.sourceType} disabled={!!editingSlug}
              options={(Object.keys(SPEC) as SourceType[]).map((k) => ({ value: k, label: SPEC[k].label }))}
              onchange={(v) => {
                form.sourceType = v as SourceType;
                if (!slugTouched) form.slug = suggestSlug(form.sourceType, form.host);
              }} />
          </label>
          <label>{spec.hostLabel}
            <input class="host" bind:value={form.host} placeholder={spec.hostPlaceholder}
              required={form.sourceType !== "github"}
              oninput={() => { if (!slugTouched) form.slug = suggestSlug(form.sourceType, form.host); }} />
          </label>
          <label class="tip" title={TIP.slug}>slug
            <input bind:value={form.slug} placeholder="my-freshdesk" required
              pattern="[a-z0-9][a-z0-9\-]*" oninput={() => (slugTouched = true)}
              disabled={!!editingSlug} />
          </label>
        </div>
        <div class="add-form">
          <label class="tip" title={spec.tokenHint}>{spec.tokenLabel}
            <input class="token" type="password" bind:value={form.token} autocomplete="off"
              placeholder={editingSlug ? "(leave blank to keep the current one)" : "stored encrypted, global scope"} />
          </label>
          {#if spec.configKey}
            <label class="tip" title="Limits sync and gives the agent a default set to look in, instead of the whole org.">
              {spec.groupLabel}s
              <input class="groups-input" bind:value={form.groups} placeholder="comma-separated, optional" />
            </label>
          {/if}
          <label class="check">
            <input type="checkbox" bind:checked={form.redaction} /> redact PII
          </label>
          <button class="icon-btn ok" type="submit" title="save" aria-label="save" disabled={saving}>{saving ? "…" : "✓"}</button>
          <button class="icon-btn" type="button" title="cancel" aria-label="cancel" onclick={() => (showForm = false)}>↺</button>
        </div>
        <p class="muted hint">{spec.tokenHint}</p>
      </form>
    {/if}
  </div>
{/if}

<style>
  .conn-form { display: flex; flex-direction: column; gap: 0.5rem; }
  .conn-form .host { min-width: 18rem; }
  .conn-form .token { min-width: 16rem; }
  .conn-form .groups-input { min-width: 14rem; }
  /* The panel gives .add-form inputs a 9rem floor; a checkbox must opt out. */
  .check { display: flex; gap: 0.35rem; align-items: center; color: var(--muted); font-size: 0.85rem; }
  .conn-form .check input[type="checkbox"] { min-width: 0; width: 0.9rem; }
  .hint { font-size: 0.8rem; }
  /* Probe result hangs under its connection row rather than in a modal, so the
     discovered groups stay next to the connection they came from. */
  .probe-row td { border-bottom: 1px solid var(--border); padding-top: 0; font-size: 0.85rem; }
  .ok-text { color: var(--ok); }
  .groups { margin-top: 0.35rem; display: flex; flex-direction: column; gap: 0.3rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .chip { font-size: 0.75rem; padding: 0.1rem 0.5rem; }
  .chip.mapped { border-color: var(--accent); color: var(--accent); }
  .note { margin-top: 0.3rem; }
  .note .reason { opacity: 0.65; }
</style>
