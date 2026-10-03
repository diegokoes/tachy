<script lang="ts">
  import type { ReviewFinding, TicketReview } from "@tachy/contract";
  import { tick } from "svelte";
  import { wipeIn } from "../motion";
  import { Button, Icon, Meter, Note } from "../tui";

  let {
    review,
    previous,
    dismissed,
    reviewing,
    fieldName,
    onapply,
    ondismiss,
    onfocus,
  }: {
    review: TicketReview | null;
    previous: TicketReview | null;
    dismissed: string[];
    reviewing: boolean;
    fieldName: (ref: string) => string;
    onapply: (f: ReviewFinding) => void;
    ondismiss: (id: string) => void;
    onfocus: (ref: string) => void;
  } = $props();

  const READINESS = {
    ready: { value: 1, tone: "ok", label: "ready to hand over" },
    almost: { value: 0.66, tone: "warn", label: "almost there" },
    "needs-work": { value: 0.33, tone: "danger", label: "needs work" },
  } as const;

  const KIND = {
    gap: "missing",
    unclear: "unclear",
    improve: "could be better",
  };

  const open = $derived(
    (review?.findings ?? []).filter((f) => !dismissed.includes(f.id)),
  );

  /** A field the last review flagged and this one no longer does. */
  const fixed = $derived.by(() => {
    if (!review || !previous) return [];
    const now = new Set(review.findings.map((f) => f.field));
    return [...new Set(previous.findings.map((f) => f.field))].filter(
      (f) => !now.has(f),
    );
  });

  let list = $state<HTMLElement>();
  $effect(() => {
    void review;
    tick().then(() => list && wipeIn(list.children));
  });
</script>

<aside class="rail" aria-label="tachy's review" aria-busy={reviewing}>
  <header>
    <Icon name="review" size="1.1em" />
    <span class="title">tachy's review</span>
  </header>

  {#if reviewing && !review}
    <p class="dim">reading it the way the developer picking it up would…</p>
  {:else if !review}
    <p class="dim">
      Write it your way, then ask. tachy reads it as the developer who has to
      pick it up, and points at what they would ask you. It never rewrites it.
    </p>
  {:else if !review.available}
    <Note tone="warn"
      >No model is set up for you. Add one under Settings › agent.</Note
    >
  {:else}
    {@const r = READINESS[review.readiness]}
    <div class="verdict">
      <Meter value={r.value} tone={r.tone} label={r.label} />
      <span class="readiness {r.tone}">{r.label}</span>
    </div>
    {#if review.summary}<p class="summary">{review.summary}</p>{/if}
    {#if fixed.length}
      <p class="fixed">
        <Icon name="success" size="1em" /> fixed since last time: {fixed
          .map(fieldName)
          .join(", ")}
      </p>
    {/if}
    <ol class="findings" bind:this={list}>
      {#each open as f (f.id)}
        <li class="finding {f.kind}">
          <button class="where" onclick={() => onfocus(f.field)}>
            {fieldName(f.field)} · {KIND[f.kind]}
          </button>
          <p>{f.message}</p>
          {#if f.suggestion}
            <blockquote>{f.suggestion}</blockquote>
          {/if}
          <div class="acts">
            {#if f.suggestion && f.field !== "general"}
              <Button
                size="sm"
                variant="ghost"
                icon="plus"
                onclick={() => onapply(f)}>apply</Button
              >
            {/if}
            <Button
              size="sm"
              variant="ghost"
              icon="close"
              onclick={() => ondismiss(f.id)}>dismiss</Button
            >
          </div>
        </li>
      {/each}
    </ol>
    {#if !open.length}
      <p class="dim">Nothing left to raise.</p>
    {/if}
  {/if}
</aside>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    color: var(--accent);
  }
  .title {
    letter-spacing: var(--label-spacing);
  }
  .dim {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .verdict {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .readiness.ok {
    color: var(--ok);
  }
  .readiness.warn {
    color: var(--warn);
  }
  .readiness.danger {
    color: var(--danger);
  }
  .summary {
    margin: 0;
    font-family: var(--font-prose);
  }
  .fixed {
    display: flex;
    align-items: center;
    gap: var(--pad-1);
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--ok);
  }
  .findings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .finding {
    padding: var(--pad-2);
    border: 1px solid var(--border);
    border-left: 2px solid var(--muted);
    border-radius: var(--radius);
  }
  .finding.gap {
    border-left-color: var(--danger);
  }
  .finding.unclear {
    border-left-color: var(--warn);
  }
  .finding.improve {
    border-left-color: var(--accent);
  }
  .finding p {
    margin: var(--pad-1) 0;
    font-family: var(--font-prose);
  }
  .where {
    padding: 0;
    border: none;
    background: none;
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
    cursor: pointer;
  }
  .where:hover,
  .where:focus-visible {
    color: var(--accent);
  }
  blockquote {
    margin: 0 0 var(--pad-1);
    padding-left: var(--pad-2);
    border-left: 1px solid var(--accent);
    color: var(--muted);
    white-space: pre-wrap;
  }
  .acts {
    display: flex;
    gap: var(--pad-1);
  }
</style>
