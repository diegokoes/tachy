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

  /**
   * A click on the text edits it, except on a link, which is followed, and at
   * the end of a drag that selected some of it to copy.
   */
  function onTextClick(e: MouseEvent) {
    links.onClick(e);
    if (!onchange || (e.target as Element).closest("a")) return;
    if (window.getSelection()?.toString()) return;
    void startEditing();
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
      <!-- svelte-ignore a11y_click_events_have_key_events -- links are focusable
           anchors, and the edit button is the keyboard's way in -->
      <!-- svelte-ignore a11y_no_static_element_interactions -- a delegation
           wrapper; a click is a shortcut for the edit button -->
      <div
        class="md prose"
        class:blank={!text.trim()}
        class:editable={Boolean(onchange)}
        onclick={onTextClick}
        onkeydown={links.onKeydown}
      >
        {@html render(text)}
      </div>
    {/if}
    {#if problem}<p class="problem">{problem}</p>{/if}
  </EntrySection>
{/if}

<style>
  /* Text and editor sit on one left edge: the editor's frame and the hover
     frame both reach out by the editor's padding and border. */
  textarea,
  .editable {
    --reach: calc(var(--pad-3) + 1px);
  }
  textarea {
    display: block;
    box-sizing: border-box;
    width: calc(100% + 2 * var(--reach));
    margin: 0 calc(-1 * var(--reach));
    min-height: 3lh;
    overflow: hidden;
    resize: none;
    font: inherit;
    line-height: 1.6;
    color: var(--text);
  }
  .editable {
    margin: 0 calc(-1 * var(--reach));
    padding: 0 var(--reach);
    border-radius: var(--radius-control);
    cursor: text;
  }
  .editable:hover {
    box-shadow: inset 0 0 0 1px var(--border);
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
