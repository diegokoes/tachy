<script lang="ts">
  import { tick } from "svelte";
  import type { WorkItemTypeOption } from "@tachy/contract";
  import { Button, Icon } from "../tui";
  import { router } from "../shell/router.svelte";
  import { ensureTypes, typesNote, typesOf } from "./az.svelte";
  import { typeColor, typeIcon } from "./ado-icons";

  let {
    projectId,
    onpick,
  }: { projectId: string; onpick: (type: WorkItemTypeOption) => void } =
    $props();

  let shown = $state(false);
  let menuEl = $state<HTMLElement>();
  let hostEl = $state<HTMLElement>();

  const types = $derived(typesOf(projectId));

  $effect(() => {
    void router.path;
    shown = false;
  });

  export async function open() {
    shown = true;
    void ensureTypes(projectId);
    await tick();
    menuEl?.querySelector("button")?.focus();
  }

  function close() {
    shown = false;
  }

  function pick(type: WorkItemTypeOption) {
    close();
    onpick(type);
  }

  function step(e: KeyboardEvent) {
    const buttons = [...(menuEl?.querySelectorAll("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const delta = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!delta || !buttons.length) return;
    e.preventDefault();
    buttons[(at + delta + buttons.length) % buttons.length].focus();
  }

  function outside(e: PointerEvent) {
    if (shown && !hostEl?.contains(e.target as Node)) close();
  }
</script>

<svelte:window onpointerdown={outside} />

<div class="host" bind:this={hostEl}>
  <Button
    icon="plus"
    variant="ghost"
    tone="ok"
    size="sm"
    onclick={() => (shown ? close() : open())}>new</Button
  >
  {#if shown}
    <div
      class="menu"
      role="menu"
      tabindex="-1"
      bind:this={menuEl}
      onkeydown={step}
    >
      {#each types as type (type.name)}
        <button role="menuitem" onclick={() => pick(type)}>
          <span class="glyph" style:color={typeColor(type.color) ?? undefined}>
            <Icon name={typeIcon(type.icon)} size="1em" />
          </span>
          {type.name}
        </button>
      {:else}
        <span class="note">{typesNote(projectId)}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .host {
    position: relative;
  }
  .menu {
    position: absolute;
    top: calc(100% + 0.35rem);
    right: 0;
    z-index: 8;
    min-width: 12rem;
    display: flex;
    flex-direction: column;
    padding: 0.25rem;
    background: var(--panel-solid);
    border: 1px solid var(--accent);
    border-radius: 6px;
  }
  button {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.55rem;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    outline: none;
    background: var(--accent-dim);
  }
  .glyph {
    display: inline-flex;
    color: var(--muted);
  }
  .note {
    padding: 0.35rem 0.55rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
