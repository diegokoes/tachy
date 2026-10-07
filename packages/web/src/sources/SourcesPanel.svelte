<script lang="ts" module>
  type Probe = {
    ok: boolean;
    error?: string;
    identity?: string;
    groups?: { key: string; name: string }[];
    groupsNote?: string;
  };

  // Outlives the panel: saving a new connection tests it and then opens its
  // page, which is a fresh mount, and the result has to be there when it lands.
  let probes = $state<Record<string, Probe>>({});
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { session } from "../access/session.svelte";
  import { createResource, errText } from "../resource.svelte";
  import { slugify, uniqueSlug } from "../slug";
  import {
    Badge,
    Button,
    Chip,
    CrudTable,
    Field,
    Icon,
    Modal,
    Note,
    Select,
    Subject,
    type Column,
    type Draft,
  } from "../tui";
  import { canCurateScope } from "../access/session.svelte";
  import { t } from "../terms";
  import type { Connection, SourceProject } from "./rows";
  import type { Product, Team } from "../catalog/rows";
  import { INFO } from "../admin/help";
  import { csv } from "../tui/fields";
  import { sectionHoist } from "../admin/sectionAction.svelte";

  type SourceType = "freshdesk" | "azure-devops" | "github";

  const SPEC: Record<
    SourceType,
    {
      label: string;
      hostLabel: string;
      hostShape: string;
      tokenLabel: string;
      tokenInfo: string;
      groupLabel: string;
      configKey: "projects" | "repos" | null;
    }
  > = {
    freshdesk: {
      label: "Freshdesk",
      hostLabel: "domain",
      hostShape: "the subdomain and freshdesk.com, not a full URL",
      tokenLabel: "API key",
      tokenInfo:
        "Profile › API key. Per agent: reads with that agent's permissions.",
      groupLabel: "group",
      configKey: null,
    },
    "azure-devops": {
      label: "Azure DevOps",
      hostLabel: "organization",
      hostShape: "the organization on its own, or a dev.azure.com URL",
      tokenLabel: "PAT",
      tokenInfo:
        "Org-scoped PAT. Scopes: Work Items read (write to create), Wiki read, Code read.",
      groupLabel: "project",
      configKey: "projects",
    },
    github: {
      label: "GitHub",
      hostLabel: "API base URL",
      hostShape: "https://api.github.com, or an Enterprise /api/v3 URL",
      tokenLabel: "token",
      tokenInfo: "PAT with repo and issues read.",
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

  let testing = $state<string | null>(null);

  // Registering from the probe list, where the projects are listed. Without it
  // the discovered names are inert text, and acting on one means retyping its
  // key in another panel.
  let claim = $state<{
    slug: string;
    key: string;
    name: string;
    /** "" registers it without a product: a ticket target for `team` only. */
    product: string;
    team: string;
  } | null>(null);
  let claiming = $state(false);
  let claimError = $state<string | null>(null);

  const myProducts = $derived(
    products.data.filter((p) => canCurateScope({ team_slug: p.team_slug })),
  );
  const myTeams = $derived(
    teams.data.filter((tm) => canCurateScope({ team_slug: tm.slug })),
  );
  const productOptions = $derived([
    { value: "", label: "none" },
    ...myProducts.map((p) => ({ value: p.slug, label: p.name })),
  ]);
  const teamOptions = $derived(
    myTeams.map((tm) => ({ value: tm.slug, label: tm.name })),
  );
  const claimReady = $derived(!!claim && !!(claim.product || claim.team));

  const projectFor = (slug: string, key: string) =>
    projects.data.find((p) => p.source_slug === slug && p.external_key === key);

  function openClaim(slug: string, group: { key: string; name: string }) {
    claimError = null;
    claim = {
      slug,
      key: group.key,
      name: group.name,
      product: myProducts[0]?.slug ?? "",
      team: myTeams[0]?.slug ?? "",
    };
  }

  async function saveClaim() {
    if (!claim || !claimReady) return;
    claiming = true;
    claimError = null;
    try {
      await api.post("/source-projects", {
        source_slug: claim.slug,
        external_key: claim.key,
        name: claim.name,
        ...(claim.product
          ? { product_slug: claim.product }
          : { team_slug: claim.team }),
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
  const groupsOf = (connection: Connection): string[] => {
    const key = SPEC[connection.source_type as SourceType]?.configKey;
    const listed = key ? configOf(connection)[key] : undefined;
    return Array.isArray(listed) ? (listed as string[]) : [];
  };

  const connectionOf = (d: Draft) =>
    connections.data.find((c) => c.slug === d.slug);
  const tokenSet = (d: Draft) => Boolean(connectionOf(d)?.token_source);

  const registered = $derived(
    new Set(projects.data.map((p) => `${p.source_slug} ${p.external_key}`)),
  );

  function hostToBaseUrl(type: SourceType, host: string): string {
    const trimmed = host.trim().replace(/\/+$/, "");
    if (!trimmed) return type === "github" ? "https://api.github.com" : "";
    if (type === "azure-devops") {
      const org = trimmed.replace(/^(https?:\/\/)?dev\.azure\.com\//i, "");
      if (/^https?:\/\//i.test(org)) return org;
      return org.includes(".")
        ? `https://${org}`
        : `https://dev.azure.com/${org}`;
    }
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return withScheme.replace(/\/api\/v2$/, "");
  }

  function baseUrlToHost(type: SourceType, baseUrl: string | null): string {
    const trimmed = (baseUrl ?? "").replace(/\/+$/, "");
    if (type === "azure-devops")
      return trimmed.replace(/^https?:\/\/dev\.azure\.com\//i, "");
    if (type === "freshdesk") return trimmed.replace(/^https?:\/\//i, "");
    return trimmed;
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
      cell: typeCell,
    },
    {
      key: "slug",
      // A connection has no name of its own; this is what people read it by.
      label: "name",
      width: "12rem",
      edit: "text",
      required: true,
      info: `${INFO.slug} Names the stored credential; immutable.`,
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
      info: (d) =>
        `${SPEC[typeOf(d)].hostLabel}: ${SPEC[typeOf(d)].hostShape}.`,
      value: (r) => baseUrlToHost(r.source_type as SourceType, r.base_url),
    },
    {
      key: "groups",
      label: "scope",
      formOnly: true,
      edit: "text",
      visible: (d) => Boolean(SPEC[typeOf(d)].configKey),
      info: (d) =>
        `Optional, comma-separated. Limits sync and default agent scope to these ${SPEC[typeOf(d)].groupLabel}s.`,
      value: (r) => groupsOf(r).join(", "),
    },
    {
      key: "token",
      label: "token",
      formOnly: true,
      edit: "secret",
      span: "half",
      info: (d) => SPEC[typeOf(d)].tokenInfo,
      placeholder: (d) => (tokenSet(d) ? "••••••••••••••••" : ""),
    },
    { key: "token_source", label: "token", width: "8rem", cell: tokenCell },
    {
      key: "redaction",
      label: "PII redaction",
      width: "8rem",
      edit: "checkbox",
      info: "Scrub PII from this source before the model.",
      value: (r) => redactionOn(r),
      cell: lockCell,
      span: "full",
      aside: formTest,
    },
    // Testing is per connection but reading the results is a sweep down the
    // list, so the action belongs on the row as well as in the dialog.
    { key: "probe", label: "", width: "7rem", align: "end", cell: testCell },
  ]);

  async function save(row: Connection | null, draft: Draft) {
    const type = typeOf(draft);
    // Merge, never replace: the connection's config also carries keys this
    // form knows nothing about (per-project work item defaults).
    const config: Record<string, unknown> = row ? { ...configOf(row) } : {};
    const key = SPEC[type].configKey;
    if (key) config[key] = csv(String(draft.groups ?? ""));
    if (draft.redaction) config.redaction = { enabled: true };
    else delete config.redaction;

    const slug = String(draft.slug).trim();
    await api.post("/source-connections", {
      sourceType: type,
      slug,
      baseUrl: hostToBaseUrl(type, String(draft.host ?? "")),
      config,
      ...(String(draft.token ?? "").trim()
        ? { token: String(draft.token).trim() }
        : {}),
    });
    await connections.reload();
    await test(slug);
  }

  /**
   * The result lands on the connection's own page, where the test is asked for.
   * `save` calls this too, so writing a connection's credentials shows at once
   * whether they work and what they can see.
   */
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
    }
  }

  onMount(() => {
    connections.reload();
    projects.reload();
    products.reload();
    teams.reload();
  });

  const probeTone = (c: Connection) =>
    probes[c.slug] === undefined
      ? undefined
      : probes[c.slug].ok
        ? ("ok" as const)
        : ("danger" as const);
</script>

{#snippet typeCell(connection: Connection)}
  {SPEC[connection.source_type as SourceType]?.label ?? connection.source_type}
{/snippet}

{#snippet lockCell(connection: Connection)}
  {@const on = redactionOn(connection)}
  <span class="lock" class:on>
    <Icon
      name={on ? "lockOn" : "lockOff"}
      size="1em"
      weight={7}
      label={on ? "redaction on" : "redaction off"}
    />
  </span>
{/snippet}

{#snippet tokenCell(connection: Connection)}
  <Badge tone={connection.token_source ? "ok" : "warn"}
    >{connection.token_source ?? "unset"}</Badge
  >
{/snippet}

{#snippet testButton(connection: Connection, size: "sm" | "md" = "sm")}
  <Button
    variant="ghost"
    {size}
    icon="test"
    tone={probeTone(connection)}
    aria-label="test connection"
    busy={testing === connection.slug}
    disabled={testing === connection.slug}
    onclick={() => test(connection.slug)}>test</Button
  >
{/snippet}

{#snippet testCell(connection: Connection)}
  {#if admin}{@render testButton(connection)}{/if}
{/snippet}

{#snippet probeRow(connection: Connection)}
  {@const probe = probes[connection.slug]}
  {#if probe && !probe.ok}
    <Note tone="danger">{probe.error ?? "failed"}</Note>
  {:else if probe}
    <p class="ok-text">
      ✓ connected{probe.identity ? ` as ${probe.identity}` : ""}
    </p>
    {#if probe.groupsNote}
      <Note tone="warn">
        Can't list {SPEC[connection.source_type as SourceType]?.groupLabel ??
          "group"}s. type the key in yourself when registering.
        <span class="reason">{probe.groupsNote}</span>
      </Note>
    {/if}
    {#if probe.groups?.length}
      <p class="dim">
        {SPEC[connection.source_type as SourceType]?.groupLabel ?? "group"}s
        this token can see. Click one to register it.
      </p>
      <div class="chips">
        {#each probe.groups as group (group.key)}
          {@const known = projectFor(connection.slug, group.key)}
          {#if known}
            <Chip tone={known.product_id ? "accent" : "muted"}>
              {group.name} · {known.product_slug ?? known.team_slug}
            </Chip>
          {:else}
            <Chip
              tone="default"
              onclick={admin
                ? () => openClaim(connection.slug, group)
                : undefined}>{group.name}</Chip
            >
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
{/snippet}

<!-- Pushed to the far end of the redaction row, clear of the checkbox, so it
     reads as acting on the whole connection rather than on that one field. -->
{#snippet formTest(form: { draft: Draft; mode: "create" | "edit" })}
  {@const connection =
    form.mode === "edit" ? connectionOf(form.draft) : undefined}
  {#if connection && admin}<span class="form-test"
      >{@render testButton(connection, "md")}</span
    >{/if}
{/snippet}

<!-- The probe belongs under the fields that produced it: saving a connection
     tests it, so the answer to "did that work" is already on screen. -->
{#snippet probeExtra(form: { mode: "create" | "edit"; row: Connection | null })}
  {#if form.row && probes[form.row.slug]}
    <div class="probe">{@render probeRow(form.row)}</div>
  {/if}
{/snippet}

<CrudTable
  hoist={sectionHoist("sources")}
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
  noun="connection"
  editTitle={(r) => r.slug}
  formExtra={probeExtra}
  oncreate={(d) => connections.mutate(() => save(null, d))}
  onsave={(row, d) => connections.mutate(() => save(row, d))}
  ondelete={(row) =>
    connections.mutate(async () => {
      await api.delete(`/source-connections/${row.slug}`);
      delete probes[row.slug];
    })}
/>

{#if claim}
  {@const open = claim}
  <Modal
    title={`register ${open.key}`}
    width="34rem"
    busy={claiming}
    disabled={!claimReady}
    confirmLabel="register"
    confirmIcon="create"
    onConfirm={saveClaim}
    onCancel={() => (claim = null)}
  >
    {#if claimError}<Note tone="danger">{claimError}</Note>{/if}
    <Subject verb="registering" name={open.key} />
    <div class="claim">
      <Field label="name" info="How it reads in lists here.">
        <input aria-label="name" bind:value={open.name} />
      </Field>
      <Field
        label={t("product")}
        info={`The ${t("product")} its items ingest into, which also lets it own wikis, repos and area rules. None makes it a ticket target only.`}
      >
        <Select
          value={open.product}
          aria-label={t("product")}
          options={productOptions}
          onchange={(v) => (open.product = String(v))}
        />
      </Field>
      {#if !open.product}
        <Field
          label={t("team")}
          required
          info={`The ${t("team")} whose members create work items here.`}
        >
          <Select
            value={open.team}
            aria-label={t("team")}
            options={teamOptions}
            onchange={(v) => (open.team = String(v))}
          />
        </Field>
        {#if !teamOptions.length}
          <Note tone="warn">
            You can't curate any {t("team")}s yet. Create one under Org first.
          </Note>
        {/if}
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
  /* Ruled off, because it is a reading about the record rather than another
     field of it. */
  .probe {
    margin-top: var(--pad-3);
    padding-top: var(--pad-3);
    border-top: 1px dashed var(--border);
  }
  .form-test {
    margin-left: auto;
  }
  .ok-text {
    margin: 0;
    color: var(--ok);
  }
  /* Locked is the safe state, so it wears the ok colour; open is a fact about
     this connection, not a fault, so it stays muted rather than red. */
  .lock {
    display: inline-flex;
    color: var(--muted);
  }
  .lock.on {
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
