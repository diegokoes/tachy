<script lang="ts">
  import { link } from "../shell/router.svelte";
  import { Icon } from "../tui";
  import type { SetupGroup } from "./customer";

  /**
   * The customer and the parts of their setup, one branch per product and the
   * general units last. Each row opens what is recorded for it beside the tree.
   */
  let {
    customer,
    groups,
    current,
    productName,
  }: {
    customer: { slug: string; name: string };
    groups: SetupGroup[];
    /** The unit in view; null while the customer as a whole is. */
    current: string | null;
    productName: (slug: string | null) => string;
  } = $props();
</script>

<nav class="tree" aria-label="setup">
  <a
    class="row root"
    class:current={!current}
    aria-current={current ? undefined : "page"}
    href="/customers/{customer.slug}"
    use:link
  >
    <Icon name="customer" size="1em" />
    <span class="name">{customer.name}</span>
    <span class="open" aria-hidden="true">›</span>
  </a>
  {#each groups as group (group.product ?? "")}
    <p class="product">{productName(group.product)}</p>
    {#each group.rows as row (row.unit.id)}
      <a
        class="row"
        class:current={row.unit.slug === current}
        aria-current={row.unit.slug === current ? "page" : undefined}
        href="/customers/{customer.slug}/{row.unit.slug}"
        use:link
      >
        {#each row.guides as guide, index (index)}
          <span class="guide {guide}" aria-hidden="true"></span>
        {/each}
        <span class="name">{row.unit.name}</span>
        <span class="kind">{row.unit.kind}</span>
        <span class="open" aria-hidden="true">›</span>
      </a>
    {/each}
  {/each}
</nav>

<style>
  .tree {
    display: flex;
    flex-direction: column;
  }
  /* No padding above or below a row, so each guide spans it edge to edge and
     meets the guide of the row beneath. */
  .row {
    display: flex;
    align-items: stretch;
    gap: var(--pad-2);
    min-height: 2rem;
    padding: 0 var(--pad-2);
    border-left: 2px solid transparent;
    color: inherit;
    text-decoration: none;
  }
  .row > :not(.guide) {
    align-self: center;
  }
  .row:hover {
    background: color-mix(in srgb, currentColor 6%, transparent);
  }
  .row.current {
    border-left-color: var(--accent);
    background: var(--accent-dim);
  }
  /* No guides here, so nothing needs the full height; the icon is another
     component's element, which the rule above does not reach. */
  .root {
    align-items: center;
    font-weight: 600;
  }
  .product {
    margin: var(--pad-3) 0 0;
    padding: var(--pad-1) var(--pad-2);
    color: var(--muted);
    font-size: var(--fs-sm);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
  }
  .guide {
    --line: color-mix(in srgb, var(--muted) 55%, transparent);
    position: relative;
    flex: none;
    width: 1.1rem;
    margin-right: calc(var(--pad-2) * -1);
  }
  .guide.pipe::before,
  .guide.tee::before,
  .guide.elbow::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0.45rem;
    border-left: 1px solid var(--line);
  }
  .guide.elbow::before {
    bottom: 50%;
  }
  .guide.tee::after,
  .guide.elbow::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 0.45rem;
    right: 0;
    border-top: 1px solid var(--line);
  }
  .name {
    min-width: 0;
    margin-left: var(--pad-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .root .name {
    margin-left: 0;
  }
  .kind {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .open {
    margin-left: auto;
    color: var(--muted);
  }
  .row:hover .open,
  .row.current .open {
    color: var(--accent);
  }
</style>
