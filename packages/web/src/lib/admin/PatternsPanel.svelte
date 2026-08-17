<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { Button, CrudTable, Note, G, type Column } from "../tui";
  import RenameSlugModal from "./RenameSlugModal.svelte";
  import type { Pattern } from "./shared";

  const patterns = createResource(
    () => api.get<Pattern[]>("/resolution-patterns"),
    [],
  );

  let renaming = $state<{ from: string; to: string } | null>(null);

  const columns: Column<Pattern>[] = [
    { key: "slug", label: "pattern", width: "18rem", edit: "text", required: true },
    { key: "description", label: "description", edit: "text" },
  ];

  onMount(patterns.reload);
</script>

<p class="lede">
  The controlled vocabulary the agent must choose from. Renaming one rewrites
  every entry that references it.
</p>

<CrudTable
  {columns}
  rows={patterns.data}
  rowKey={(r) => r.slug}
  loading={patterns.loading}
  error={patterns.error}
  emptyTitle="No resolution patterns yet."
  emptyDetail="Add the handful of shapes your fixes actually take."
  addLabel="add pattern"
  oncreate={(d) =>
    patterns.mutate(() =>
      api.post("/resolution-patterns", {
        slug: d.slug,
        description: d.description,
      }),
    )}
  onsave={(row, d) =>
    patterns.mutate(async () => {
      if (d.slug && d.slug !== row.slug) {
        renaming = { from: row.slug, to: String(d.slug) };
        return;
      }
      await api.patch(`/resolution-patterns/${row.slug}`, {
        description: d.description,
      });
    })}
  ondelete={(row) =>
    patterns.mutate(() => api.delete(`/resolution-patterns/${row.slug}`))}
/>

{#if renaming}
  {@const r = renaming}
  <RenameSlugModal
    resource={`/resolution-patterns/${r.from}`}
    to={r.to}
    onRenamed={async () => {
      renaming = null;
      await patterns.reload();
    }}
    onCancel={() => (renaming = null)}
    onError={(m) => {
      patterns.error = m;
      renaming = null;
    }}
  >
    {#snippet message(impact)}
      <p>
        Renaming <strong>{r.from}</strong> to <strong>{r.to}</strong> rewrites
        {impact.entries} knowledge {impact.entries === 1 ? "entry" : "entries"}.
      </p>
    {/snippet}
  </RenameSlugModal>
{/if}

<style>
  .lede {
    margin: 0 0 var(--pad-3);
    font-size: var(--fs-sm);
    color: var(--muted);
    max-width: 66ch;
  }
</style>
