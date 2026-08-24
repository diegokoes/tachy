<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import { CrudTable, type Column } from "../tui";
  import { slugify, uniqueSlug } from "../slug";
  import SlugRename from "./SlugRename.svelte";
  import { csv, INFO, TIP, type Product, type Team } from "./shared";

  const products = createResource(() => api.get<Product[]>("/products"), []);
  const teams = createResource(() => api.get<Team[]>("/teams"), []);

  let renaming = $state<Product | null>(null);

  const teamOptions = $derived(
    teams.data.map((x) => ({ value: x.slug, label: x.name })),
  );

  /* The table only requires (team, slug) to be unique, but getProductIdBySlug
     resolves a slug across every team and refuses an ambiguous one — so a
     derived slug has to clear the whole set, not just its team's. */
  const allSlugs = $derived(products.data.map((p) => p.slug));

  const mayEdit = (r: Product) => canCurateScope({ team_slug: r.team_slug });

  const columns: Column<Product>[] = $derived([
    {
      key: "name",
      label: t("product"),
      width: "16rem",
      edit: "text",
      required: true,
    },
    {
      key: "slug",
      label: "slug",
      width: "12rem",
      edit: "text",
      required: true,
      hint: TIP.slug,
      info: INFO.slug,
      derive: (d) => uniqueSlug(slugify(String(d.name ?? "")), allSlugs),
      action: { label: "rename…", onclick: (r) => (renaming = r) },
    },
    {
      key: "team_slug",
      label: t("team"),
      width: "12rem",
      edit: "select",
      options: teamOptions,
      required: true,
      initial: teams.data[0]?.slug,
      hint: `Who owns this ${t("product")}. Moving it takes its source projects along.`,
    },
    {
      key: "aliases",
      label: "aliases",
      edit: "text",
      hint: TIP.aliases.product,
      info: INFO.aliases.product,
      value: (r) => (r.aliases ?? []).join(", "),
    },
  ]);

  onMount(() => {
    products.reload();
    teams.reload();
  });
</script>

<CrudTable
  {columns}
  rows={products.data}
  rowKey={(r) => r.slug}
  loading={products.loading}
  error={products.error}
  emptyTitle={`No ${t("products")} yet.`}
  emptyDetail={`A ${t("product")} scopes components, labels and knowledge entries.`}
  canEdit={mayEdit}
  canDelete={mayEdit}
  canCreate={teams.data.length > 0}
  addLabel={`add ${t("product")}`}
  editTitle={(r) => r.name}
  oncreate={(d) =>
    products.mutate(() =>
      api.post("/products", {
        slug: d.slug,
        name: d.name,
        team_slug: d.team_slug,
        aliases: csv(String(d.aliases ?? "")),
      }),
    )}
  onsave={(row, d) =>
    products.mutate(() =>
      api.patch(`/products/${row.slug}`, {
        name: d.name,
        team_slug: d.team_slug,
        aliases: csv(String(d.aliases ?? "")),
      }),
    )}
  ondelete={(row) => products.mutate(() => api.delete(`/products/${row.slug}`))}
/>

{#if renaming}
  {@const target = renaming}
  <SlugRename
    title={`rename ${target.slug}`}
    current={target.slug}
    taken={allSlugs}
    warning={`Anything that names this ${t("product")} by slug — saved filters, links, agent instructions — stops resolving. Add the old name to aliases if it is in use.`}
    onRename={(slug) => api.patch(`/products/${target.slug}`, { slug })}
    onDone={() => {
      renaming = null;
      products.reload();
    }}
    onCancel={() => (renaming = null)}
  />
{/if}
