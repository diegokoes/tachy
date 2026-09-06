<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { Badge, Button, Chip } from "../tui";
  import type { Revision, ViewSummary } from "../types";

  /**
   * Edit history and read counts for one library item. `base` is the collection
   * route ("knowledge" or "reference") — both expose the same three endpoints,
   * because a revision is a revision whichever shelf it sits on.
   */
  let {
    base,
    id,
    version,
    canEdit = false,
    onReverted,
  }: {
    base: "knowledge" | "reference";
    id: string;
    version?: number;
    canEdit?: boolean;
    onReverted?: () => void;
  } = $props();

  let revisions = $state<Revision[]>([]);
  let views = $state<ViewSummary | null>(null);
  let openVersion = $state<number | null>(null);
  let snapshots = $state<Record<number, Record<string, unknown>>>({});
  let error = $state<string | null>(null);
  let reverting = $state<number | null>(null);

  /** Re-fetched whenever the item's version moves, so an edit shows up at once. */
  $effect(() => {
    void id;
    void version;
    load();
  });

  onMount(load);

  async function load() {
    try {
      [revisions, views] = await Promise.all([
        api.get<Revision[]>(`/${base}/${id}/revisions`),
        api.get<ViewSummary>(`/${base}/${id}/views`),
      ]);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function toggle(v: number) {
    if (openVersion === v) {
      openVersion = null;
      return;
    }
    openVersion = v;
    if (snapshots[v]) return;
    try {
      const rev = await api.get<{ snapshot: Record<string, unknown> }>(
        `/${base}/${id}/revisions/${v}`,
      );
      snapshots[v] = rev.snapshot;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function revert(v: number) {
    reverting = v;
    error = null;
    try {
      await api.post(`/${base}/${id}/revert/${v}`, {});
      onReverted?.();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      reverting = null;
    }
  }

  const who = (r: Revision) =>
    r.user_name || r.user_email || (r.user_id ? "someone" : "unattributed");

  /** The door, not the person — an agent edit is still made by a human. */
  const doorTone = (actor: string) =>
    actor === "agent" ? "warn" : actor === "web" ? "ok" : "muted";

  const when = (ts: string) => new Date(ts).toLocaleString();

  const show = (v: unknown): string =>
    v == null
      ? "—"
      : Array.isArray(v)
        ? v.join(", ") || "—"
        : typeof v === "object"
          ? JSON.stringify(v, null, 2)
          : String(v);
</script>

<section class="history">
  <h3>History</h3>

  {#if views}
    <p class="reads">
      <strong>{views.views}</strong>
      {views.views === 1 ? "read" : "reads"}
      {#if views.viewers}
        by <strong>{views.viewers}</strong>
        {views.viewers === 1 ? "person" : "people"}
      {/if}
      {#if views.last_viewed_at}
        · last {when(views.last_viewed_at)}
      {/if}
    </p>
  {/if}

  {#if error}
    <p class="err">{error}</p>
  {/if}

  {#if revisions.length}
    <ul class="revs">
      {#each revisions as r (r.version)}
        <li>
          <button class="rev-head" onclick={() => toggle(r.version)}>
            <span class="v">v{r.version}</span>
            <Badge tone={doorTone(r.actor)}>{r.actor}</Badge>
            <span class="who">{who(r)}</span>
            <span class="at">{when(r.created_at)}</span>
            {#if r.changed_fields.length}
              <span class="fields">
                {#each r.changed_fields as f}<Chip>{f}</Chip>{/each}
              </span>
            {:else}
              <span class="muted sm">created</span>
            {/if}
          </button>

          {#if openVersion === r.version}
            <div class="snap">
              {#if snapshots[r.version]}
                <dl>
                  {#each r.changed_fields.length ? r.changed_fields : Object.keys(snapshots[r.version]) as key}
                    <dt>{key}</dt>
                    <dd>{show(snapshots[r.version][key])}</dd>
                  {/each}
                </dl>
                {#if canEdit && r.version !== version}
                  <Button
                    variant="ghost"
                    busy={reverting === r.version}
                    onclick={() => revert(r.version)}
                  >
                    restore this version
                  </Button>
                {/if}
              {:else}
                <p class="muted sm">Loading…</p>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">
      No history recorded. This item predates version tracking. The next edit
      starts it.
    </p>
  {/if}
</section>

<style>
  .history h3 {
    margin: 0 0 0.4rem;
  }
  .reads {
    margin: 0 0 0.6rem;
    font-size: 0.9em;
    opacity: 0.85;
  }
  .revs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .rev-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.3rem 0.4rem;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .rev-head:hover {
    border-left-color: currentColor;
    background: color-mix(in srgb, currentColor 6%, transparent);
  }
  .v {
    min-width: 2.5rem;
    opacity: 0.7;
  }
  .who {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .at {
    opacity: 0.6;
    font-size: 0.85em;
  }
  .fields {
    display: flex;
    gap: 0.2rem;
    flex-wrap: wrap;
  }
  .snap {
    padding: 0.4rem 0.4rem 0.6rem 3rem;
  }
  .snap dl {
    margin: 0 0 0.5rem;
    display: grid;
    grid-template-columns: minmax(6rem, auto) 1fr;
    gap: 0.2rem 0.8rem;
  }
  .snap dt {
    opacity: 0.6;
  }
  .snap dd {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .err {
    color: var(--bad, crimson);
  }
  .muted {
    opacity: 0.6;
  }
  .sm {
    font-size: 0.85em;
  }
</style>
