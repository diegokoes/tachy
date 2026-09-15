<script lang="ts">
  import type { Snippet } from "svelte";
  import { Card, Meter } from "../tui";
  import Figure from "./Figure.svelte";

  let {
    label,
    value,
    unit,
    detail,
    meter,
    span = 1,
    tone = "accent",
    loading = false,
    children,
  }: {
    label: string;
    value: number;
    /** Printed small after the figure — "of 12", "chunks". */
    unit?: string;
    detail?: string;
    /** 0-1. Drawn under the figure when given. */
    meter?: number;
    span?: 1 | 2 | 3 | "full";
    tone?: "accent" | "ok" | "warn" | "danger" | "muted";
    loading?: boolean;
    /** Badges, links — whatever this figure is actionable through. */
    children?: Snippet;
  } = $props();
</script>

<Card {label} {span} {loading} lines={2}>
  <Figure {value} {unit} {tone} />
  {#if meter !== undefined}
    <Meter value={meter} width={10} {tone} {label} />
  {/if}
  {#if detail}<span class="detail">{detail}</span>{/if}
  {#if children}
    <span class="acts">{@render children()}</span>
  {/if}
</Card>

<style>
  .detail {
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
    margin-top: var(--pad-1);
  }
</style>
