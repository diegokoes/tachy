<script lang="ts">
  import { Button, DeleteButton, Select } from "../tui";
  import { agentPrefs, removeKey, saveKey } from "../settings/prefs.svelte";
  import Row from "../settings/Row.svelte";
  import Rows from "../settings/Rows.svelte";

  const servers = $derived(agentPrefs.creds?.mcp_servers ?? []);
  const mine = $derived(
    new Set(agentPrefs.creds?.mine.map((key) => key.name) ?? []),
  );
  const saved = $derived(
    servers.filter((server) => mine.has(server.credential)),
  );
  const options = $derived(
    servers.map((server) => ({
      value: server.slug,
      label: server.name,
      ...(mine.has(server.credential) ? { hint: "saved" } : {}),
    })),
  );

  let picked = $state<string | null>(null);
  let value = $state("");
  const firstMissing = $derived(
    servers.find((server) => !mine.has(server.credential)) ?? servers[0],
  );
  const target = $derived(
    servers.find((server) => server.slug === picked) ?? firstMissing,
  );

  async function save() {
    if (!target || !value.trim()) return;
    await saveKey(target.credential, value.trim());
    value = "";
    picked = null;
  }
</script>

<Rows>
  {#each saved as server (server.slug)}
    <Row label={server.name}>
      <DeleteButton
        label={`remove ${server.name} token`}
        onclick={() => removeKey(server.credential)}
      />
    </Row>
  {/each}
  <Row label="server">
    <Select
      aria-label="server"
      value={target?.slug ?? ""}
      {options}
      onchange={(slug) => (picked = String(slug))}
    />
  </Row>
  <Row label="token">
    <form class="field" onsubmit={(e) => (e.preventDefault(), save())}>
      <input
        type="password"
        autocomplete="off"
        aria-label={`${target?.name ?? "server"} token`}
        bind:value
      />
      {#if value.trim()}
        <span class="end">
          <Button
            type="submit"
            variant="ghost"
            square
            size="sm"
            tone="accent"
            icon="save"
            title="save"
            aria-label={`save ${target?.name ?? "server"} token`}
          />
        </span>
      {/if}
    </form>
  </Row>
</Rows>

<style>
  .field {
    position: relative;
    display: flex;
    align-items: center;
  }
  input {
    width: 100%;
    min-width: 0;
    padding-right: calc(var(--row-h) + var(--pad-1));
  }
  .end {
    position: absolute;
    right: 2px;
    display: flex;
    align-items: center;
  }
</style>
