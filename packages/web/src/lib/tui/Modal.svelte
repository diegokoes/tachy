<script lang="ts" module>
  /* Dialogs stack. Escape and Enter reach the topmost one only — two open
     dialogs answering the same keypress is what forced callers to close one
     before opening the next. */
  let depth = $state(0);
  const take = () => ++depth;
</script>

<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { gsap, reducedMotion } from "../gsap";
  import Scrollbar from "../Scrollbar.svelte";
  import Scrim from "./Scrim.svelte";
  import Button from "./Button.svelte";
  import type { IconName } from "./icons";

  let {
    title = "confirm",
    confirmLabel = "confirm",
    confirmIcon = "save",
    cancelLabel = "cancel",
    destructive,
    danger = false,
    busy = false,
    disabled = false,
    width = "34rem",
    onConfirm,
    onCancel,
    barExtra,
    children,
  }: {
    /** The dialog's accessible name. Never drawn — the chrome carries no title. */
    title?: string;
    confirmLabel?: string;
    /** The bar is icon-only, so a confirm that isn't a save must say so. */
    confirmIcon?: IconName;
    cancelLabel?: string;
    /** Sits at the far left of the bar, away from the two it must not be. */
    destructive?: {
      label: string;
      icon?: IconName;
      onclick: () => void;
      busy?: boolean;
      disabled?: boolean;
    };
    danger?: boolean;
    busy?: boolean;
    disabled?: boolean;
    width?: string;
    onConfirm?: () => void;
    onCancel: () => void;
    /** Extra bar actions, left of cancel. */
    barExtra?: Snippet;
    children?: Snippet;
  } = $props();

  let win = $state<HTMLElement>();
  let bodyEl = $state<HTMLElement>();
  let mine = 0;
  const top = $derived(mine === depth);

  const FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  onMount(() => {
    mine = take();
    const restore = document.activeElement as HTMLElement | null;
    /* One lock for the whole stack: the innermost dialog must not release it
       on the way out while an outer one is still open. */
    const locked = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    win?.focus();

    const tl =
      win && !reducedMotion()
        ? gsap
            .timeline()
            .from(win, {
              scaleY: 0.06,
              autoAlpha: 0,
              duration: 0.17,
              ease: "power3.out",
            })
            .from(
              win.querySelectorAll<HTMLElement>(".reveal"),
              { autoAlpha: 0, duration: 0.13, ease: "none" },
              "<0.06",
            )
        : null;

    return () => {
      tl?.kill();
      depth--;
      if (depth === 0) document.body.style.overflow = locked;
      restore?.focus?.();
    };
  });

  function trap(e: KeyboardEvent) {
    if (!win) return;
    const els = [...win.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null,
    );
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === win)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (!top) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab") {
      trap(e);
    } else if (
      e.key === "Enter" &&
      onConfirm &&
      !busy &&
      !disabled &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      onConfirm();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="over">
  <Scrim onclick={onCancel} soft={!top} />

  <div class="stage" role="presentation" onclick={onCancel}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="win"
      class:danger
      bind:this={win}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      style="width: min({width}, 100%)"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="bar reveal">
        {#if destructive}
          <Button
            variant="ghost"
            tone="danger"
            square
            icon={destructive.icon ?? "del"}
            title={destructive.label}
            aria-label={destructive.label}
            busy={destructive.busy}
            disabled={destructive.disabled}
            onclick={destructive.onclick}
          />
        {/if}

        <span class="gap"></span>

        {#if barExtra}{@render barExtra()}{/if}

        <Button
          variant="ghost"
          square
          icon="cancel"
          title={cancelLabel}
          aria-label={cancelLabel}
          onclick={onCancel}
        />
        {#if onConfirm}
          <Button
            variant={danger ? "danger" : "primary"}
            square
            icon={confirmIcon}
            title={confirmLabel}
            aria-label={confirmLabel}
            {busy}
            {disabled}
            onclick={onConfirm}
          />
        {/if}
      </div>

      <div class="content reveal">
        <div class="body" bind:this={bodyEl}>{@render children?.()}</div>
        <Scrollbar target={bodyEl} />
      </div>
    </div>
  </div>
</div>

<style>
  .over {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
  }
  .stage {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--pad-4);
  }

  /* An app window, not a card: the same surface, rule and radius the main
     window wears, so a dialog reads as a second one of those rather than as a
     different material laid over the first. One width, always — a dialog that
     shrink-wrapped its content changed shape whenever a section unfolded. */
  .win {
    transform-origin: center;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    /* dvh, not vh: a mobile URL bar must not be able to crop the titlebar. */
    max-height: min(calc(100dvh - 2 * var(--pad-4)), 46rem);
    background: var(--window-bg);
    border: var(--panel-line);
    border-radius: var(--radius);
    box-shadow: 0 8px 30px var(--drop);
  }
  .win:focus-visible {
    outline: none;
  }
  .win.danger {
    border-color: var(--danger);
  }

  /* The titlebar. Empty on the left by design: the dialog's name is carried by
     what opened it, and a heading here only ever repeated that. */
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-height: calc(var(--row-h) + var(--pad-2));
    padding: var(--pad-1) var(--pad-2);
    border-bottom: var(--panel-line);
  }
  .win.danger .bar {
    border-bottom-color: var(--danger);
  }
  .gap {
    flex: 1;
  }

  /* The scroll lives on .body alone, so the bar stays put while a long form
     runs under it. Every ancestor needs min-height:0 or the flex chain refuses
     to shrink and the window grows past the viewport instead. */
  .content {
    flex: 1 1 auto;
    display: flex;
    min-height: 0;
    padding: var(--pad-3) var(--pad-3) var(--pad-3) var(--pad-4);
    gap: var(--pad-2);
  }
  .body {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    font-size: var(--fs-md);
    line-height: 1.55;
    overflow: auto;
    scrollbar-width: none;
  }
  .body::-webkit-scrollbar {
    display: none;
  }
</style>
