<script lang="ts">
  import { tick, untrack } from "svelte";
  import { Button } from "../tui";
  import type { LinkTargets } from "../wiki/wikilinks.svelte";
  import EntrySection from "./EntrySection.svelte";

  let {
    label,
    text,
    render,
    links,
    unsaved = false,
    open = false,
    problem,
    onchange,
  }: {
    label: string;
    /** Markdown. */
    text: string;
    render: (text: string) => string;
    /** Follows a wikilink clicked in the rendered text. */
    links: LinkTargets;
    unsaved?: boolean;
    /** Starts as its markdown, the way a new entry's sections do. */
    open?: boolean;
    problem?: string;
    /** Makes the section editable, and shows it while it is empty. */
    onchange?: (text: string) => void;
  } = $props();

  let editing = $state(untrack(() => open));
  let field = $state<HTMLTextAreaElement>();

  function fitHeight() {
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }

  async function startEditing() {
    editing = true;
    await tick();
    field?.focus();
  }

  $effect(() => {
    if (editing) fitHeight();
  });
</script>

{#snippet editButton()}
  <Button
    variant="ghost"
    size="sm"
    square
    icon="edit"
    title="edit {label}"
    onclick={startEditing}
  />
{/snippet}

{#if onchange || text.trim()}
  <EntrySection
    {label}
    {unsaved}
    action={onchange && !editing ? editButton : undefined}
  >
    {#if editing && onchange}
      <textarea
        bind:this={field}
        value={text}
        aria-label={label}
        oninput={(e) => {
          onchange(e.currentTarget.value);
          fitHeight();
        }}
        onblur={() => (editing = false)}></textarea>
    {:else}
      <!-- svelte-ignore a11y_click_events_have_key_events -- handled on the
           focusable wikilink anchors this div delegates to -->
      <!-- svelte-ignore a11y_no_static_element_interactions -- a delegation
           wrapper; double-click is a shortcut for the edit button -->
      <div
        class="md prose"
        class:blank={!text.trim()}
        onclick={links.onClick}
        onkeydown={links.onKeydown}
        ondblclick={onchange ? startEditing : undefined}
      >
        {@html render(text)}
      </div>
    {/if}
    {#if problem}<p class="problem">{problem}</p>{/if}
  </EntrySection>
{/if}

<style>
  textarea {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-height: 3lh;
    overflow: hidden;
    resize: none;
    font: inherit;
    line-height: 1.6;
    color: var(--text);
  }
  .blank {
    min-height: 1.5em;
  }
  .problem {
    margin: var(--pad-1) 0 0;
    font-size: var(--fs-xs);
    color: var(--danger);
  }
</style>
