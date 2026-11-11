<script lang="ts">
  import type { ProposalRow, ReviewQueue } from "@tachy/contract";
  import { api } from "../api";
  import EntryDetail from "../knowledge/EntryDetail.svelte";
  import { libraryTabPath, libraryTabs } from "../library/tabs";
  import { errText } from "../resource.svelte";
  import { isCurator } from "../access/session.svelte";
  import { navigate, segment } from "../shell/router.svelte";
  import { setSubnav, setTopActions } from "../shell/subnav.svelte";
  import { showCustomer } from "../terms";
  import { Button, EmptyState, Note } from "../tui";
  import { landingScope, loadWikis, wikis } from "../wiki/wikis.svelte";
  import ProposalDetail from "./ProposalDetail.svelte";
  import ProposalList from "./ProposalList.svelte";
  import { firstReviewPath, proposalPath, reviewGroups } from "./queue";
  import SignalDetail from "./SignalDetail.svelte";
  import { loadReviewCounts, reviewTotal } from "./review.svelte";

  const WIKI_TABS = ["wiki", "gaps"];

  const SIGNALS_SEGMENT = "signals";

  const onSignal = $derived(segment(1) === SIGNALS_SEGMENT);
  const selectedId = $derived(onSignal ? undefined : segment(1));
  const editing = $derived(segment(2) === "edit");

  let queue = $state.raw<ReviewQueue>({
    proposals: [],
    drafts: [],
    signals: [],
  });
  let rescanning = $state(false);
  let mine = $state.raw<ProposalRow[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  /** The proposal a reviewer is changing before accepting it. */
  let accepting = $state.raw<ProposalRow | null>(null);

  const groups = $derived(reviewGroups(queue, mine));
  const selectedSignal = $derived(
    onSignal ? queue.signals.find((signal) => signal.id === segment(2)) : null,
  );

  async function load() {
    try {
      [queue, mine] = await Promise.all([
        api.get<ReviewQueue>("/review/queue"),
        // A session with no account has proposed nothing.
        api.get<ProposalRow[]>("/review/mine").catch(() => []),
      ]);
      error = null;
    } catch (e) {
      error = errText(e);
    }
    loaded = true;
    void loadReviewCounts();
  }

  async function openTab(tab: string) {
    if (WIKI_TABS.includes(tab) && !wikis.loaded) await loadWikis();
    navigate(libraryTabPath(tab, landingScope()));
  }

  $effect(() =>
    setSubnav({
      items: libraryTabs({
        customers: showCustomer(),
        waiting: reviewTotal(),
      }),
      active: "review",
      onpick: (tab) => void openTab(tab),
    }),
  );

  $effect(() => void load());

  // A signal settled or resolved since the list loaded leaves nothing to show.
  $effect(() => {
    if (!loaded || selectedId || selectedSignal) return;
    const first = firstReviewPath(groups);
    if (first) navigate(first, { replace: true });
  });

  async function rescan() {
    rescanning = true;
    try {
      await api.post("/review/signals/rescan", {});
      await load();
    } catch (e) {
      error = errText(e);
    } finally {
      rescanning = false;
    }
  }

  // Given up while the entry page is open on a proposal: its actions hold the row.
  $effect(() => {
    if (!editing) return setTopActions(actions);
  });

  $effect(() => {
    const id = editing ? selectedId : undefined;
    accepting = null;
    if (!id) return;
    api
      .get<ProposalRow>(`/review/proposals/${id}`)
      .then((proposal) => (accepting = proposal))
      .catch((e) => (error = errText(e)));
  });

  function closeEditing() {
    if (selectedId) navigate(proposalPath(selectedId));
  }
</script>

<!-- Rendered by App into the carved row beside the subnav, not here. -->
{#snippet actions()}
  {#if isCurator()}
    <Button
      variant="ghost"
      size="sm"
      icon="refresh"
      busy={rescanning}
      onclick={rescan}>rescan</Button
    >
  {/if}
{/snippet}

{#if editing}
  {#if accepting}
    <EntryDetail
      id={accepting.knowledge_entry_id}
      {accepting}
      onClose={closeEditing}
      onAccepted={() => {
        closeEditing();
        void load();
      }}
    />
  {:else if error}
    <Note tone="danger">{error}</Note>
  {/if}
{:else}
  <div class="review">
    {#if error}<Note tone="danger">{error}</Note>{/if}
    {#if groups.length}
      <div class="panes">
        <ProposalList {groups} />
        {#if selectedSignal}
          {#key selectedSignal.id}
            <SignalDetail signal={selectedSignal} onChanged={load} />
          {/key}
        {:else if selectedId}
          {#key selectedId}
            <ProposalDetail id={selectedId} onChanged={load} />
          {/key}
        {/if}
      </div>
    {:else if loaded && !error}
      <EmptyState art="complete" title="nothing waits for review" />
    {/if}
  </div>
{/if}

<style>
  .panes {
    display: grid;
    grid-template-columns: minmax(16rem, 24rem) minmax(0, 1fr);
    gap: calc(var(--pad-4) * 2);
    align-items: start;
  }
  @media (max-width: 60rem) {
    .panes {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
