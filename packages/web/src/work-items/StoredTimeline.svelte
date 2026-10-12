<script lang="ts">
  import type { StoredItem } from "@tachy/contract";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { segment } from "../shell/router.svelte";
  import { Badge, Note, Spinner, Time, tip } from "../tui";
  import { eventLine, itemFacts, senderOf } from "./stored";

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
      Only a listing has carried this item, so its messages are not stored.
      Fetching it in chat or by a flow reads it whole.
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

  <ol class="timeline">
    {#each stored.data?.timeline ?? [] as entry (`${entry.kind}:${entry.id}`)}
      {#if entry.kind === "event"}
        <li class="event">
          <span class="at"><Time at={entry.at} /></span>
          <span class="what">{eventLine(entry)}</span>
          {#if entry.actor}<span class="dim">{entry.actor}</span>{/if}
          {#if entry.origin === "observed"}
            <span
              use:tip={"Two reads of the item differed: it happened at or before this time."}
              ><Badge>observed</Badge></span
            >
          {/if}
        </li>
      {:else}
        <li class="message">
          <div class="head">
            <span class="at"><Time at={entry.at} /></span>
            <span class="who">{senderOf(entry)}</span>
            {#if entry.direction}<span class="dim">{entry.direction}</span>{/if}
            {#if entry.visibility && entry.visibility !== "public"}
              <Badge tone="warn">{entry.visibility}</Badge>
            {/if}
            {#if entry.automated}<Badge>automated</Badge>{/if}
            {#if entry.files}
              <span class="dim"
                >{entry.files} {entry.files === 1 ? "file" : "files"}</span
              >
            {/if}
          </div>
          {#if entry.text}<p>{entry.text}</p>{/if}
        </li>
      {/if}
    {/each}
  </ol>
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
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: var(--fs-sm);
  }
  .timeline li {
    border-top: 1px solid var(--border);
    padding: var(--pad-2) 0;
  }
  .event,
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--pad-3);
  }
  .at {
    flex: none;
    width: 10rem;
    color: var(--muted);
  }
  .event .what {
    color: var(--muted);
  }
  .who {
    font-weight: 600;
  }
  .message p {
    margin: var(--pad-2) 0 0 calc(10rem + var(--pad-3));
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
