<script lang="ts">
  import { Meter } from "../tui";
  import { wipeIn } from "../motion";

  let {
    confidence,
    clarity,
  }: {
    confidence?: string | null;
    clarity?: string | null;
  } = $props();

  /**
   * Two different questions — how sure we are of the entry, and how definitely
   * the ticket was actually resolved — that happen to share a three-step
   * ordering, so one scale draws both.
   */
  const STEPS: Record<string, number> = {
    low: 1,
    unclear: 1,
    medium: 2,
    partial: 2,
    high: 3,
    clear: 3,
  };

  const tone = (step: number) =>
    step >= 3 ? ("ok" as const) : step === 2 ? ("warn" as const) : ("muted" as const);

  const rows = $derived(
    (
      [
        ["conf", confidence],
        ["clar", clarity],
      ] as const
    )
      .filter(([, v]) => v && STEPS[v])
      .map(([label, v]) => {
        const step = STEPS[v as string];
        return { label, value: v as string, step, frac: step / 3, tone: tone(step) };
      }),
  );

  let el = $state<HTMLElement>();

  /**
   * The same staggered left-to-right clip sweep the nav reveal uses — already
   * reduced-motion guarded, so the bars land at full width instantly when the
   * user asks for less movement.
   */
  $effect(() => {
    void rows;
    if (el) wipeIn(Array.from(el.querySelectorAll<HTMLElement>(".bar")));
  });
</script>

{#if rows.length}
  <dl class="bars" bind:this={el}>
    {#each rows as r (r.label)}
      <dt>{r.label}</dt>
      <!-- The bar already says how far along the scale this sits; the word
           would only repeat it. It stays in the tooltip and the aria label. -->
      <dd class="bar" title="{r.label}: {r.value}">
        <Meter value={r.frac} width={8} tone={r.tone} label="{r.label} {r.value}" />
      </dd>
    {/each}
  </dl>
{/if}

<style>
  .bars {
    display: grid;
    grid-template-columns: max-content max-content;
    align-items: center;
    gap: var(--pad-1) var(--gap);
    margin: 0;
    font-size: var(--fs-xs);
  }
  dt {
    color: var(--muted);
    letter-spacing: var(--label-spacing);
  }
  dd {
    display: flex;
    align-items: center;
    margin: 0;
  }
</style>
