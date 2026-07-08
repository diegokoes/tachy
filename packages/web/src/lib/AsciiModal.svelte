<script lang="ts">
  // Retro-terminal confirm dialog: a double-ruled ASCII box that powers on like
  // an old CRT (a bright line that expands, then the text reveals). Enter
  // confirms, Esc / backdrop cancels.
  import { onMount, type Snippet } from "svelte";
  import { gsap, reducedMotion } from "./gsap";

  let {
    title = "confirm",
    confirmLabel = "confirm",
    danger = false,
    busy = false,
    onConfirm,
    onCancel,
    children,
  }: {
    title?: string;
    confirmLabel?: string;
    danger?: boolean;
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    children?: Snippet;
  } = $props();

  let box = $state<HTMLElement>();

  onMount(() => {
    if (!box || reducedMotion()) return;
    const reveal = box.querySelectorAll<HTMLElement>(".am-reveal");
    gsap.timeline()
      // CRT power-on: collapse to a scanline, then snap open.
      .from(box, { scaleY: 0.012, duration: 0.16, ease: "power3.out" })
      .from(box, { filter: "brightness(2.4)", duration: 0.25, ease: "power2.out" }, "<")
      .from(reveal, { autoAlpha: 0, y: 3, duration: 0.18, stagger: 0.04 }, ">-0.03");
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    else if (e.key === "Enter" && !busy) { e.preventDefault(); onConfirm(); }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="am-overlay" role="presentation" onclick={onCancel}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="am-box" bind:this={box} role="dialog" aria-modal="true" aria-label={title} tabindex="-1"
       onclick={(e) => e.stopPropagation()}>
    <span class="am-corner tl" aria-hidden="true">╔</span>
    <span class="am-corner tr" aria-hidden="true">╗</span>
    <span class="am-corner bl" aria-hidden="true">╚</span>
    <span class="am-corner br" aria-hidden="true">╝</span>

    <div class="am-title am-reveal">┤ {title} ├</div>
    <div class="am-body am-reveal">{@render children?.()}</div>
    <div class="am-actions am-reveal">
      <button class="am-btn" onclick={onCancel}>[esc] cancel</button>
      <button class="am-btn" class:danger disabled={busy} onclick={onConfirm}>
        {busy ? "…" : `[⏎] ${confirmLabel}`}
      </button>
    </div>
  </div>
</div>

<style>
  .am-overlay {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
    background: color-mix(in srgb, var(--bg) 74%, transparent);
    animation: am-fade 0.14s ease both;
  }
  @keyframes am-fade { from { opacity: 0; } to { opacity: 1; } }

  .am-box {
    position: relative;
    transform-origin: center;
    width: min(34rem, 100%);
    background: var(--panel-solid);
    color: var(--text);
    /* double rule = the old text-mode box look */
    border: 3px double var(--muted);
    padding: 1rem 1.15rem 0.9rem;
    font-family: ui-monospace, "Cascadia Mono", monospace;
    /* faint CRT scanlines */
    background-image: repeating-linear-gradient(
      var(--bg) 0 1px, transparent 1px 3px);
    background-blend-mode: soft-light;
  }

  /* Box-drawing corners sit on top of the double border for the ASCII join. */
  .am-corner {
    position: absolute; line-height: 1; font-size: 1.1rem; color: var(--muted);
    background: var(--panel-solid); padding: 0 1px; user-select: none;
  }
  .am-corner.tl { top: -0.72rem; left: -0.4rem; }
  .am-corner.tr { top: -0.72rem; right: -0.4rem; }
  .am-corner.bl { bottom: -0.72rem; left: -0.4rem; }
  .am-corner.br { bottom: -0.72rem; right: -0.4rem; }

  .am-title {
    text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.82rem;
    color: var(--muted); text-align: center; margin: -0.35rem 0 0.75rem;
  }
  .am-body { font-size: 0.92rem; line-height: 1.55; }
  .am-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
  .am-btn { font-size: 0.82rem; }
  .am-btn.danger { border-color: var(--danger); color: var(--danger); }
  .am-btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 15%, transparent); }
</style>
