<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t } from "../terms";
  import { CrudTable, type Column } from "../tui";
  import { slugify, uniqueSlug } from "../slug";
  import SlugRename from "./SlugRename.svelte";
  import type { Product, Team } from "./rows";
import { INFO } from "./help";
  import { sectionHoist } from "./sectionAction.svelte";

  const teams = createResource(() => api.get<Team[]>("/teams"), []);
  const products = createResource(() => api.get<Product[]>("/products"), []);

  const admin = $derived(isGlobalAdmin());

  let renaming = $state<Team | null>(null);

  const slugs = $derived(teams.data.map((r) => r.slug));

  const owned = (slug: string) =>
    products.data
      .filter((p) => p.team_slug === slug)
      .map((p) => p.slug)
      .join(", ");

  const columns: Column<Team>[] = $derived([
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
      info: INFO.slug,
      derive: (d) => uniqueSlug(slugify(String(d.name ?? "")), slugs),
      action: { label: "rename…", onclick: (r) => (renaming = r) },
    },
    { key: "products", label: t("products"), value: (r) => owned(r.slug) },
  ]);

  async function reloadBoth() {
    await Promise.all([teams.reload(), products.reload()]);
  }

  onMount(reloadBoth);</script>

<CrudTable
  hoist={sectionHoist("teams")}
  {columns}
  rows={teams.data}
  rowKey={(r) => r.slug}
  loading={teams.loading}
  error={teams.error}
  emptyTitle={`No ${t("teams")} yet.`}
  emptyDetail={`Owns ${t("products")}, projects, repos.`}
  canEdit={() => admin}
  canDelete={() => admin}
  canCreate={admin}
  addLabel={`add ${t("team")}`}
  noun={t("team")}
  editTitle={(r) => r.name}
  oncreate={(d) =>
    teams.mutate(async () => {
      await api.post("/teams", { slug: d.slug, name: d.name });
      await products.reload();
    })}
  onsave={(row, d) =>
    teams.mutate(async () => {
      await api.patch(`/teams/${row.slug}`, { name: d.name });
      await products.reload();
    })}
  ondelete={(row) =>
    teams.mutate(async () => {
      await api.delete(`/teams/${row.slug}`);
      await products.reload();
    })}
/>

{#if renaming}
  {@const target = renaming}
  <SlugRename
    title={`rename ${target.slug}`}
    current={target.slug}
    taken={slugs}
    warning={`References by slug (filters, links, agent instructions) break.`}
    onRename={(slug) => api.patch(`/teams/${target.slug}`, { slug })}
    onDone={() => {
      renaming = null;
      reloadBoth();
    }}
    onCancel={() => (renaming = null)}
  />
{/if}
