<script lang="ts">
  let {
    onclick,
    soft = false,
    z,
  }: {
    onclick?: () => void;
    /** Something else lays its own scrim on top: go quiet, keep the blur. */
    soft?: boolean;
    /** For surfaces on a local stacking order rather than --z-overlay. */
    z?: number;
  } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="scrim"
  class:soft
  role="presentation"
  style={z === undefined ? undefined : `z-index: ${z}`}
  {onclick}
></div>

<style>
  /* The blur is the whole point: it is what puts the app on a plane behind
     whatever is in front of it. Ink alone leaves the text underneath legible
     through the gap, which reads as a dirty window rather than as depth. */
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim-ink);
    backdrop-filter: blur(var(--scrim-blur));
    -webkit-backdrop-filter: blur(var(--scrim-blur));
    animation: scrim-in 0.14s ease both;
  }
  .scrim.soft {
    background: var(--scrim-soft);
  }

  @keyframes scrim-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scrim {
      animation: none;
    }
  }
</style>
