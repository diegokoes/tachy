<script lang="ts">
  import { createSequence } from "../resource.svelte";
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import type { NamedRow } from "../types";

  interface Link {
    id: string;
    label: string | null;
    from_doc_id: string | null;
    from_entry_id: string | null;
    from_title: string | null;
    from_slug: string | null;
    from_product_id: string | null;
    from_kind: string | null;
  }

  /**
   * What points at this item. `base` is the collection the item lives in —
   * both expose the same /:id/links endpoint.
   */
  let { base, id }: { base: "knowledge" | "reference"; id: string } = $props();

  let inbound = $state<Link[]>([]);
  let products = $state<NamedRow[]>([]);

  $effect(() => {
    void id;
    load();
  });

  const current = createSequence();

  async function load() {
    const isCurrent = current();
    try {
      const [links, prods] = await Promise.all([
        api.get<{ inbound: Link[] }>(`/${base}/${id}/links`),
        api.get<NamedRow[]>("/products").catch(() => [] as NamedRow[]),
      ]);
      if (!isCurrent()) return;
      inbound = links.inbound;
      products = prods;
    } catch {
      if (!isCurrent()) return;
      inbound = [];
    }
  }

  function open(l: Link) {
    if (l.from_kind === "wiki" && l.from_slug) {
      const scope =
        products.find((p) => p.id === l.from_product_id)?.slug ?? "general";
      navigate(`/library/wiki/${scope}/${l.from_slug}`);
    } else if (l.from_entry_id) {
      navigate(`/library/entries/${l.from_entry_id}`);
    } else if (l.from_doc_id) {
      navigate(`/library/docs/${l.from_doc_id}`);
    }
  }

  const what = (l: Link) =>
    l.from_kind === "wiki" ? "article" : l.from_kind === "entry" ? "entry" : "doc";
</script>

{#if inbound.length}
  <section class="backlinks">
    <h3>Linked from</h3>
    <ul>
      {#each inbound as l (l.id)}
        <li>
          <button onclick={() => open(l)}>{l.from_title ?? "(untitled)"}</button>
          <span class="what">{what(l)}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .backlinks {
    margin-top: var(--pad-3);
    border-top: 1px solid var(--line, currentColor);
    padding-top: var(--pad-2);
  }
  h3 {
    font-size: 0.9em;
    margin: 0 0 0.3rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    padding: 0.1rem 0;
  }
  button {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  button:hover {
    text-decoration: underline;
  }
  .what {
    opacity: 0.5;
    font-size: 0.85em;
    margin-left: 0.5rem;
  }
</style>
