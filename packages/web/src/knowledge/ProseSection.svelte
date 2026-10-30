<script lang="ts">
  import { tick, untrack } from "svelte";
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

{#if onchange || text.trim()}
  <EntrySection {label} {unsaved} active={editing}>
    {#if editing && onchange}
      <textarea
        class="frame"
        bind:this={field}
        value={text}
        aria-label={label}
        oninput={(e) => {
          onchange(e.currentTarget.value);
          fitHeight();
        }}
        onblur={() => (editing = false)}></textarea>
    {:else}
      {#if onchange}
        <button class="start" type="button" onclick={startEditing}
          >edit {label}</button
        >
      {/if}
      <!-- svelte-ignore a11y_click_events_have_key_events -- links are focusable
           anchors, and the hidden button before it is the keyboard's way in -->
      <!-- svelte-ignore a11y_no_static_element_interactions -- a delegation
           wrapper; a click is a shortcut for that button -->
      <div
        class="md prose"
        class:frame={Boolean(onchange)}
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
  /* Text and editor share one box: the frame reaches out by the margin it
     pads back in, so nothing moves when one becomes the other, and the
     highlight is a shadow, which takes no room. */
  .frame {
    --reach-x: var(--pad-3);
    --reach-y: var(--pad-2);
    display: block;
    box-sizing: border-box;
    width: calc(100% + 2 * var(--reach-x));
    min-height: calc(1lh + 2 * var(--reach-y));
    margin: calc(-1 * var(--reach-y)) calc(-1 * var(--reach-x));
    padding: var(--reach-y) var(--reach-x);
    border: 0;
    border-radius: var(--radius-control);
    line-height: 1.6;
  }
  /* Paragraph spacing stays between paragraphs; the frame owns the edges. */
  .md > :global(:first-child) {
    margin-top: 0;
  }
  .md > :global(:last-child) {
    margin-bottom: 0;
  }
  div.frame {
    cursor: text;
  }
  div.frame:hover {
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .start:focus-visible + div.frame {
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  textarea.frame {
    overflow: hidden;
    resize: none;
    font: inherit;
    line-height: 1.6;
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
    box-shadow: inset 0 0 0 1px var(--accent);
    outline: none;
  }
  /* Reachable by tab and read out, but drawn as the frame around the text. */
  .start {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .problem {
    margin: var(--pad-2) 0 0;
    font-size: var(--fs-xs);
    color: var(--danger);
  }
</style>
