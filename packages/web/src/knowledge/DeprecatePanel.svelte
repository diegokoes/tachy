<script lang="ts">
  import { api } from "../api";
  import { Field, SearchBox } from "../tui";
  import type { KnowledgeRow } from "./rows";

  let {
    entryId,
    reason = $bindable(),
    supersededBy = $bindable(),
  }: {
    /** Left out of the candidates: an entry cannot replace itself. */
    entryId: string;
    /** Recorded as feedback once the entry is saved as deprecated. */
    reason: string;
    supersededBy: string | null;
  } = $props();

  const SEARCH_DEBOUNCE_MS = 250;
  const CANDIDATE_LIMIT = 5;

  let query = $state("");
  let candidates = $state<KnowledgeRow[]>([]);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  function searchCandidates() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!query.trim()) {
        candidates = [];
        return;
      }
      try {
        const rows = await api.get<KnowledgeRow[]>(
          `/knowledge/search?q=${encodeURIComponent(query)}&limit=${CANDIDATE_LIMIT}`,
        );
        candidates = rows.filter((row) => row.id !== entryId);
      } catch {
        candidates = [];
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  $effect(() => () => clearTimeout(searchTimer));
</script>

<div class="deprecate">
  <Field label="why it is outdated" info="recorded as feedback">
    <textarea rows="2" bind:value={reason}></textarea>
  </Field>
  <Field label="replaced by" info="optional">
    <SearchBox
      bind:value={query}
      aria-label="find the entry that replaces it"
      oninput={searchCandidates}
    />
  </Field>
  {#if candidates.length}
    <ul class="candidates">
      {#each candidates as candidate (candidate.id)}
        <li>
          <label>
            <input
              type="radio"
              name="supersede"
              checked={supersededBy === candidate.id}
              onchange={() => (supersededBy = candidate.id)}
            />
            {candidate.title}
          </label>
        </li>
      {/each}
      <li>
        <label>
          <input
            type="radio"
            name="supersede"
            checked={supersededBy === null}
            onchange={() => (supersededBy = null)}
          />
          <span class="muted">no replacement</span>
        </label>
      </li>
    </ul>
  {/if}
</div>

<style>
  .deprecate {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    margin: var(--pad-3) 0;
    padding: var(--pad-3);
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    text-align: left;
  }
  textarea {
    font: inherit;
    color: var(--text);
  }
  .candidates {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  label {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .muted {
    color: var(--muted);
  }
</style>
