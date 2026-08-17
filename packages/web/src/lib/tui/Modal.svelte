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
  let fit = $state<HTMLElement>();

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

  /* The panel is only as wide as it needs to be and sits centred, so content
     that unfolds mid-form (an output spec, an extra section) widens it from
     both edges instead of snapping to a new width. */
  onMount(() => {
    const el = fit;
    if (!el || reducedMotion()) return;
    let last = el.offsetWidth;
    let tweening = false;
    const ro = new ResizeObserver(() => {
      if (tweening) return;
      const now = el.offsetWidth;
      if (Math.abs(now - last) < 2) return;
      const from = last;
      last = now;
      tweening = true;
      // Our own width writes must not feed back into the observer.
      ro.unobserve(el);
      gsap.fromTo(
        el,
        { width: from, overflow: "hidden" },
        {
          width: now,
          duration: 0.22,
          ease: "power2.out",
          onComplete: () => {
            gsap.set(el, { clearProps: "width,overflow" });
            last = el.offsetWidth;
            tweening = false;
            ro.observe(el);
          },
        },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
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
    <div class="fit" bind:this={fit}>
      <Panel {title} tone={danger ? "danger" : "default"} scan>
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
      </Panel>
    </div>
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

  /* The declared width is a ceiling, not a shape: a short form stays narrow and
     centred, a full one grows out to both edges. */
  .wrap {
    transform-origin: center;
    max-height: calc(100vh - 2 * var(--pad-4));
    display: flex;
    justify-content: center;
  }
  .fit {
    display: flex;
    min-width: 0;
    max-width: 100%;
  }

  .body {
    font-size: var(--fs-md);
    line-height: 1.55;
    overflow: auto;
  }
  .acts {
    margin-top: var(--pad-4);
  }
</style>
