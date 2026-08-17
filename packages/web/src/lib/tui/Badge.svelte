<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    tone = "muted",
    title,
    children,
  }: {
    tone?: "muted" | "accent" | "ok" | "warn" | "danger";
    title?: string;
    children: Snippet;
  } = $props();
</script>

<span class="badge {tone}" {title}>{@render children()}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    font-size: var(--fs-xs);
    line-height: 1.4;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 var(--pad-2);
    white-space: nowrap;
    color: var(--muted);
  }
  .badge.accent {
    border-color: var(--accent);
    color: var(--accent);
  }
  .badge.ok {
    border-color: var(--ok);
    color: var(--ok);
  }
  .badge.warn {
    border-color: var(--warn);
    color: var(--warn);
  }
  .badge.danger {
    border-color: var(--danger);
    color: var(--danger);
  }
</style>
