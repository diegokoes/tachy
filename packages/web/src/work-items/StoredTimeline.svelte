<script lang="ts">
  import type { StoredItem } from "@tachy/contract";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { segment } from "../shell/router.svelte";
  import { Note, Spinner, Time } from "../tui";
  import { itemFacts } from "./stored";
  import TimelineList from "./TimelineList.svelte";

  const id = $derived(segment(3) ?? "");

  const stored = createResource<StoredItem | null>(
    () => api.get<StoredItem>(`/work-items/stored/${encodeURIComponent(id)}`),
    null,
  );
  $effect(() => {
    void id;
    void stored.reload();
  });

  const item = $derived(stored.data?.item);
  const record = $derived(stored.data?.customer_record);
  const recordFields = $derived(
    Object.entries(record?.record ?? {}).filter(
      ([, value]) =>
        value !== null && value !== "" && typeof value !== "object",
    ),
  );
</script>

{#if stored.error}
  <Note tone="danger">{stored.error}</Note>
{:else if !item}
  <Spinner />
{:else}
  <header>
    <h2>
      {#if item.url}
        <a href={item.url} target="_blank" rel="noreferrer"
          >#{item.external_id}</a
        >
      {:else}
        #{item.external_id}
      {/if}
      <span>{item.title ?? ""}</span>
    </h2>
    <dl class="facts">
      {#each itemFacts(item) as [label, value] (label)}
        <div>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      {/each}
      <div>
        <dt>opened</dt>
        <dd><Time at={item.created_at} /></dd>
      </div>
      <div>
        <dt>changed</dt>
        <dd><Time at={item.updated_at} /></dd>
      </div>
      <div>
        <dt>read whole</dt>
        <dd><Time at={item.fetched_at} /></dd>
      </div>
    </dl>
  </header>

  {#if !item.fetched_at}
    <Note>
      only a listing has carried this item, so its messages are not stored.
      fetching it in chat or by a flow reads it whole
    </Note>
  {/if}

  {#if record}
    <details>
      <summary
        >{record.name ?? "company"}
        <span class="dim"
          >the source's record, read <Time at={record.fetched_at} /></span
        ></summary
      >
      <dl class="facts">
        {#each recordFields as [label, value] (label)}
          <div>
            <dt>{label.replaceAll("_", " ")}</dt>
            <dd>{String(value)}</dd>
          </div>
        {/each}
      </dl>
    </details>
  {/if}

  <TimelineList timeline={stored.data?.timeline ?? []} />
{/if}

<style>
  header {
    margin-bottom: var(--pad-4);
  }
  h2 {
    display: flex;
    gap: var(--pad-3);
    align-items: baseline;
    margin: 0 0 var(--pad-3);
    font-size: 1rem;
    font-weight: 600;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-2) var(--pad-4);
    margin: 0;
    font-size: var(--fs-sm);
  }
  .facts div {
    display: flex;
    gap: var(--pad-2);
  }
  dt,
  .dim {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  details {
    margin-bottom: var(--pad-4);
    font-size: var(--fs-sm);
  }
  summary {
    cursor: pointer;
    margin-bottom: var(--pad-2);
  }
</style>
