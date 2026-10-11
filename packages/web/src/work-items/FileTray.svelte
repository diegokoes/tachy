<script lang="ts">
  import type { WorkItemFile } from "@tachy/contract";
  import { Icon, Panel } from "../tui";
  import { fileDetails, fileHref, isPicture } from "./files";

  let { files }: { files: WorkItemFile[] } = $props();
</script>

<div class="wrap">
  <Panel title="files on the ticket">
    {#snippet meta()}
      <span>{files.length}</span>
    {/snippet}
    <ul>
      {#each files as file, index (index)}
        {@const href = fileHref(file)}
        {@const picture = isPicture(file)}
        <li>
          {#if href && picture}
            <a class="thumb" {href} target="_blank" rel="noopener">
              <img src={`${href}?thumb=1`} alt={file.name} loading="lazy" />
            </a>
          {:else}
            <span class="mark">
              <Icon name={picture ? "image" : "file"} size="1.1em" />
            </span>
          {/if}
          <span class="what">
            {#if href}
              <a {href} target="_blank" rel="noopener">{file.name}</a>
            {:else}
              <span>{file.name}</span>
            {/if}
            <span class="details">{fileDetails(file)}</span>
          </span>
        </li>
      {/each}
    </ul>
  </Panel>
</div>

<style>
  .wrap {
    max-width: 46rem;
    margin: var(--pad-2) 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
  }
  .thumb,
  .mark {
    flex: none;
    width: 4rem;
    display: flex;
    justify-content: center;
  }
  .thumb img {
    max-width: 4rem;
    max-height: 3rem;
    border: 1px solid var(--line, currentColor);
  }
  .what {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .what a,
  .what > span:first-child {
    overflow-wrap: anywhere;
  }
  .details {
    opacity: 0.7;
    font-size: 0.85em;
  }
</style>
