<script lang="ts">
  import Icon from "./Icon.svelte";

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

<span class="checkbox" class:checked class:disabled>
  <span class="fill" aria-hidden="true"></span>
  <Icon name="checkbox" size="1.35em" weight={6} />
  <input
    type="checkbox"
    bind:checked
    {disabled}
    aria-label={ariaLabel}
    onchange={(event) => onchange?.(event.currentTarget.checked)}
  />
</span>

<style>
  .checkbox {
    position: relative;
    display: inline-flex;
    flex: none;
    width: 1.35em;
    height: 1.35em;
    align-items: center;
    justify-content: center;
    color: var(--text);
    cursor: pointer;
  }

  .checkbox .fill {
    position: absolute;
    width: 0.8em;
    height: 0.8em;
    border-radius: 50%;
    background: transparent;
  }

  .checkbox.checked .fill {
    background: var(--accent);
  }

  .checkbox.disabled {
    cursor: default;
    opacity: 0.55;
  }

  .checkbox input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: inherit;
  }
</style>
