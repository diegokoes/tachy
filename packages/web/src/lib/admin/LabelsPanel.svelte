<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { t } from "../terms";
  import { CrudTable, type Column } from "../tui";
  import { slugify } from "../slug";
  import ScopeBar from "./ScopeBar.svelte";
  import SlugRename from "./SlugRename.svelte";
  import { INFO, TIP, type Label, type Product } from "./shared";

  let product = $state("");
  let renaming = $state<Label | null>(null);

  const products = createResource(() => api.get<Product[]>("/products"), []);
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
      hint: TIP.slug,
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
  });
</script>

<ScopeBar
  label={t("product")}
  bind:value={product}
  options={products.data.map((p) => ({ value: p.slug, label: p.name }))}
/>

{#if product}
  <CrudTable
    {columns}
    rows={labels.data}
    rowKey={(r) => r.slug}
    loading={labels.loading}
    error={labels.error}
    emptyTitle="No labels for this {t('product')} yet."
    addLabel="add label"
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
