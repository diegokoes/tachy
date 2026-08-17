<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import { CrudTable, type Column } from "../tui";
  import { csv } from "./shared";
  import type { Product, Team } from "./shared";

  const products = createResource(() => api.get<Product[]>("/products"), []);
  const teams = createResource(() => api.get<Team[]>("/teams"), []);

  const teamOptions = $derived(
    teams.data.map((x) => ({ value: x.slug, label: x.name })),
  );

  const mayEdit = (r: Product) => canCurateScope({ team_slug: r.team_slug });

  const columns: Column<Product>[] = $derived([
    { key: "name", label: t("product"), width: "16rem", edit: "text", required: true },
    { key: "slug", label: "slug", width: "12rem", edit: "text", required: true },
    {
      key: "team_slug",
      label: t("team"),
      width: "12rem",
      edit: "select",
      options: teamOptions,
      required: true,
      editable: () => false,
    },
    {
      key: "aliases",
      label: "aliases",
      edit: "text",
      placeholder: "comma,separated",
      value: (r) => (r.aliases ?? []).join(", "),
    },
  ]);

  onMount(() => {
    products.reload();
    teams.reload();
  });
</script>

<CrudTable
  columns={columns}
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
        ...(d.slug && d.slug !== row.slug ? { slug: d.slug } : {}),
        aliases: csv(String(d.aliases ?? "")),
      }),
    )}
  ondelete={(row) =>
    products.mutate(() => api.delete(`/products/${row.slug}`))}
/>
