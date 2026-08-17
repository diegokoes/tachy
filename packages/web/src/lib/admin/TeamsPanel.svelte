<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t } from "../terms";
  import { CrudTable, type Column } from "../tui";
  import type { Product, Team } from "./shared";

  const teams = createResource(() => api.get<Team[]>("/teams"), []);
  const products = createResource(() => api.get<Product[]>("/products"), []);

  const admin = $derived(isGlobalAdmin());

  const owned = (slug: string) =>
    products.data
      .filter((p) => p.team_slug === slug)
      .map((p) => p.slug)
      .join(", ");

  const columns: Column<Team>[] = [
    {
      key: "name",
      label: t("team"),
      width: "18rem",
      edit: "text",
      required: true,
    },
    {
      key: "slug",
      label: "slug",
      width: "12rem",
      edit: "text",
      required: true,
      placeholder: "lowercase-kebab",
    },
    { key: "products", label: t("products"), value: (r) => owned(r.slug) },
  ];

  async function reloadBoth() {
    await Promise.all([teams.reload(), products.reload()]);
  }

  onMount(reloadBoth);
</script>

<CrudTable
  {columns}
  rows={teams.data}
  rowKey={(r) => r.slug}
  loading={teams.loading}
  error={teams.error}
  emptyTitle={`No ${t("teams")} yet.`}
  emptyDetail={`A ${t("team")} owns ${t("products")}, projects and repos.`}
  canEdit={() => admin}
  canDelete={() => admin}
  canCreate={admin}
  addLabel={`add ${t("team")}`}
  oncreate={(d) =>
    teams.mutate(async () => {
      await api.post("/teams", { slug: d.slug, name: d.name });
      await products.reload();
    })}
  onsave={(row, d) =>
    teams.mutate(async () => {
      await api.patch(`/teams/${row.slug}`, {
        name: d.name,
        ...(d.slug && d.slug !== row.slug ? { slug: d.slug } : {}),
      });
      await products.reload();
    })}
  ondelete={(row) =>
    teams.mutate(async () => {
      await api.delete(`/teams/${row.slug}`);
      await products.reload();
    })}
/>
