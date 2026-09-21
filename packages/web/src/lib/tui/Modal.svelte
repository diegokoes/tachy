<script lang="ts" module>
  /* Dialogs stack. Escape and Enter reach the topmost one only — two open
     dialogs answering the same keypress is what forced callers to close one
     before opening the next. */
  let depth = $state(0);
  const take = () => ++depth;
</script>

<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import Scrollbar from "../Scrollbar.svelte";
  import { scrollport } from "../scrollport.svelte";
  import Scrim from "./Scrim.svelte";
  import { portal } from "./portal";
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
    element = $bindable(),
    onConfirm,
    onCancel,
    barExtra,
    children,
  }: {
    /** The dialog's accessible name, and the label drawn in the titlebar. */
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
    /** The dialog window itself, for a caller that has to draw against it. */
    element?: HTMLElement;
    onConfirm?: () => void;
    onCancel: () => void;
    /** Extra bar actions, left of cancel. */
    barExtra?: Snippet;
    children?: Snippet;
  } = $props();

  let win = $state<HTMLElement>();
  $effect(() => {
    element = win;
  });
  let bodyEl = $state<HTMLElement>();
  let mine = 0;
  const top = $derived(mine === depth);

  const FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  onMount(() => {
    mine = take();
    const restore = document.activeElement as HTMLElement | null;
    /* One lock for the whole stack: the innermost dialog must not release it
       on the way out while an outer one is still open.

       Both boxes, because the body is not what scrolls here — the view scrolls
       inside `main`, so locking the body alone left the page running under the
       dialog. Locking it anyway still matters on the surfaces that do. */
    const port = scrollport();
    const locked = document.body.style.overflow;
    const lockedPort = port?.style.overflow ?? "";
    document.body.style.overflow = "hidden";
    if (port) port.style.overflow = "hidden";
    win?.focus();

    return () => {
      depth--;
      if (depth === 0) {
        document.body.style.overflow = locked;
        if (port) port.style.overflow = lockedPort;
      }
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

<div class="over" use:portal>
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
      <div class="bar">
        <div class="side">
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
        </div>

        <!-- aria-hidden: the window already carries this string as its
             accessible name, and a screen reader should not hear it twice. -->
        <div class="title" aria-hidden="true">{title}</div>

        <div class="side end">
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
      </div>

      <div class="content">
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
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    /* dvh, not vh: a mobile URL bar must not be able to crop the titlebar. */
    max-height: min(calc(100dvh - 2 * var(--pad-4)), 46rem);
    background: var(--dialog-bg);
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

  /* The titlebar: what you are doing, between the buttons that end it. Three
     columns rather than a flex row with a spacer, so the name sits at the
     centre of the window and not at the centre of whatever is left over — the
     two 1fr flanks are equal whether or not a destructive action is present. */
  .bar {
    flex: none;
    display: grid;
    grid-template-columns: 1fr minmax(0, auto) 1fr;
    align-items: center;
    gap: var(--pad-2);
    min-height: calc(var(--row-h) + var(--pad-2));
    padding: var(--pad-1) var(--pad-2);
    border-bottom: var(--panel-line);
  }
  .win.danger .bar {
    border-bottom-color: var(--danger);
  }
  .side {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-width: 0;
  }
  .side.end {
    justify-content: flex-end;
  }
  /* A long name gives up its width before the buttons do. */
  .title {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
    user-select: none;
  }

  /* The scroll lives on .body alone, so the bar stays put while a long form
     runs under it. Every ancestor needs min-height:0 or the flex chain refuses
     to shrink and the window grows past the viewport instead. */
  .content {
    flex: 1 1 auto;
    display: flex;
    min-height: 0;
    padding: var(--pad-4) var(--pad-3) var(--pad-4) var(--pad-4);
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
