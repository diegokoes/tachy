<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import { Chip, CrudTable, Select, type Column } from "../tui";
  import RenameSlugModal from "./RenameSlugModal.svelte";
  import { csv } from "./shared";
  import type { Component, Product, Repo } from "./shared";

  let productSlug = $state("");
  let renaming = $state<{ from: string; to: string } | null>(null);

  const products = createResource(() => api.get<Product[]>("/products"), []);
  const components = createResource(
    () =>
      productSlug
        ? api.get<Component[]>(`/products/${productSlug}/components`)
        : Promise.resolve([]),
    [],
  );
  const repos = createResource(
    () =>
      productSlug
        ? api
            .get<{ repos: Repo[] }>(`/repos?product_slug=${productSlug}`)
            .then((r) => r.repos)
        : Promise.resolve([]),
    [],
  );

  const parentSlug = (c: Component) =>
    components.data.find((p) => p.id === c.parent_id)?.slug ?? "";
  const reposOf = (c: Component) =>
    repos.data.filter((r) => r.component_id === c.id);

  const mayEdit = $derived(
    canCurateScope({
      team_slug:
        products.data.find((p) => p.slug === productSlug)?.team_slug ?? null,
    }),
  );

  const parentOptions = $derived([
    { value: "", label: "(top level)" },
    ...components.data.map((c) => ({ value: c.slug, label: c.slug })),
  ]);

  const columns: Column<Component>[] = $derived([
    { key: "slug", label: "component", width: "12rem", edit: "text", required: true },
    { key: "name", label: "name", width: "11rem", edit: "text", required: true },
    {
      key: "parent",
      label: "parent",
      width: "9rem",
      edit: "select",
      options: parentOptions,
      value: parentSlug,
    },
    {
      key: "aliases",
      label: "aliases",
      width: "9rem",
      edit: "text",
      placeholder: "comma,separated",
      value: (r) => (r.aliases ?? []).join(", "),
    },
    { key: "description", label: "description", edit: "text" },
    { key: "code", label: "code", width: "9rem", cell: codeCell },
  ]);

  onMount(async () => {
    await products.reload();
    productSlug = products.data[0]?.slug ?? "";
  });

  $effect(() => {
    void productSlug;
    components.reload();
    repos.reload();
  });
</script>

{#snippet codeCell(c: Component)}
  {@const rs = reposOf(c)}
  {#if rs.length}
    <span class="chips">
      {#each rs as r}
        <Chip tone={r.index_status === "ready" ? "default" : "warn"}
          title={`${r.slug} · ${r.index_status}`}>{r.slug}</Chip
        >
      {/each}
    </span>
  {:else}
    <span class="none">—</span>
  {/if}
{/snippet}

<div class="scope">
  <span class="k">{t("product")}</span>
  <Select
    bind:value={productSlug}
    options={products.data.map((p) => ({ value: p.slug, label: p.name }))}
    aria-label={t("product")}
  />
  <span class="hint">
    The architecture glossary the agent maps a ticket's area onto.
  </span>
</div>

{#if productSlug}
  <CrudTable
    {columns}
    rows={components.data}
    rowKey={(r) => r.slug}
    loading={components.loading}
    error={components.error}
    emptyTitle="No components for this {t('product')} yet."
    emptyDetail="Seed them from docs, or let ticket analysis propose them."
    canEdit={() => mayEdit}
    canDelete={() => mayEdit}
    canCreate={mayEdit}
    addLabel="add component"
    oncreate={(d) =>
      components.mutate(() =>
        api.post(`/products/${productSlug}/components`, {
          slug: d.slug,
          name: d.name,
          parentSlug: d.parent || undefined,
          description: d.description || undefined,
          aliases: csv(String(d.aliases ?? "")),
        }),
      )}
    onsave={(row, d) =>
      components.mutate(async () => {
        if (d.slug && d.slug !== row.slug) {
          renaming = { from: row.slug, to: String(d.slug) };
          return;
        }
        await api.patch(`/products/${productSlug}/components/${row.slug}`, {
          name: d.name,
          parentSlug: d.parent || null,
          description: d.description || null,
          aliases: csv(String(d.aliases ?? "")),
        });
      })}
    ondelete={(row) =>
      components.mutate(() =>
        api.delete(`/products/${productSlug}/components/${row.slug}`),
      )}
  />
{/if}

{#if renaming}
  {@const r = renaming}
  <RenameSlugModal
    resource={`/products/${productSlug}/components/${r.from}`}
    to={r.to}
    onRenamed={async () => {
      renaming = null;
      await components.reload();
    }}
    onCancel={() => (renaming = null)}
    onError={(m) => {
      components.error = m;
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
  .chips {
    display: flex;
    gap: var(--pad-1);
    flex-wrap: wrap;
  }
  .none {
    color: var(--muted);
  }
</style>
