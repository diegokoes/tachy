<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { gsap, reducedMotion } from "../gsap";
  import Panel from "./Panel.svelte";
  import Actions from "./Actions.svelte";
  import type { IconName } from "./icons";

  let {
    title = "confirm",
    confirmLabel = "confirm",
    confirmIcon = "save",
    cancelLabel = "cancel",
    danger = false,
    busy = false,
    disabled = false,
    width = "34rem",
    onConfirm,
    onCancel,
    children,
  }: {
    title?: string;
    confirmLabel?: string;
    /** The footer is icon-only, so a confirm that isn't a save must say so. */
    confirmIcon?: IconName;
    cancelLabel?: string;
    danger?: boolean;
    busy?: boolean;
    disabled?: boolean;
    width?: string;
    onConfirm?: () => void;
    onCancel: () => void;
    children?: Snippet;
  } = $props();

  let box = $state<HTMLElement>();

  /* One move: the box unfolds and its content comes up with it. A brightness
     ramp over the whole panel blows out the text and the accent on the way in,
     which on a form full of fields reads as a colour glitch, not a CRT. */
  onMount(() => {
    if (!box || reducedMotion()) return;
    const reveal = box.querySelectorAll<HTMLElement>(".reveal");
    const tl = gsap
      .timeline()
      .from(box, {
        scaleY: 0.06,
        autoAlpha: 0,
        duration: 0.17,
        ease: "power3.out",
      })
      .from(reveal, { autoAlpha: 0, duration: 0.13, ease: "none" }, "<0.06");
    return () => tl.kill();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
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

<div class="overlay" role="presentation" onclick={onCancel}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="wrap"
    bind:this={box}
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    style="width: min({width}, 100%)"
    onclick={(e) => e.stopPropagation()}
  >
    <Panel {title} tone={danger ? "danger" : "default"} scan grow>
      <div class="stack">
        <div class="body reveal">{@render children?.()}</div>
        <div class="acts reveal">
          <Actions
            cancel={{ label: cancelLabel, onclick: onCancel }}
            primary={onConfirm
              ? {
                  label: confirmLabel,
                  icon: confirmIcon,
                  onclick: onConfirm,
                  busy,
                  disabled,
                }
              : undefined}
            primaryVariant={danger ? "danger" : "primary"}
            iconOnly
          />
        </div>
      </div>
    </Panel>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--pad-4);
    background: color-mix(in srgb, var(--bg) 74%, transparent);
    animation: fade 0.14s ease both;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* One width, always — a dialog that shrink-wrapped its content changed shape
     whenever a section unfolded mid-form. */
  .wrap {
    transform-origin: center;
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 2 * var(--pad-4));
    min-width: 0;
    min-height: 0;
  }

  /* The scroll lives on .body alone, so the footer stays put while a long form
     scrolls under it. Every ancestor needs min-height:0 or the flex chain
     refuses to shrink and the panel grows past the viewport instead. */
  .stack {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    font-size: var(--fs-md);
    line-height: 1.55;
    overflow: auto;
  }
  .acts {
    flex: none;
    margin-top: var(--pad-4);
  }
</style>
