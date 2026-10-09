<script lang="ts">
  import { onMount } from "svelte";
  import { keep, recall } from "../shell/kept";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { CrudTable, FilterBar, type Column } from "../tui";
  import { slugify } from "../slug";
  import SlugRename from "./SlugRename.svelte";
  import type { Pattern } from "./rows";
  import { INFO } from "../admin/help";
  import { sectionHoist } from "../admin/sectionAction.svelte";
  import { isCurator } from "../access/session.svelte";

  const patterns = createResource(
    () => api.get<Pattern[]>("/resolution-patterns"),
    [],
  );

  let renaming = $state<Pattern | null>(null);
  let filter = $state(recall("admin.patterns.filter", ""));
  $effect(() => keep("admin.patterns.filter", filter));

  const shown = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return patterns.data;
    return patterns.data.filter((p) =>
      `${p.slug} ${p.description ?? ""}`.toLowerCase().includes(needle),
    );
  });

  const columns: Column<Pattern>[] = [
    {
      key: "slug",
      label: "pattern",
      width: "18rem",
      edit: "text",
      required: true,
      info: INFO.slug,
      transform: slugify,
      editable: () => false,
      action: { label: "rename…", onclick: (r) => (renaming = r) },
    },
    {
      key: "description",
      label: "description",
      edit: "textarea",
      required: true,
    },
  ];

  onMount(patterns.reload);
</script>

<FilterBar
  bind:value={filter}
  shown={shown.length}
  total={patterns.data.length}
  label="filter resolution patterns"
/>

<CrudTable
  hoist={sectionHoist("patterns")}
  {columns}
  rows={shown}
  rowKey={(r) => r.slug}
  loading={patterns.loading}
  error={patterns.error}
  emptyTitle="No resolution patterns yet."
  addLabel="add pattern"
  noun="pattern"
  editTitle={(r) => r.slug}
  canEdit={isCurator}
  canDelete={isCurator}
  canCreate={isCurator()}
  oncreate={(d) =>
    patterns.mutate(() =>
      api.post("/resolution-patterns", {
        slug: d.slug,
        description: d.description,
      }),
    )}
  onsave={(row, d) =>
    patterns.mutate(() =>
      api.patch(`/resolution-patterns/${row.slug}`, {
        description: d.description,
      }),
    )}
  ondelete={(row) =>
    patterns.mutate(() => api.delete(`/resolution-patterns/${row.slug}`))}
/>

{#if renaming}
  {@const target = renaming}
  <SlugRename
    title={`rename ${target.slug}`}
    current={target.slug}
    taken={patterns.data.map((p) => p.slug)}
    impact={`/resolution-patterns/${target.slug}`}
    onRename={(to) =>
      api.post(`/resolution-patterns/${target.slug}/rename`, { to })}
    onDone={async () => {
      renaming = null;
      await patterns.reload();
    }}
    onCancel={() => (renaming = null)}
  >
    {#snippet message(impact, to)}
      <p>
        Renaming <strong>{target.slug}</strong> to <strong>{to}</strong>
        rewrites
        {impact.entries} knowledge {impact.entries === 1 ? "entry" : "entries"}.
      </p>
    {/snippet}
  </SlugRename>
{/if}
