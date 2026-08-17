<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { t } from "../terms";
  import { CrudTable, type Column } from "../tui";
  import { csv } from "./shared";
  import type { Customer } from "./shared";

  const customers = createResource(() => api.get<Customer[]>("/customers"), []);

  const columns: Column<Customer>[] = [
    {
      key: "slug",
      label: "slug",
      width: "12rem",
      edit: "text",
      required: true,
      editable: () => false,
    },
    { key: "name", label: "name", width: "16rem", edit: "text", required: true },
    {
      key: "aliases",
      label: "aliases",
      edit: "text",
      placeholder: "comma,separated",
      value: (r) => (r.aliases ?? []).join(", "),
    },
    { key: "notes", label: "notes", edit: "text" },
  ];

  onMount(customers.reload);
</script>

<p class="lede">
  Aliases are how a ticket's sender domain or company name resolves to one
  {t("customer")} — add naming variants here rather than creating duplicates.
</p>

<CrudTable
  {columns}
  rows={customers.data}
  rowKey={(r) => r.slug}
  loading={customers.loading}
  error={customers.error}
  emptyTitle={`No ${t("customers")} yet.`}
  addLabel={`add ${t("customer")}`}
  oncreate={(d) =>
    customers.mutate(() =>
      api.post("/customers", {
        slug: d.slug,
        name: d.name,
        aliases: csv(String(d.aliases ?? "")),
        notes: d.notes || null,
      }),
    )}
  onsave={(row, d) =>
    customers.mutate(() =>
      api.patch(`/customers/${row.slug}`, {
        name: d.name,
        aliases: csv(String(d.aliases ?? "")),
        notes: d.notes || null,
      }),
    )}
  ondelete={(row) => customers.mutate(() => api.delete(`/customers/${row.slug}`))}
/>

<style>
  .lede {
    margin: 0 0 var(--pad-3);
    font-size: var(--fs-sm);
    color: var(--muted);
    max-width: 66ch;
  }
</style>
