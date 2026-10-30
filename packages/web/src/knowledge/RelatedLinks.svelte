<script lang="ts">
  import { RELATED_LINK_HINT, isRelatedLink } from "@tachy/contract";
  import { Button } from "../tui";

  let {
    links,
    onchange,
  }: {
    links: string[];
    /** Makes the list editable: a link can be removed, and one added. */
    onchange?: (links: string[]) => void;
  } = $props();

  let typed = $state("");
  let refused = $state(false);

  function addTyped() {
    const link = typed.trim();
    if (!link) return;
    refused = !isRelatedLink(link);
    if (refused) return;
    typed = "";
    if (!links.includes(link)) onchange?.([...links, link]);
  }
</script>

<ul class="related">
  {#each links as link, i}
    <li>
      <a href={link} target="_blank" rel="noopener noreferrer">{link}</a>
      {#if onchange}
        <Button
          variant="ghost"
          size="sm"
          square
          icon="close"
          title="remove"
          onclick={() => onchange(links.filter((_, at) => at !== i))}
        />
      {/if}
    </li>
  {/each}
</ul>
{#if onchange}
  <span class="add">
    <span class="plus" aria-hidden="true">+</span>
    <input
      aria-label="add a related link"
      aria-invalid={refused}
      bind:value={typed}
      oninput={() => (refused = false)}
      onblur={addTyped}
      onkeydown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        addTyped();
      }}
    />
  </span>
  {#if refused}<p class="refused">{RELATED_LINK_HINT}</p>{/if}
{/if}

<style>
  .related {
    margin: 0;
    padding-left: 1.25rem;
    font-size: var(--fs-sm);
  }
  .related a {
    color: var(--accent);
    word-break: break-all;
  }
  .add {
    display: flex;
    align-items: baseline;
    gap: var(--pad-1);
    margin-top: var(--pad-1);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .add input {
    flex: 1;
    padding: 0;
    font: inherit;
    color: var(--text);
    background: none;
    border: none;
    border-bottom: 1px dotted var(--border);
  }
  .add input:focus {
    outline: none;
    border-bottom-color: var(--accent);
  }
  .add input[aria-invalid="true"] {
    border-bottom-color: var(--danger);
  }
  .refused {
    margin: var(--pad-1) 0 0;
    font-size: var(--fs-xs);
    color: var(--danger);
  }
</style>
