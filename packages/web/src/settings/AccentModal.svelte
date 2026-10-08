<script lang="ts">
  import {
    themeState as th,
    isHexColor,
    selectAccent,
  } from "../theme/theme.svelte";
  import { Checkbox, Field, Modal } from "../tui";

  let { onclose }: { onclose: () => void } = $props();

  let first = $state(th.accentColor);
  let second = $state(th.accentColor2 ?? th.accentColor);
  let gradient = $state(th.accentColor2 !== null);

  const valid = $derived(
    isHexColor(first) && (!gradient || isHexColor(second)),
  );
  const preview = $derived.by(() => {
    if (!valid) return "transparent";
    return gradient ? `linear-gradient(90deg, ${first}, ${second})` : first;
  });

  function save() {
    if (!valid) return;
    selectAccent(first.toLowerCase(), gradient ? second.toLowerCase() : null);
    onclose();
  }
</script>

{#snippet color(label: string, get: () => string, set: (v: string) => void)}
  <Field {label} error={isHexColor(get()) ? null : "six hex digits, #rrggbb"}>
    <span class="pick">
      <!-- The native picker rejects anything but #rrggbb, so it is only fed a
           value once the text beside it is one. -->
      <input
        type="color"
        aria-label="{label} picker"
        value={isHexColor(get()) ? get().toLowerCase() : "#000000"}
        oninput={(e) => set(e.currentTarget.value)}
      />
      <input
        type="text"
        class="hex"
        aria-label="{label} hex"
        spellcheck="false"
        maxlength="7"
        value={get()}
        oninput={(e) => set(e.currentTarget.value.trim())}
      />
    </span>
  </Field>
{/snippet}

<Modal
  title="custom accent"
  width="26rem"
  confirmLabel="save"
  disabled={!valid}
  onConfirm={save}
  onCancel={onclose}
>
  <div class="form">
    <div class="preview" style="background: {preview}" aria-hidden="true"></div>

    {@render color(
      gradient ? "from" : "color",
      () => first,
      (v) => (first = v),
    )}

    <label class="opt">
      <Checkbox bind:checked={gradient} ariaLabel="gradient of two colors" />
      <span>gradient of two colors</span>
    </label>

    {#if gradient}
      {@render color(
        "to",
        () => second,
        (v) => (second = v),
      )}
    {/if}
  </div>
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
  }
  .preview {
    height: var(--row-h);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .pick input[type="color"] {
    flex: none;
    width: var(--row-h);
    height: var(--row-h);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: none;
    cursor: pointer;
  }
  .hex {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--font-mono);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    cursor: pointer;
  }
</style>
