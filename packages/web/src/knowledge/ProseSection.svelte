<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { LinkTargets } from "../wiki/wikilinks.svelte";
  import {
    shownSelection,
    sourceSpan,
    type SourceSpan,
  } from "../markdown/source";
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

  /** Where `field-sizing` is missing, the editor is grown by script. */
  function fitHeight() {
    if (!field || CSS.supports("field-sizing", "content")) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }

  async function startEditing(span?: SourceSpan) {
    editing = true;
    await tick();
    if (!field) return;
    if (span) field.setSelectionRange(span.start, span.end);
    field.focus({ preventScroll: true });
  }

  /**
   * A press on the text edits it once released, with the caret where it was
   * or the dragged-over words selected. A press on a link follows the link.
   */
  function onTextPress(e: PointerEvent) {
    if (!onchange || e.button !== 0 || (e.target as Element).closest("a"))
      return;
    const shown = e.currentTarget as HTMLElement;
    const release = () => {
      const picked = shownSelection(shown, window.getSelection());
      void startEditing(picked ? sourceSpan(text, picked) : undefined);
    };
    window.addEventListener("pointerup", release, { once: true });
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
        rows="1"
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
        <button class="start" type="button" onclick={() => startEditing()}
          >edit {label}</button
        >
      {/if}
      <!-- svelte-ignore a11y_click_events_have_key_events -- links are focusable
           anchors, and the hidden button before it is the keyboard's way in -->
      <!-- svelte-ignore a11y_no_static_element_interactions -- a delegation
           wrapper; a press is a shortcut for that button -->
      <div
        class="md prose"
        class:frame={Boolean(onchange)}
        onclick={links.onClick}
        onpointerdown={onTextPress}
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
    /* No reach upward: the heading's margin stays as room under its rule. */
    margin: 0 calc(-1 * var(--reach-x)) calc(-1 * var(--reach-y));
    padding: var(--reach-y) var(--reach-x);
    border: 0;
    border-radius: var(--radius-control);
    line-height: 1.6;
  }
  /* Blocks sit where their markdown does in the editor: one blank line
     apart, list numbers and dashes inline at the text's own edge. */
  .md > :global(*) {
    margin-block: 0;
  }
  .md > :global(* + *) {
    margin-block-start: 1lh;
  }
  .md :global(:is(ol, ul)) {
    padding-left: 0;
    list-style-position: inside;
  }
  .md :global(ul) {
    list-style-type: "- ";
  }
  .md :global(li > p) {
    display: inline;
  }
  /* A loose list, its items written a blank line apart, keeps that line. */
  .md :global(li:has(> p) + li) {
    margin-block-start: 1lh;
  }
  .md :global(li :is(ol, ul)) {
    padding-left: 2ch;
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
    field-sizing: content;
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
