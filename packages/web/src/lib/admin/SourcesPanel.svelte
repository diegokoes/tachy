<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { TIP, errText, type Connection, type ProductMap } from "./shared";

  let connections = $state<Connection[]>([]);
  let productMaps = $state<ProductMap[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let confirmDel = $state<string | null>(null); // map id

  const redactionOn = (c: Connection) =>
    ((c.config as { redaction?: { enabled?: boolean } } | null)?.redaction?.enabled) === true;

  async function load() {
    loading = true;
    error = null;
    try {
      connections = await api.get("/source-connections");
      productMaps = await api.get("/source-product-maps");
    } catch (e) {
      error = errText(e);
    } finally {
      loading = false;
    }
  }

  async function delMap(id: string) {
    if (confirmDel !== id) {
      confirmDel = id;
      return;
    }
    confirmDel = null;
    error = null;
    try {
      await api.delete(`/source-product-maps/${id}`);
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  onMount(load);
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<h4>Connections</h4>
<table>
  <thead><tr><th>slug</th><th>type</th><th>base URL</th><th>redaction</th></tr></thead>
  <tbody>
    {#each connections as r (r.id)}
      <tr>
        <td>{r.slug}</td><td>{r.source_type}</td><td class="muted">{r.base_url ?? ""}</td>
        <td>{redactionOn(r) ? "on" : "off"}</td>
      </tr>
    {/each}
    {#if !loading && connections.length === 0}<tr><td colspan="4" class="muted">No source connections yet.</td></tr>{/if}
  </tbody>
</table>

<h4>Group → product mapping</h4>
<table>
  <thead><tr><th>source</th><th class="tip" title={TIP.group}>external group</th><th>product</th><th></th></tr></thead>
  <tbody>
    {#each productMaps as r (r.id)}
      <tr>
        <td>{r.source_slug}</td><td>{r.external_group_key}</td><td>{r.product_name} ({r.product_slug})</td>
        <td><button class="mini danger-btn" onclick={() => delMap(r.id)}>{confirmDel === r.id ? "confirm?" : "del"}</button></td>
      </tr>
    {/each}
    {#if !loading && productMaps.length === 0}<tr><td colspan="4" class="muted">No mappings yet.</td></tr>{/if}
  </tbody>
</table>
<p class="muted hint">
  Connections need an API token in the environment (<code>FRESHDESK_TOKEN_&lt;SLUG&gt;</code> /
  <code>GITHUB_TOKEN_&lt;SLUG&gt;</code>), so add them via Chat or the MCP tools rather than here.
</p>
