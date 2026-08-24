<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { session } from "../session.svelte";
  import { createResource, errText } from "../resource.svelte";
  import { slugify, uniqueSlug } from "../slug";
  import {
    Badge,
    Button,
    Chip,
    CrudTable,
    ErrorMark,
    Field,
    Modal,
    Note,
    Select,
    type Column,
    type Draft,
  } from "../tui";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import {
    INFO,
    csv,
    type Connection,
    type Product,
    type SourceProject,
    type Team,
  } from "./shared";

  type SourceType = "freshdesk" | "azure-devops" | "github";
  type Probe = {
    ok: boolean;
    error?: string;
    identity?: string;
    groups?: { key: string; name: string }[];
    groupsNote?: string;
  };

  const SPEC: Record<
    SourceType,
    {
      label: string;
      hostLabel: string;
      hostHint: string;
      tokenLabel: string;
      tokenHint: string;
      tokenInfo?: string;
      groupLabel: string;
      configKey: "projects" | "repos" | null;
    }
  > = {
    freshdesk: {
      label: "Freshdesk",
      hostLabel: "domain",
      hostHint: "acme.freshdesk.com",
      tokenLabel: "API key",
      tokenHint: "profile → API key",
      tokenInfo:
        "A per-agent key: tickets are read with that agent's permissions.",
      groupLabel: "group",
      configKey: null,
    },
    "azure-devops": {
      label: "Azure DevOps",
      hostLabel: "organization",
      hostHint: "my-org, or a dev.azure.com URL",
      tokenLabel: "PAT",
      tokenHint: "org-scoped personal access token",
      tokenInfo:
        "Reaches every project you have permissions on. Scopes: Work Items (read, or read & write to create tickets), Wiki read, Code read.",
      groupLabel: "project",
      configKey: "projects",
    },
    github: {
      label: "GitHub",
      hostLabel: "API base URL",
      hostHint: "https://api.github.com, or an Enterprise /api/v3 URL",
      tokenLabel: "token",
      tokenHint: "PAT with repo/issues read",
      groupLabel: "repo",
      configKey: "repos",
    },
  };

  const typeOf = (d: Draft) => (d.source_type ?? "freshdesk") as SourceType;

  const admin = $derived(session.me?.role === "admin" || !session.me);

  const connections = createResource(
    () => api.get<Connection[]>("/source-connections"),
    [],
  );
  const projects = createResource(
    () => api.get<SourceProject[]>("/source-projects"),
    [],
  );
  const products = createResource(() => api.get<Product[]>("/products"), []);
  const teams = createResource(() => api.get<Team[]>("/teams"), []);

  let probes = $state<Record<string, Probe>>({});
  let testing = $state<string | null>(null);
  let expanded = $state(new Set<string>());

  /* Registering from the probe list, where the projects are actually in front
     of you. Without this the discovered names are inert text and the only way
     to act on one is to retype its key in another panel. */
  let claim = $state<{
    slug: string;
    key: string;
    name: string;
    role: "knowledge" | "tracker";
    scope: string;
  } | null>(null);
  let claiming = $state(false);
  let claimError = $state<string | null>(null);

  const myProducts = $derived(
    products.data.filter((p) => canCurateScope({ team_slug: p.team_slug })),
  );
  const myTeams = $derived(
    teams.data.filter((tm) => canCurateScope({ team_slug: tm.slug })),
  );
  const scopeOptions = $derived(
    claim?.role === "tracker"
      ? myTeams.map((tm) => ({ value: tm.slug, label: tm.name }))
      : myProducts.map((p) => ({ value: p.slug, label: p.name })),
  );

  const projectFor = (slug: string, key: string) =>
    projects.data.find((p) => p.source_slug === slug && p.external_key === key);

  function openClaim(slug: string, g: { key: string; name: string }) {
    claimError = null;
    claim = {
      slug,
      key: g.key,
      name: g.name,
      role: "knowledge",
      scope: myProducts[0]?.slug ?? "",
    };
  }

  /* The scope means a different thing per role, so switching role must not
     carry the previous answer over — a product slug sent as a team_slug is
     rejected by the server with an error the user cannot act on. */
  function setRole(role: "knowledge" | "tracker") {
    if (!claim) return;
    claim = {
      ...claim,
      role,
      scope: (role === "tracker" ? myTeams[0]?.slug : myProducts[0]?.slug) ?? "",
    };
  }

  async function saveClaim() {
    if (!claim || !claim.scope) return;
    claiming = true;
    claimError = null;
    try {
      await api.post("/source-projects", {
        source_slug: claim.slug,
        external_key: claim.key,
        name: claim.name,
        role: claim.role,
        ...(claim.role === "knowledge"
          ? { product_slug: claim.scope }
          : { team_slug: claim.scope }),
      });
      await projects.reload();
      claim = null;
    } catch (e) {
      claimError = errText(e);
    } finally {
      claiming = false;
    }
  }

  const configOf = (c: Connection) =>
    (c.config ?? {}) as Record<string, unknown>;
  const redactionOn = (c: Connection) =>
    (configOf(c).redaction as { enabled?: boolean } | undefined)?.enabled ===
    true;
  const groupsOf = (c: Connection): string[] => {
    const key = SPEC[c.source_type as SourceType]?.configKey;
    const v = key ? configOf(c)[key] : undefined;
    return Array.isArray(v) ? (v as string[]) : [];
  };

  const registered = $derived(
    new Set(projects.data.map((p) => `${p.source_slug} ${p.external_key}`)),
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
    if (type === "azure-devops")
      return v.replace(/^https?:\/\/dev\.azure\.com\//i, "");
    if (type === "freshdesk") return v.replace(/^https?:\/\//i, "");
    return v;
  }

  /** acme.freshdesk.com → acme-freshdesk: the slug names the connection, not the host. */
  function suggestSlug(type: SourceType, host: string): string {
    const raw = host
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "");
    const stem =
      type === "azure-devops"
        ? raw.replace(/^dev\.azure\.com\//i, "").split("/")[0]
        : raw.split("/")[0].split(".")[0];
    const base = slugify(stem);
    if (!base) return "";
    return type === "freshdesk"
      ? `${base}-freshdesk`
      : type === "azure-devops"
        ? `${base}-ado`
        : base;
  }

  const columns: Column<Connection>[] = $derived([
    {
      key: "source_type",
      label: "type",
      width: "10rem",
      edit: "select",
      required: true,
      initial: "freshdesk",
      editable: () => false,
      options: (Object.keys(SPEC) as SourceType[]).map((k) => ({
        value: k,
        label: SPEC[k].label,
      })),
      value: (r) => SPEC[r.source_type as SourceType]?.label ?? r.source_type,
    },
    {
      key: "slug",
      label: "slug",
      width: "12rem",
      edit: "text",
      required: true,
      hint: "machine id — cannot change later",
      info: `${INFO.slug} It also names this connection's stored credential, so it cannot change later.`,
      derive: (d) =>
        uniqueSlug(
          suggestSlug(typeOf(d), String(d.host ?? "")),
          connections.data.map((c) => c.slug),
        ),
    },
    {
      key: "host",
      label: "host",
      edit: "text",
      required: true,
      hint: (d) => `${SPEC[typeOf(d)].hostLabel} — ${SPEC[typeOf(d)].hostHint}`,
      value: (r) => baseUrlToHost(r.source_type as SourceType, r.base_url),
    },
    {
      key: "token",
      label: "token",
      formOnly: true,
      edit: "secret",
      hint: (d) => SPEC[typeOf(d)].tokenHint,
      info: (d) => SPEC[typeOf(d)].tokenInfo ?? "",
    },
    { key: "token_source", label: "token", width: "8rem", cell: tokenCell },
    {
      key: "groups",
      label: "scope",
      formOnly: true,
      edit: "text",
      visible: (d) => Boolean(SPEC[typeOf(d)].configKey),
      hint: (d) => `${SPEC[typeOf(d)].groupLabel}s, comma-separated; optional`,
      info: (d) =>
        `Limits sync and gives the agent a default set of ${SPEC[typeOf(d)].groupLabel}s to look in instead of the whole org.`,
      value: (r) => groupsOf(r).join(", "),
    },
    {
      key: "redaction",
      label: "PII redaction",
      width: "8rem",
      edit: "checkbox",
      info: "Strips PII out of this source's payloads before the model sees them.",
      value: (r) => (redactionOn(r) ? "on" : "off"),
    },
  ]);

  async function save(row: Connection | null, d: Draft) {
    const type = typeOf(d);
    // Merge, never replace: the connection's config also carries keys this
    // form knows nothing about (per-project work item defaults).
    const config: Record<string, unknown> = row ? { ...configOf(row) } : {};
    const key = SPEC[type].configKey;
    if (key) config[key] = csv(String(d.groups ?? ""));
    if (d.redaction) config.redaction = { enabled: true };
    else delete config.redaction;

    const slug = String(d.slug).trim();
    await api.post("/source-connections", {
      sourceType: type,
      slug,
      baseUrl: hostToBaseUrl(type, String(d.host ?? "")),
      config,
      ...(String(d.token ?? "").trim()
        ? { token: String(d.token).trim() }
        : {}),
    });
    await connections.reload();
    await test(slug);
  }

  async function test(slug: string) {
    testing = slug;
    try {
      probes[slug] = await api.post<Probe>(
        `/source-connections/${slug}/test`,
        {},
      );
    } catch (e) {
      probes[slug] = { ok: false, error: errText(e) };
    } finally {
      testing = null;
      expanded = new Set([...expanded, slug]);
    }
  }

  onMount(() => {
    connections.reload();
    projects.reload();
    products.reload();
    teams.reload();
  });
</script>

{#snippet tokenCell(r: Connection)}
  <Badge tone={r.token_source ? "ok" : "warn"}>{r.token_source ?? "unset"}</Badge
  >
{/snippet}

{#snippet probeRow(r: Connection)}
  {@const probe = probes[r.slug]}
  {#if !probe}
    <p class="dim">Not tested yet — hit the probe icon on this row.</p>
  {:else if !probe.ok}
    <ErrorMark message={probe.error ?? "failed"} label="connection test" />
  {:else}
    <p class="ok-text">
      ✓ connected{probe.identity ? ` as ${probe.identity}` : ""}
    </p>
    {#if probe.groupsNote}
      <Note tone="warn">
        Can't list {SPEC[r.source_type as SourceType]?.groupLabel ?? "group"}s —
        type the key in yourself when registering.
        <span class="reason">{probe.groupsNote}</span>
      </Note>
    {/if}
    {#if probe.groups?.length}
      <p class="dim">
        {SPEC[r.source_type as SourceType]?.groupLabel ?? "group"}s this token
        can see — click one to register it.
      </p>
      <div class="chips">
        {#each probe.groups as g (g.key)}
          {@const known = projectFor(r.slug, g.key)}
          {#if known}
            <Chip tone={known.role === "knowledge" ? "accent" : "muted"}>
              {g.name} · {known.role}
            </Chip>
          {:else}
            <Chip
              tone="default"
              onclick={admin ? () => openClaim(r.slug, g) : undefined}
              >{g.name}</Chip
            >
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
{/snippet}

{#snippet testAction(r: Connection)}
  <Button
    variant="ghost"
    square
    icon="test"
    title="test connection"
    aria-label="test connection"
    busy={testing === r.slug}
    onclick={() => test(r.slug)}
  />
{/snippet}

<CrudTable
  {columns}
  rows={connections.data}
  rowKey={(r) => r.slug}
  loading={connections.loading}
  error={connections.error}
  emptyTitle="No source connections yet."
  canEdit={() => admin}
  canDelete={() => admin}
  canCreate={admin}
  addLabel="add connection"
  editTitle={(r) => r.slug}
  expand={probeRow}
  {expanded}
  ontoggle={(k) => {
    const next = new Set(expanded);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    expanded = next;
  }}
  extraActions={testAction}
  oncreate={(d) => connections.mutate(() => save(null, d))}
  onsave={(row, d) => connections.mutate(() => save(row, d))}
  ondelete={(row) =>
    connections.mutate(async () => {
      await api.delete(`/source-connections/${row.slug}`);
      delete probes[row.slug];
    })}
/>

{#if claim}
  {@const c = claim}
  <Modal
    title={`register ${c.key}`}
    width="34rem"
    busy={claiming}
    confirmLabel="register"
    confirmIcon="save"
    onConfirm={saveClaim}
    onCancel={() => (claim = null)}
  >
    {#if claimError}<Note tone="danger">{claimError}</Note>{/if}
    <div class="claim">
      <Field label="name" hint="how it reads in lists here">
        <input aria-label="name" bind:value={c.name} />
      </Field>
      <Field
        label="role"
        required
        hint={c.role === "tracker" ? "create/reassign target" : "items ingest here"}
        info={c.role === "tracker"
          ? "Nothing is filed under a tracker, and it holds no wiki, repos or area rules."
          : `Its items ingest into a ${t("product")}, and it can carry the wikis, repos and area rules.`}
      >
        <Select
          value={c.role}
          aria-label="role"
          options={[
            { value: "knowledge", label: "knowledge" },
            { value: "tracker", label: "tracker" },
          ]}
          onchange={(v) => setRole(v as "knowledge" | "tracker")}
        />
      </Field>
      <Field
        label={c.role === "tracker" ? t("team") : t("product")}
        required
        hint={c.role === "tracker"
          ? `the ${t("team")} raising work items here`
          : `the ${t("product")} its items ingest into`}
      >
        <Select
          value={c.scope}
          aria-label="scope"
          options={scopeOptions}
          onchange={(v) => (c.scope = String(v))}
        />
      </Field>
      {#if !scopeOptions.length}
        <Note tone="warn">
          You can't curate any {c.role === "tracker"
            ? `${t("team")}s`
            : `${t("product")}s`} yet — create one under Org first.
        </Note>
      {/if}
    </div>
  </Modal>
{/if}

<style>
  .claim {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    min-width: 22rem;
  }
  .ok-text {
    margin: 0;
    color: var(--ok);
  }
  .dim {
    margin: 0 0 var(--pad-2);
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
  }
  .reason {
    opacity: 0.65;
  }
</style>
