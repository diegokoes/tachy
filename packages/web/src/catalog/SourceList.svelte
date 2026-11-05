<script lang="ts">
  import type { CustomerProfile } from "@tachy/contract";
  import Group from "../settings/Group.svelte";
  import { Icon } from "../tui";

  let {
    repos,
    projects,
  }: {
    repos: CustomerProfile["repos"];
    projects: CustomerProfile["projects"];
  } = $props();

  const hostOf = (url: string) => new URL(url).host;
</script>

<Group label="repos and projects">
  {#each repos as repo (repo.slug)}
    <div class="item">
      <Icon name="repo" size="1em" />
      {#if repo.url}
        <a class="key" href={repo.url} target="_blank" rel="noopener noreferrer"
          >{repo.slug}</a
        >
        <span class="where">{hostOf(repo.url)}</span>
      {:else}
        <span class="key">{repo.slug}</span>
      {/if}
    </div>
  {/each}
  {#each projects as project (project.source_slug + project.external_key)}
    <div class="item">
      <Icon name="project" size="1em" />
      {#if project.url}
        <a
          class="key"
          href={project.url}
          target="_blank"
          rel="noopener noreferrer">{project.external_key}</a
        >
      {:else}
        <span class="key">{project.external_key}</span>
      {/if}
      <span class="where">{project.source_slug}</span>
    </div>
  {/each}
</Group>

<style>
  .item {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-1) 0;
  }
  .key {
    font-family: var(--font-mono);
  }
  .where {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
</style>
