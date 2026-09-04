<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { CrudTable, type Column } from "../tui";
  import { slugify } from "../slug";
  import SlugRename from "./SlugRename.svelte";
  import { INFO, type Pattern } from "./shared";
  import { claimTopAction } from "./topAction.svelte";

  const patterns = createResource(
    () => api.get<Pattern[]>("/resolution-patterns"),
    [],
  );

  let renaming = $state<Pattern | null>(null);

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

  onMount(patterns.reload);</script>

<CrudTable
  hoist={claimTopAction}
  {columns}
  rows={patterns.data}
  rowKey={(r) => r.slug}
  loading={patterns.loading}
  error={patterns.error}
  emptyTitle="No resolution patterns yet."
  addLabel="add pattern"
  editTitle={(r) => r.slug}
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
  {@const r = renaming}
  <SlugRename
    title={`rename ${r.slug}`}
    current={r.slug}
    taken={patterns.data.map((p) => p.slug)}
    impact={`/resolution-patterns/${r.slug}`}
    onRename={(to) => api.post(`/resolution-patterns/${r.slug}/rename`, { to })}
    onDone={async () => {
      renaming = null;
      await patterns.reload();
    }}
    onCancel={() => (renaming = null)}
  >
    {#snippet message(impact, to)}
      <p>
        Renaming <strong>{r.slug}</strong> to <strong>{to}</strong> rewrites
        {impact.entries} knowledge {impact.entries === 1 ? "entry" : "entries"}.
      </p>
    {/snippet}
  </SlugRename>
{/if}
