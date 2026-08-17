<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { t } from "../terms";
  import { CrudTable, Select, type Column } from "../tui";
  import RenameSlugModal from "./RenameSlugModal.svelte";
  import type { Label, Product } from "./shared";

  let product = $state("");
  let renaming = $state<{ from: string; to: string } | null>(null);

  const products = createResource(() => api.get<Product[]>("/products"), []);
  const labels = createResource(
    () =>
      product
        ? api.get<Label[]>(`/products/${product}/labels`)
        : Promise.resolve([]),
    [],
  );

  const columns: Column<Label>[] = [
    { key: "slug", label: "label", width: "16rem", edit: "text", required: true },
    { key: "description", label: "description", edit: "text" },
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

<div class="scope">
  <span class="k">{t("product")}</span>
  <Select
    bind:value={product}
    options={products.data.map((p) => ({ value: p.slug, label: p.name }))}
    aria-label={t("product")}
  />
  <span class="hint">Tags stay free-form; this is the advisory vocabulary.</span>
</div>

{#if product}
  <CrudTable
    {columns}
    rows={labels.data}
    rowKey={(r) => r.slug}
    loading={labels.loading}
    error={labels.error}
    emptyTitle="No labels for this {t('product')} yet."
    addLabel="add label"
    oncreate={(d) =>
      labels.mutate(() =>
        api.post(`/products/${product}/labels`, {
          slug: d.slug,
          description: d.description,
        }),
      )}
    onsave={(row, d) =>
      labels.mutate(async () => {
        if (d.slug && d.slug !== row.slug) {
          renaming = { from: row.slug, to: String(d.slug) };
          return;
        }
        await api.patch(`/products/${product}/labels/${row.slug}`, {
          description: d.description,
        });
      })}
    ondelete={(row) =>
      labels.mutate(() =>
        api.delete(`/products/${product}/labels/${row.slug}`),
      )}
  />
{/if}

{#if renaming}
  {@const r = renaming}
  <RenameSlugModal
    resource={`/products/${product}/labels/${r.from}`}
    to={r.to}
    onRenamed={async () => {
      renaming = null;
      await labels.reload();
    }}
    onCancel={() => (renaming = null)}
    onError={(m) => {
      labels.error = m;
      renaming = null;
    }}
  >
    {#snippet message(impact)}
      <p>
        Renaming <strong>{r.from}</strong> to <strong>{r.to}</strong> rewrites
        {impact.entries} entries{#if impact.docs != null}
          and {impact.docs} docs{/if}.
      </p>
    {/snippet}
  </RenameSlugModal>
{/if}

<style>
  .scope {
    display: flex;
    align-items: center;
    gap: var(--gap);
    flex-wrap: wrap;
    margin-bottom: var(--pad-3);
  }
  .k {
    font-size: var(--fs-sm);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
  }
  .hint {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
