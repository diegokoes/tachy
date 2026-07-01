<script lang="ts">
  import { api } from "./api";
  import type { NamedRow } from "./types";

  const tabs = [
    { key: "teams", label: "Teams", path: "/teams" },
    { key: "products", label: "Products", path: "/products" },
    { key: "customers", label: "Customers", path: "/customers" },
    { key: "resolution-patterns", label: "Resolution patterns", path: "/resolution-patterns" },
  ] as const;

  let active = $state<(typeof tabs)[number]["key"]>("teams");
  let rows = $state<NamedRow[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function load() {
    loading = true;
    error = null;
    const tab = tabs.find((t) => t.key === active)!;
    try {
      rows = await api.get<NamedRow[]>(tab.path);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void active;
    load();
  });
</script>

<div class="tabs">
  {#each tabs as t}
    <button class:active={active === t.key} onclick={() => (active = t.key)}>{t.label}</button>
  {/each}
</div>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<table>
  <thead><tr><th>slug</th><th>name</th><th>detail</th></tr></thead>
  <tbody>
    {#each rows as r}
      <tr>
        <td>{r.slug ?? r.id ?? ""}</td>
        <td>{r.name ?? ""}</td>
        <td class="muted">
          {r.description ?? ""}
          {#if r.aliases && r.aliases.length}<em>aliases: {r.aliases.join(", ")}</em>{/if}
        </td>
      </tr>
    {/each}
    {#if !loading && rows.length === 0}<tr><td colspan="3" class="muted">None.</td></tr>{/if}
  </tbody>
</table>

<style>
  .tabs { display: flex; gap: 0.4rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .tabs button.active { border-color: var(--accent); color: var(--accent); }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; }
  .muted { color: var(--muted); }
  em { color: var(--muted); font-style: italic; margin-left: 0.4rem; }
  .error { color: #f85149; }
</style>
