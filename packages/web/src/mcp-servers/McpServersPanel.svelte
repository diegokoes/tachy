<script lang="ts">
  import { onMount } from "svelte";
  import {
    TOKEN_PLACEHOLDER,
    DIR_PLACEHOLDER,
    type McpServerRow,
  } from "@tachy/contract";
  import { api } from "../api";
  import { createResource, errText } from "../resource.svelte";
  import { t } from "../terms";
  import {
    Badge,
    Button,
    Checkbox,
    CrudTable,
    GroupHead,
    Icon,
    Note,
    Time,
    type Column,
  } from "../tui";
  import { slugify, uniqueSlug } from "../slug";
  import type { Team } from "../catalog/rows";
  import { sectionHoist } from "../admin/sectionAction.svelte";
  import { isGlobalAdmin } from "../access/session.svelte";
  import {
    formatCodes,
    formatFiles,
    formatLines,
    formatPairs,
    formatWindows,
    httpConfig,
    serverPayload,
    stdioConfig,
    uniqueToolPrefix,
    type Draft,
  } from "./form";
  import ToolsModal from "./ToolsModal.svelte";
  import PoolModal from "./PoolModal.svelte";

  type Listing = {
    servers: McpServerRow[];
    stdio_commands: string[];
    traffic: {
      slug: string;
      calls: number;
      rate_limited: number;
      auth_failures: number;
      budget_refused: number;
    }[];
  };

  type Probe =
    | {
        ok: true;
        server: { name: string; version: string } | null;
        tools: number;
      }
    | { ok: false; error: string };

  const listing = createResource(() => api.get<Listing>("/mcp-servers"), {
    servers: [],
    stdio_commands: [],
    traffic: [],
  });
  const teams = createResource(() => api.get<Team[]>("/teams"), []);

  const admin = isGlobalAdmin();
  const servers = $derived(listing.data.servers);
  const slugs = $derived(servers.map((server) => server.slug));
  const commandOptions = $derived(
    listing.data.stdio_commands.map((command) => ({
      value: command,
      label: command,
    })),
  );
  const trafficOf = (slug: string) =>
    listing.data.traffic.find((row) => row.slug === slug);

  let picked = $state<string[]>([]);
  let formError = $state<string | null>(null);
  let probes = $state<Record<string, Probe>>({});
  let testing = $state<string | null>(null);
  let toolsOf = $state<McpServerRow | null>(null);
  let poolOf = $state<McpServerRow | null>(null);

  const isHttp = (draft: Draft) => draft.transport !== "stdio";
  const TEMPLATE_INFO = `${TOKEN_PLACEHOLDER}: the token. ${DIR_PLACEHOLDER}: a private temp directory.`;

  const columns: Column<McpServerRow>[] = $derived([
    {
      key: "name",
      label: "server",
      width: "14rem",
      edit: "text",
      required: true,
      group: "server",
    },
    {
      key: "transport",
      label: "transport",
      width: "8rem",
      edit: "select",
      options: [
        { value: "http", label: "http" },
        { value: "stdio", label: "stdio" },
      ],
      initial: "http",
      group: "connection",
    },
    {
      key: "url",
      label: "url",
      formOnly: true,
      edit: "text",
      value: (row) => httpConfig(row)?.url ?? "",
      visible: isHttp,
      group: "connection",
    },
    {
      key: "headers",
      label: "headers",
      formOnly: true,
      edit: "textarea",
      info: `Name: value, one per line. ${TOKEN_PLACEHOLDER}: the token.`,
      initial: `Authorization: Bearer ${TOKEN_PLACEHOLDER}`,
      value: (row) => formatPairs(httpConfig(row)?.headers, ": "),
      visible: isHttp,
      group: "connection",
    },
    {
      key: "command",
      label: "command",
      formOnly: true,
      edit: "select",
      options: () => commandOptions,
      info: "Programs listed in TACHY_MCP_STDIO_COMMANDS.",
      value: (row) => stdioConfig(row)?.command ?? "",
      visible: (d) => !isHttp(d),
      group: "connection",
    },
    {
      key: "args",
      label: "arguments",
      formOnly: true,
      edit: "textarea",
      info: `One per line. ${TEMPLATE_INFO}`,
      value: (row) => formatLines(stdioConfig(row)?.args),
      visible: (d) => !isHttp(d),
      group: "connection",
    },
    {
      key: "env",
      label: "environment",
      formOnly: true,
      edit: "textarea",
      info: `NAME=value, one per line. ${TEMPLATE_INFO}`,
      value: (row) => formatPairs(stdioConfig(row)?.env, "="),
      visible: (d) => !isHttp(d),
      group: "connection",
    },
    {
      key: "files",
      label: "files",
      formOnly: true,
      edit: "textarea",
      info: `Each file starts with a '--- path' line. ${TEMPLATE_INFO}`,
      value: (row) => formatFiles(stdioConfig(row)?.files),
      visible: (d) => !isHttp(d),
      group: "connection",
    },
    {
      key: "credential_mode",
      label: "tokens",
      width: "7rem",
      edit: "select",
      options: [
        { value: "shared", label: "shared pool" },
        { value: "personal", label: "personal" },
      ],
      initial: "shared",
      info: "Shared: a pool kept here. Personal: each person's own, saved in Settings › Agent.",
      group: "access",
    },
    {
      key: "teams",
      label: t("teams"),
      value: (row) =>
        row.teams.map((team) => team.name).join(", ") || "everyone",
    },
    {
      key: "rate_windows",
      label: "rate budget",
      formOnly: true,
      edit: "text",
      info: "seconds/calls per token, comma-separated.",
      value: (row) => formatWindows(row.rate_windows),
      group: "limits",
    },
    {
      key: "rate_limit_codes",
      label: "rate-limit codes",
      formOnly: true,
      edit: "text",
      info: "JSON-RPC codes, comma-separated. HTTP 429 always counts.",
      value: (row) => formatCodes(row.rate_limit_codes),
      group: "limits",
    },
    {
      key: "result_max_chars",
      label: "answer limit (chars)",
      formOnly: true,
      edit: "text",
      initial: "60000",
      group: "limits",
    },
    {
      key: "call_timeout_ms",
      label: "timeout (ms)",
      formOnly: true,
      edit: "text",
      initial: "30000",
      group: "limits",
    },
    {
      key: "argument_bindings",
      label: `${t("customer")} bindings`,
      formOnly: true,
      edit: "textarea",
      info: `argument = fact kind, one per line. The agent passes a ${t("customer")}; the argument is filled from its fact.`,
      value: (row) => formatPairs(row.argument_bindings, " = "),
      group: "agent",
    },
    {
      key: "note",
      label: "note for the agent",
      formOnly: true,
      edit: "textarea",
      info: "Appended to every tool's description.",
      group: "agent",
    },
    {
      key: "redaction",
      label: "redaction",
      formOnly: true,
      edit: "checkbox",
      info: "Scrub emails, phone numbers and secrets from answers.",
      group: "agent",
    },
    {
      key: "enabled",
      label: "enabled",
      formOnly: true,
      edit: "checkbox",
      initial: true,
      group: "agent",
    },
    {
      key: "exposed",
      label: "tools",
      width: "6rem",
      align: "end",
      cell: toolsCell,
    },
    { key: "traffic", label: "14 days", width: "9rem", cell: trafficCell },
    { key: "test", label: "", width: "6rem", cell: testCell },
  ]);

  function openedForm(
    form: { mode: "create" | "edit"; row: McpServerRow | null } | null,
  ) {
    formError = null;
    picked = form?.row ? form.row.teams.map((team) => team.slug) : [];
  }

  async function save(draft: Draft, row: McpServerRow | null) {
    const slug =
      row?.slug ?? uniqueSlug(slugify(String(draft.name ?? "")), slugs);
    const toolPrefix =
      row?.tool_prefix ??
      uniqueToolPrefix(
        slug,
        servers.map((server) => server.tool_prefix),
      );
    let body;
    try {
      body = serverPayload(draft, { slug, toolPrefix }, picked);
    } catch (e) {
      formError = errText(e);
      throw e;
    }
    await listing.mutate(() => api.post("/mcp-servers", body));
    await test(body.slug);
  }

  async function test(slug: string) {
    testing = slug;
    try {
      probes[slug] = await api.post<Probe>(`/mcp-servers/${slug}/test`, {});
    } catch (e) {
      probes[slug] = { ok: false, error: errText(e) };
    } finally {
      testing = null;
    }
  }

  onMount(() => Promise.all([listing.reload(), teams.reload()]));
</script>

{#snippet toolsCell(server: McpServerRow)}
  <button class="link" type="button" onclick={() => (toolsOf = server)}>
    {server.exposed}/{server.tools}
  </button>
{/snippet}

{#snippet trafficCell(server: McpServerRow)}
  {@const traffic = trafficOf(server.slug)}
  {#if traffic?.calls || traffic?.budget_refused}
    <span>{traffic.calls}</span>
    {#if traffic.rate_limited}<Badge tone="warn"
        >{traffic.rate_limited} limited</Badge
      >{/if}
    {#if traffic.auth_failures}<Badge tone="danger"
        >{traffic.auth_failures} refused</Badge
      >{/if}
    {#if traffic.budget_refused}<Badge tone="warn"
        >{traffic.budget_refused} held</Badge
      >{/if}
  {:else}
    <span class="dim">-</span>
  {/if}
{/snippet}

{#snippet testCell(server: McpServerRow)}
  {#if admin}
    {@const probe = probes[server.slug]}
    <Button
      variant="ghost"
      size="sm"
      icon="test"
      tone={probe ? (probe.ok ? "ok" : "danger") : undefined}
      title={probe && !probe.ok ? probe.error : "connect and list its tools"}
      busy={testing === server.slug}
      disabled={testing === server.slug}
      onclick={() => test(server.slug)}>test</Button
    >
  {/if}
{/snippet}

{#snippet rowActions(server: McpServerRow)}
  <Button
    variant="ghost"
    size="sm"
    icon="tool"
    onclick={() => (toolsOf = server)}><span class="caps">tools</span></Button
  >
  {#if admin && server.credential_mode === "shared"}
    <Button
      variant="ghost"
      size="sm"
      icon="token"
      onclick={() => (poolOf = server)}><span class="caps">pool</span></Button
    >
  {/if}
{/snippet}

{#snippet formExtra({
  mode,
  row,
}: {
  mode: "create" | "edit";
  row: McpServerRow | null;
})}
  <div class="extra">
    <GroupHead label={t("teams")} />
    {#each teams.data as team (team.slug)}
      <label class="opt">
        <Checkbox
          checked={picked.includes(team.slug)}
          ariaLabel={team.name}
          onchange={(on) =>
            (picked = on
              ? [...picked, team.slug]
              : picked.filter((slug) => slug !== team.slug))}
        />
        <span>{team.name}</span>
      </label>
    {/each}
    <Note>None ticked: everyone.</Note>
    {#if mode === "edit" && row && probes[row.slug]}
      {@const probe = probes[row.slug]}
      {#if probe.ok}
        <p class="line ok">
          <Icon name="success" size="1em" />
          {probe.server?.name ?? "connected"}
          {probe.server?.version ?? ""}, {probe.tools} tools listed
        </p>
      {:else}
        <p class="line bad"><Icon name="error" size="1em" /> {probe.error}</p>
      {/if}
    {/if}
    {#if formError}
      <p class="line bad"><Icon name="error" size="1em" /> {formError}</p>
    {/if}
    {#if row?.tools_refreshed_at}
      <p class="line dim">tools listed <Time at={row.tools_refreshed_at} /></p>
    {/if}
  </div>
{/snippet}

<CrudTable
  hoist={sectionHoist("mcp-servers")}
  {columns}
  rows={servers}
  rowKey={(server) => server.slug}
  loading={listing.loading}
  error={listing.error ?? teams.error}
  emptyTitle="No MCP servers linked yet."
  emptyDetail="Its read-only tools join the agent's."
  addLabel="link server"
  noun="MCP server"
  width="48rem"
  editTitle={(server) => server.name}
  {formExtra}
  onform={openedForm}
  extraActions={rowActions}
  canEdit={isGlobalAdmin}
  canDelete={isGlobalAdmin}
  canCreate={admin}
  oncreate={(draft) => save(draft, null)}
  onsave={(row, draft) => save(draft, row)}
  ondelete={(row) =>
    listing.mutate(() => api.delete(`/mcp-servers/${row.slug}`))}
/>

{#if toolsOf}
  <ToolsModal
    server={toolsOf}
    canChange={admin}
    onclose={() => {
      toolsOf = null;
      listing.reload();
    }}
  />
{/if}

{#if poolOf}
  <PoolModal server={poolOf} onclose={() => (poolOf = null)} />
{/if}

<style>
  .extra {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .line {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin: 0;
  }
  .ok {
    color: var(--ok);
  }
  .bad {
    color: var(--danger);
  }
  .dim {
    color: var(--muted);
  }
  .caps {
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    text-decoration: underline dotted;
    cursor: pointer;
  }
</style>
