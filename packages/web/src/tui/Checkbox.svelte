<script lang="ts">
  let {
    checked = $bindable(false),
    disabled = false,
    ariaLabel,
    onchange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    onchange?: (checked: boolean) => void;
  } = $props();
</script>

<!-- The input is wrapped rather than paired by id, so the component stacks in a
     list without needing a unique one. Visually hidden rather than display:none
     because a display:none input cannot take focus. -->
<label class="tgl" class:disabled>
  <input
    type="checkbox"
    bind:checked
    {disabled}
    aria-label={ariaLabel}
    onchange={(event) => onchange?.(event.currentTarget.checked)}
  />
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
</label>

<style>
  .tgl {
    position: relative;
    display: inline-flex;
    flex: none;
    cursor: pointer;
  }
  .tgl.disabled {
    cursor: default;
    opacity: 0.55;
  }

  .tgl input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* The outline is an inset shadow so it stays inside the box: a dialog body
     scrolls, and anything painted outside the element is clipped at its edge. */
  .track {
    box-sizing: border-box;
    display: block;
    width: 2.1em;
    height: 1.1em;
    padding: 0.18em;
    border-radius: var(--radius-chip);
    background: var(--panel-solid);
    box-shadow: inset 0 0 0 1px var(--muted);
    transition:
      box-shadow 0.2s ease,
      background 0.2s ease;
  }
  .knob {
    display: block;
    width: 50%;
    height: 100%;
    border-radius: var(--radius-chip);
    background: var(--muted);
    transition:
      transform 0.2s ease,
      background 0.2s ease;
  }

  .tgl input:checked + .track {
    background: color-mix(in srgb, var(--ok) 16%, var(--panel-solid));
    box-shadow: inset 0 0 0 1px var(--ok);
  }
  .tgl input:checked + .track .knob {
    transform: translateX(100%);
    background: var(--ok);
  }

  .tgl input:focus-visible + .track {
    box-shadow:
      inset 0 0 0 1px var(--accent),
      inset 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    .track,
    .knob {
      transition: none;
    }
  }
</style>
