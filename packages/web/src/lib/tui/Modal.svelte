<script lang="ts" module>
  import { scrollport } from "../scrollport.svelte";

  /* Dialogs stack. Escape and Enter reach the topmost one only, and only the
     topmost one is in view: a dialog it covers folds away, or, where the caller
     asks, stays and sinks into the blur with the app. */
  const stack = $state<symbol[]>([]);

  /* One lock for the whole stack, taken by the first dialog and handed back by
     the last, whichever order they close in.

     Both boxes, because the body is not what scrolls here: the view scrolls
     inside `main`, so locking the body alone left the page running under the
     dialog. Locking it anyway still matters on the surfaces that do. */
  let unlock: (() => void) | null = null;

  function enter(id: symbol) {
    if (!stack.length) {
      const port = scrollport();
      const body = document.body.style.overflow;
      const ported = port?.style.overflow ?? "";
      document.body.style.overflow = "hidden";
      if (port) port.style.overflow = "hidden";
      document.documentElement.toggleAttribute("data-dialog", true);
      unlock = () => {
        document.body.style.overflow = body;
        if (port) port.style.overflow = ported;
        document.documentElement.toggleAttribute("data-dialog", false);
      };
    }
    stack.push(id);
  }

  function leave(id: symbol) {
    const i = stack.indexOf(id);
    if (i < 0) return;
    stack.splice(i, 1);
    if (!stack.length) {
      unlock?.();
      unlock = null;
    }
  }
</script>

<script lang="ts">
  import { onMount, tick, type Snippet } from "svelte";
  import { unfold, type Unfolding } from "../motion";
  import Scrollbar from "../Scrollbar.svelte";
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
    whenCovered = "hide",
    onConfirm,
    onOpened,
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
    /** The dialog's visible surface, for a caller that has to draw against it. */
    element?: HTMLElement;
    /** A dialog opened on top folds this one away, unless it has to stay in view. */
    whenCovered?: "hide" | "blur";
    onConfirm?: () => void;
    /** The window has finished unfolding. */
    onOpened?: () => void;
    onCancel: () => void;
    /** Extra bar actions, left of cancel. */
    barExtra?: Snippet;
    children?: Snippet;
  } = $props();

  let win = $state<HTMLElement>();
  let plate = $state<HTMLElement>();
  $effect(() => {
    element = plate;
  });
  let bodyEl = $state<HTMLElement>();
  let bar = $state<HTMLElement>();
  let content = $state<HTMLElement>();
  let scrim = $state<HTMLElement>();

  const me = Symbol();
  const top = $derived(stack.at(-1) === me);
  const covered = $derived(!top && stack.includes(me));

  let motion: Unfolding | undefined;
  let released = false;
  /* Read before the children mount: one that autofocuses its first field
     would otherwise be what focus goes back to. */
  const restore = document.activeElement as HTMLElement | null;

  /* Leaves the stack as soon as the close starts, not when the node goes, so
     the dialog underneath comes back while this one is still folding. Focus
     waits a tick for that dialog to be interactive again. */
  function release() {
    if (released) return;
    released = true;
    leave(me);
    void tick().then(() => {
      if (restore?.isConnected) restore.focus?.();
    });
  }

  function fold(node: HTMLElement) {
    node.style.pointerEvents = "none";
    release();
    return { duration: motion?.close() ?? 0 };
  }

  /* A click is dismissal only when the press also began on the stage. A select
     option that hangs past the dialog's edge closes its panel on pointerdown, so
     the release lands on the stage and the browser fires the click there. */
  let pressedStage = false;
  function onStageDown(e: PointerEvent) {
    pressedStage = e.target === e.currentTarget;
  }
  function onStageClick(e: MouseEvent) {
    if (pressedStage && e.target === e.currentTarget) onCancel();
    pressedStage = false;
  }

  const FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  onMount(() => {
    enter(me);
    if (win && plate && bar && content && scrim) {
      motion = unfold({ win, plate, parts: [bar, content], scrim });
      motion.open(() => onOpened?.());
    }
    win?.focus();

    return () => {
      motion?.kill();
      release();
    };
  });

  $effect(() => {
    if (released) return;
    if (covered) motion?.cover(whenCovered);
    else motion?.uncover();
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

<div class="over" use:portal inert={covered} out:fold>
  <Scrim onclick={onCancel} bind:element={scrim} />

  <div
    class="stage"
    role="presentation"
    onpointerdown={onStageDown}
    onclick={onStageClick}
  >
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
      <div class="plate" bind:this={plate} aria-hidden="true"></div>

      <div class="bar" bind:this={bar}>
        <div class="side">
          {#if destructive}
            <Button
              variant="ghost"
              tone="danger"
              square
              icon={destructive.icon ?? "delete"}
              morph
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
            icon="close"
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

      <div class="content" bind:this={content}>
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
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    /* dvh, not vh: a mobile URL bar must not be able to crop the titlebar. */
    max-height: min(calc(100dvh - 2 * var(--pad-4)), 46rem);
    border: var(--panel-line-w) solid transparent;
    border-radius: var(--radius);
  }
  .win:focus-visible {
    outline: none;
  }
  /* The surface lives on its own layer so the unfold can morph it separately
     from the contents it sits under. The shadow rides on it, so it takes the
     blob's shape instead of outlining a window that is not there yet. */
  .plate {
    position: absolute;
    inset: calc(-1 * var(--panel-line-w));
    z-index: -1;
    background: var(--dialog-bg);
    border: var(--panel-line);
    border-radius: var(--radius);
    box-shadow: 0 8px 30px var(--drop);
  }
  .win.danger .plate {
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
