<script lang="ts">
  import type { Snippet } from "svelte";
  import { G } from "./glyphs";
  import Icon from "./Icon.svelte";

  let {
    tone = "muted",
    children,
    action,
  }: {
    tone?: "muted" | "accent" | "ok" | "warn" | "danger";
    children: Snippet;
    action?: Snippet;
  } = $props();

  const GLYPH = {
    muted: "",
    accent: G.dot,
    ok: G.save,
    warn: "",
    danger: "",
  } as const;

  const alerting = $derived(tone === "warn" || tone === "danger");
</script>

<p class="note {tone}" role={tone === "danger" ? "alert" : undefined}>
  {#if alerting}<span class="g"><Icon name="alert" size="1em" weight={7} /></span>
  {:else if GLYPH[tone]}<span class="g" aria-hidden="true">{GLYPH[tone]}</span>{/if}
  <span class="txt">{@render children()}</span>
  {#if action}<span class="act">{@render action()}</span>{/if}
</p>

<style>
  .note {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
    margin: var(--pad-2) 0;
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .note.accent {
    color: var(--accent);
  }
  .note.ok {
    color: var(--ok);
  }
  .note.warn {
    color: var(--warn);
  }
  .note.danger {
    color: var(--danger);
  }
  .g {
    flex: none;
    display: inline-flex;
    align-self: center;
  }
  .txt {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .act {
    margin-left: auto;
    flex: none;
  }
</style>
