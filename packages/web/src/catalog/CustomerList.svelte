<script lang="ts">
  import type { CustomerRow, ProductRow } from "@tachy/contract";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { session } from "../access/session.svelte";
  import { link } from "../shell/router.svelte";
  import { keep, recall } from "../shell/kept";
  import { Chip, Choice, EmptyState, FilterBar, Note } from "../tui";
  import { customersInScope, productsOfTeams } from "./customer";

  const customers = createResource(
    () => api.get<CustomerRow[]>("/customers"),
    [],
  );
  const products = createResource(() => api.get<ProductRow[]>("/products"), []);
  void customers.reload();
  void products.reload();

  const SCOPES = [
    { value: "mine", label: "my products" },
    { value: "all", label: "all" },
  ] as const;

  let filter = $state(recall("library.customers.filter", ""));
  $effect(() => keep("library.customers.filter", filter));
  let scope = $state<"mine" | "all">(recall("library.customers.scope", "mine"));
  $effect(() => keep("library.customers.scope", scope));

  const myProducts = $derived(
    productsOfTeams(
      products.data,
      (session.me?.teams ?? []).map((team) => team.team_slug),
    ),
  );
  const inScope = $derived(
    customersInScope(customers.data, myProducts, scope === "all"),
  );
  const shown = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return inScope;
    return inScope.filter((customer) =>
      [customer.slug, customer.name, ...(customer.aliases ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  });
</script>

<div class="list">
  <div class="bar">
    <FilterBar
      bind:value={filter}
      shown={shown.length}
      total={inScope.length}
      label="filter customers"
    />
    <Choice
      options={SCOPES}
      value={scope}
      label="which customers"
      onpick={(value) => (scope = value)}
    />
  </div>

  {#if customers.error}<Note tone="danger">{customers.error}</Note>{/if}

  {#if !customers.loading && !shown.length}
    <EmptyState
      art={customers.data.length ? "noMatch" : "empty"}
      title={customers.data.length ? "no customers match" : "no customers yet"}
    />
  {:else}
    <ul class="rows">
      {#each shown as customer (customer.slug)}
        <li>
          <a href="/customers/{customer.slug}" use:link>
            <span class="name">{customer.name}</span>
            <span class="slug">{customer.slug}</span>
            <span class="products">
              {#each customer.products as product (product)}
                <Chip tone="muted">{product}</Chip>
              {/each}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
    flex-wrap: wrap;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .rows a {
    display: grid;
    grid-template-columns: minmax(12rem, max-content) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--pad-3);
    padding: var(--pad-2) var(--pad-3);
    border-bottom: var(--panel-line);
    color: inherit;
    text-decoration: none;
  }
  .rows a:hover,
  .rows a:focus-visible {
    background: var(--accent-dim);
  }
  .slug {
    font-family: var(--font-mono);
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .products {
    display: flex;
    gap: var(--pad-1);
    flex-wrap: wrap;
    justify-content: end;
  }
</style>
