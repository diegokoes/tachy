<script lang="ts">
  import { isCurator } from "../access/session.svelte";
  import { onMount } from "svelte";
  import { keep, recall } from "../shell/kept";
  import { navigate } from "../shell/router.svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { t } from "../terms";
  import {
    Button,
    CrudTable,
    FilterBar,
    type Column,
    type Draft,
  } from "../tui";
  import { slugify, uniqueSlug } from "../slug";
  import type { Customer } from "./rows";
  import { INFO } from "../admin/help";
  import { csv } from "../tui/fields";
  import { sectionHoist } from "../admin/sectionAction.svelte";

  const customers = createResource(() => api.get<Customer[]>("/customers"), []);

  const columns: Column<Customer>[] = $derived([
    {
      key: "name",
      face: "ui",
      label: t("customer"),
      width: "16rem",
      edit: "text",
      required: true,
    },
    {
      key: "slug",
      label: "id",
      formOnly: true,
      edit: "text",
      required: true,
      info: INFO.slug,
      derive: (d) =>
        uniqueSlug(
          slugify(String(d.name ?? "")),
          customers.data.map((c) => c.slug),
        ),
    },
    {
      key: "products",
      label: t("products"),
      value: (r) => (r.products ?? []).join(", "),
    },
    {
      key: "email_domains",
      label: "email domains",
      edit: "text",
      info: INFO.emailDomains,
      value: (r) => (r.email_domains ?? []).join(", "),
    },
    {
      key: "aliases",
      label: "aliases",
      formOnly: true,
      edit: "text",
      info: INFO.aliases.customer,
      value: (r) => (r.aliases ?? []).join(", "),
    },
    { key: "notes", face: "ui", label: "notes", edit: "textarea" },
  ]);

  onMount(() => {
    customers.reload();
  });

  async function createCustomer(draft: Draft) {
    await customers.mutate(() =>
      api.post("/customers", {
        slug: draft.slug,
        name: draft.name,
        aliases: csv(String(draft.aliases ?? "")),
        emailDomains: csv(String(draft.email_domains ?? "")),
        notes: draft.notes || undefined,
      }),
    );
  }

  const saveCustomer = (row: Customer, d: Draft) =>
    customers.mutate(() =>
      api.patch(`/customers/${row.slug}`, {
        name: d.name,
        aliases: csv(String(d.aliases ?? "")),
        emailDomains: csv(String(d.email_domains ?? "")),
        notes: d.notes || null,
      }),
    );

  const deleteCustomer = (row: Customer) =>
    customers.mutate(() => api.delete(`/customers/${row.slug}`));

  let filter = $state(recall("admin.customers.filter", ""));
  $effect(() => keep("admin.customers.filter", filter));
  const filtered = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return customers.data;
    return customers.data.filter((c) =>
      [
        c.slug ?? "",
        c.name ?? "",
        (c.aliases ?? []).join(" "),
        (c.email_domains ?? []).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  });
</script>

<FilterBar
  bind:value={filter}
  shown={filtered.length}
  total={customers.data.length}
  label="filter customers"
/>

<!-- Units, facts, products, documents and history live on the customer's page. -->
{#snippet openPage(row: Customer)}
  <Button
    size="sm"
    variant="ghost"
    onclick={() => navigate(`/customers/${row.slug}`)}>open page</Button
  >
{/snippet}

<CrudTable
  hoist={sectionHoist("customers")}
  {columns}
  rows={filtered}
  rowKey={(r) => r.slug}
  loading={customers.loading}
  error={customers.error}
  emptyTitle={customers.data.length
    ? `no ${t("customers")} match the filter`
    : `no ${t("customers")} yet`}
  emptyArt={customers.data.length ? "noMatch" : "empty"}
  emptyDetail={customers.data.length
    ? undefined
    : "attributed by requester email domain: list domains"}
  addLabel={`add ${t("customer")}`}
  noun={t("customer")}
  editTitle={(r) => r.name}
  canEdit={isCurator}
  canDelete={isCurator}
  canCreate={isCurator()}
  extraActions={openPage}
  oncreate={createCustomer}
  onsave={saveCustomer}
  ondelete={deleteCustomer}
/>
