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

  .track {
    box-sizing: border-box;
    display: block;
    width: 2.4em;
    height: 1.2em;
    padding: var(--panel-line-w);
    border: var(--panel-line-w) solid var(--border);
    border-radius: var(--radius-chip);
    background: var(--panel-solid);
    transition: border-color 0.2s ease;
  }
  .knob {
    display: block;
    width: 50%;
    height: 100%;
    border-radius: var(--radius-chip);
    background: var(--border);
    transition:
      transform 0.2s ease,
      background 0.2s ease;
  }

  .tgl input:checked + .track {
    border-color: var(--accent);
  }
  .tgl input:checked + .track .knob {
    transform: translateX(100%);
    background: var(--accent);
  }

  .tgl input:focus-visible + .track {
    outline: 1px solid currentColor;
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .track,
    .knob {
      transition: none;
    }
  }
</style>
