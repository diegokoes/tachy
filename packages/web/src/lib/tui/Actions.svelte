<script lang="ts">
  import Button from "./Button.svelte";
  import type { IconName } from "./icons";

  type Act = {
    label: string;
    onclick: () => void;
    disabled?: boolean;
    busy?: boolean;
    /** Overrides the slot's default icon. */
    icon?: IconName;
  };

  let {
    destructive,
    back,
    cancel,
    primary,
    primaryVariant = "primary",
    iconOnly = false,
    iconSize,
    bindKeys = false,
  }: {
    destructive?: Act;
    back?: Act;
    cancel?: Act;
    primary?: Act;
    primaryVariant?: "primary" | "danger" | "ok";
    /** Dialog footers: the mark alone carries it, labelled by `title`. */
    iconOnly?: boolean;
    /** Overrides the mark size of icon-only actions. */
    iconSize?: string;
    bindKeys?: boolean;
  } = $props();

  const dismiss = $derived(cancel ?? back);

  function onKeydown(e: KeyboardEvent) {
    if (!bindKeys) return;
    if (e.key === "Escape" && dismiss && !dismiss.disabled) {
      e.preventDefault();
      dismiss.onclick();
    } else if (
      e.key === "Enter" &&
      (e.metaKey || e.ctrlKey || !(e.target instanceof HTMLTextAreaElement)) &&
      primary &&
      !primary.disabled &&
      !primary.busy
    ) {
      e.preventDefault();
      primary.onclick();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="actions">
  {#if destructive}
    <Button
      variant="danger"
      size="sm"
      icon={destructive.icon ?? "cancel"}
      disabled={destructive.disabled}
      busy={destructive.busy}
      onclick={destructive.onclick}>{destructive.label}</Button
    >
  {/if}

  <span class="spacer"></span>

  {#if back}
    {#if iconOnly}
      <Button
        variant="ghost"
        square
        icon={back.icon ?? "back"}
        {iconSize}
        disabled={back.disabled}
        title={back.label}
        aria-label={back.label}
        onclick={back.onclick}
      />
    {:else}
      <Button
        size="sm"
        icon={back.icon ?? "back"}
        disabled={back.disabled}
        onclick={back.onclick}>{back.label}</Button
      >
    {/if}
  {/if}

  {#if cancel}
    {#if iconOnly}
      <Button
        variant="ghost"
        square
        icon={cancel.icon ?? "cancel"}
        {iconSize}
        disabled={cancel.disabled}
        title={cancel.label}
        aria-label={cancel.label}
        onclick={cancel.onclick}
      />
    {:else}
      <Button
        variant="ghost"
        size="sm"
        icon={cancel.icon ?? "cancel"}
        disabled={cancel.disabled}
        onclick={cancel.onclick}>{cancel.label}</Button
      >
    {/if}
  {/if}

  {#if primary}
    {#if iconOnly}
      <Button
        variant={primaryVariant}
        square
        icon={primary.icon ?? "save"}
        {iconSize}
        disabled={primary.disabled}
        busy={primary.busy}
        title={primary.label}
        aria-label={primary.label}
        onclick={primary.onclick}
      />
    {:else}
      <Button
        variant={primaryVariant}
        size="sm"
        icon={primary.icon ?? "save"}
        disabled={primary.disabled}
        busy={primary.busy}
        onclick={primary.onclick}>{primary.label}</Button
      >
    {/if}
  {/if}
</div>

<style>
  /* One grammar, everywhere: destructive far left, then back, cancel, primary.
     The primary action is always the rightmost thing on the row. */
  .actions {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
</style>
