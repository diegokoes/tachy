<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { t } from "../terms";
  import { CrudTable, Note, Select, type Column } from "../tui";
  import { slugify } from "../slug";
  import SlugRename from "./SlugRename.svelte";
  import type { Label, Product } from "./rows";
import { INFO } from "./help";
  import { sectionHoist } from "./sectionAction.svelte";

  let team = $state("");
  let product = $state("");
  let renaming = $state<Label | null>(null);

  const products = createResource(() => api.get<Product[]>("/products"), []);

  const teamOptions = $derived(
    [...new Map(products.data.map((p) => [p.team_slug, p.team_name])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
  );
  const productOptions = $derived(
    products.data
      .filter((p) => !team || p.team_slug === team)
      .map((p) => ({ value: p.slug, label: p.name })),
  );
  const labels = createResource(
    () =>
      product
        ? api.get<Label[]>(`/products/${product}/labels`)
        : Promise.resolve([]),
    [],
  );

  /* A label has no display name of its own — the slug is what people read. */
  const columns: Column<Label>[] = [
    {
      key: "slug",
      label: "label",
      width: "16rem",
      edit: "text",
      required: true,
      info: INFO.slug,
      transform: slugify,
      editable: () => false,
      action: { label: "rename…", onclick: (r) => (renaming = r) },
    },
    { key: "description", label: "description", edit: "textarea" },
  ];

  onMount(async () => {
    await products.reload();
    product = products.data[0]?.slug ?? "";
  });

  $effect(() => {
    void product;
    labels.reload();
  });</script>

<!-- Team narrows the product list; the product itself is not optional,
     because a label only exists inside one. -->
<div class="bar">
  <Select
    bind:value={team}
    options={teamOptions}
    placeholder={`any ${t("team")}`}
    clearable
    searchable
    keepOpen
    active={!!team}
    aria-label={`filter by ${t("team")}`}
    onchange={() => {
      if (team && !productOptions.some((o) => o.value === product))
        product = productOptions[0]?.value ?? "";
    }}
  />
  <Select
    bind:value={product}
    options={productOptions}
    placeholder={`pick a ${t("product")}`}
    searchable
    aria-label={t("product")}
  />
</div>

{#if !product}
  <Note>Pick a {t("product")} to see its labels.</Note>
{:else}
  <CrudTable
  hoist={sectionHoist("labels")}
    {columns}
    rows={labels.data}
    rowKey={(r) => r.slug}
    loading={labels.loading}
    error={labels.error}
    emptyTitle="No labels for this {t('product')} yet."
    addLabel="add label"
    noun="label"
    editTitle={(r) => r.slug}
    oncreate={(d) =>
      labels.mutate(() =>
        api.post(`/products/${product}/labels`, {
          slug: d.slug,
          description: d.description,
        }),
      )}
    onsave={(row, d) =>
      labels.mutate(() =>
        api.patch(`/products/${product}/labels/${row.slug}`, {
          description: d.description,
        }),
      )}
    ondelete={(row) =>
      labels.mutate(() => api.delete(`/products/${product}/labels/${row.slug}`))}
  />
{/if}

{#if renaming}
  {@const r = renaming}
  <SlugRename
    title={`rename ${r.slug}`}
    current={r.slug}
    taken={labels.data.map((l) => l.slug)}
    impact={`/products/${product}/labels/${r.slug}`}
    onRename={(to) =>
      api.post(`/products/${product}/labels/${r.slug}/rename`, { to })}
    onDone={async () => {
      renaming = null;
      await labels.reload();
    }}
    onCancel={() => (renaming = null)}
  >
    {#snippet message(impact, to)}
      <p>
        Renaming <strong>{r.slug}</strong> to <strong>{to}</strong> rewrites
        {impact.entries} entries{#if impact.docs != null}
          and {impact.docs} docs{/if}.
      </p>
    {/snippet}
  </SlugRename>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    flex-wrap: wrap;
    margin-bottom: var(--pad-2);
  }
</style>
