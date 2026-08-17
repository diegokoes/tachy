<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    meta,
    hint,
    children,
    tone = "default",
    flush = false,
    scan = false,
    grow = false,
  }: {
    title?: string;
    meta?: Snippet;
    hint?: Snippet;
    children: Snippet;
    tone?: "default" | "accent" | "warn" | "danger";
    flush?: boolean;
    scan?: boolean;
    grow?: boolean;
  } = $props();

  const titled = $derived(Boolean(title || meta));
</script>

<section
  class="panel {tone}"
  class:flush
  class:scan
  class:grow
  class:titled
  class:hinted={Boolean(hint)}
>
  {#if titled}
    <header class="head">
      {#if title}<span class="title">{title}</span>{/if}
      {#if meta}<span class="meta">{@render meta()}</span>{/if}
    </header>
  {/if}

  <div class="body">{@render children()}</div>

  {#if hint}
    <footer class="foot"><span class="fill">{@render hint()}</span></footer>
  {/if}
</section>

<style>
  .panel {
    position: relative;
    min-width: 0;
    border: var(--panel-line);
    border-radius: var(--radius);
    background: var(--panel-bg);
    padding: var(--pad-3) var(--pad-4);
  }

  .panel.flush {
    padding: 0;
  }

  /* Titles and hints straddle the rule, so the padding on that edge must
     always clear half a label — even at density compact. */
  .panel.titled {
    padding-top: max(var(--pad-3), 0.8rem);
  }
  .panel.hinted {
    padding-bottom: max(var(--pad-3), 0.8rem);
  }

  .panel.grow {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  .panel.grow .body {
    flex: 1 1 auto;
    min-height: 0;
  }

  .panel.accent {
    border-color: var(--accent);
  }
  .panel.warn {
    border-color: var(--warn);
  }
  .panel.danger {
    border-color: var(--danger);
  }

  .head,
  .foot {
    position: absolute;
    left: var(--pad-3);
    right: var(--pad-3);
    display: flex;
    align-items: baseline;
    gap: var(--gap);
    overflow: hidden;
    pointer-events: none;
  }
  .head {
    top: 0;
    transform: translateY(-50%);
  }
  .foot {
    bottom: 0;
    transform: translateY(50%);
  }

  .title,
  .meta,
  .fill {
    background: var(--panel-bg);
    padding: 0 var(--pad-2);
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
    white-space: nowrap;
    pointer-events: auto;
  }
  .meta {
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .accent .title {
    color: var(--accent);
  }
  .warn .title {
    color: var(--warn);
  }
  .danger .title {
    color: var(--danger);
  }

  /* Faint CRT scanlines, for cards that want the extra texture. */
  .panel.scan {
    background-image: repeating-linear-gradient(
      var(--bg) 0 1px,
      transparent 1px 3px
    );
    background-blend-mode: soft-light;
  }
</style>
