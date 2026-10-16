<script lang="ts">
  import type { StoredItemEntry } from "@tachy/contract";
  import { Badge, Time, tip } from "../tui";
  import { eventLine, senderOf } from "./stored";

  let { timeline }: { timeline: StoredItemEntry[] } = $props();
</script>

<ol class="timeline">
  {#each timeline as entry (`${entry.kind}:${entry.id}`)}
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

<style>
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
  .dim,
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
