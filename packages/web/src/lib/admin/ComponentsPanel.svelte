<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import { Chip, CrudTable, type Column } from "../tui";
  import { slugify, uniqueSlug } from "../slug";
  import SlugRename from "./SlugRename.svelte";
  import ScopeBar from "./ScopeBar.svelte";
  import { csv, INFO, EXAMPLE } from "./shared";
  import type { Component, Product, Repo } from "./shared";

  let productSlug = $state("");
  let renaming = $state<Component | null>(null);

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

  /** A component may not be re-parented under itself or anything beneath it. */
  function subtree(slug: string): Set<string> {
    const start = components.data.find((c) => c.slug === slug);
    if (!start) return new Set();
    const ids = new Set([start.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const c of components.data) {
        if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) {
          ids.add(c.id);
          grew = true;
        }
      }
    }
    return ids;
  }

  const columns: Column<Component>[] = $derived([
    { key: "name", label: "name", width: "13rem", edit: "text", required: true },
    {
      key: "slug",
      label: "component",
      width: "12rem",
      edit: "text",
      required: true,
      info: INFO.slug,
      derive: (d) =>
        uniqueSlug(
          slugify(String(d.name ?? "")),
          components.data.map((c) => c.slug),
        ),
      action: { label: "rename…", onclick: (r) => (renaming = r) },
    },
    {
      key: "parent",
      label: "parent",
      width: "9rem",
      edit: "select",
      info: INFO.parent,
      options: (d) => {
        const blocked = subtree(String(d.slug ?? ""));
        return [
          { value: "", label: "(top level)" },
          ...components.data
            .filter((c) => !blocked.has(c.id))
            .map((c) => ({ value: c.slug, label: c.slug })),
        ];
      },
      value: parentSlug,
    },
    {
      key: "aliases",
      label: "aliases",
      width: "9rem",
      edit: "text",
      placeholder: EXAMPLE.aliases.component,
      info: INFO.aliases.component,
      value: (r) => (r.aliases ?? []).join(", "),
    },
    { key: "description", label: "description", edit: "textarea" },
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
        <Chip
          tone={r.index_status === "ready" ? "default" : "warn"}
          title={`${r.slug} · ${r.index_status}`}>{r.slug}</Chip
        >
      {/each}
    </span>
  {:else}
    <span class="none">—</span>
  {/if}
{/snippet}

<ScopeBar
  label={t("product")}
  bind:value={productSlug}
  options={products.data.map((p) => ({ value: p.slug, label: p.name }))}
/>

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
    editTitle={(r) => r.name}
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
      components.mutate(() =>
        api.patch(`/products/${productSlug}/components/${row.slug}`, {
          name: d.name,
          parentSlug: d.parent || null,
          description: d.description || null,
          aliases: csv(String(d.aliases ?? "")),
        }),
      )}
    ondelete={(row) =>
      components.mutate(() =>
        api.delete(`/products/${productSlug}/components/${row.slug}`),
      )}
  />
{/if}

{#if renaming}
  {@const r = renaming}
  <SlugRename
    title={`rename ${r.slug}`}
    current={r.slug}
    taken={components.data.map((c) => c.slug)}
    impact={`/products/${productSlug}/components/${r.slug}`}
    onRename={(to) =>
      api.post(`/products/${productSlug}/components/${r.slug}/rename`, { to })}
    onDone={async () => {
      renaming = null;
      await components.reload();
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

<style>
  .chips {
    display: flex;
    gap: var(--pad-1);
    flex-wrap: wrap;
  }
  .none {
    color: var(--muted);
  }
</style>
