<script lang="ts">
  import { WIKI_GAP_KINDS, slugify } from "@tachy/contract";
  import type { WikiGapKind } from "@tachy/contract";
  import { api } from "../api";
  import { chat } from "../chatState.svelte";
  import { fmtDate } from "../dates";
  import { createSequence, errText } from "../resource.svelte";
  import { navigate } from "../router.svelte";
  import { isCurator } from "../session.svelte";
  import { setTopActions } from "../subnav.svelte";
  import { Button, EmptyState, Note } from "../tui";
  import type { CoverageNode, WikiGap, WikiGaps, WikiToc } from "../types";
  import CoverageTree from "./CoverageTree.svelte";
  import WikiLayout from "./WikiLayout.svelte";
  import { ORG_WIDE, wikiPath } from "./paths";
  import { loadWikis, seedArticle } from "./wikis.svelte";

  /**
   * What this wiki is missing, as the hourly sweep last found it — the list a
   * curator works down, most pressing kind first. Nothing here is computed on
   * the page: it reads the sweep's table, which is also what the switcher's
   * counts come from.
   */
  let { scope }: { scope: string } = $props();

  let data = $state<WikiGaps | null>(null);
  let toc = $state<WikiToc | null>(null);
  let error = $state<string | null>(null);
  let rescanning = $state(false);
  let acting = $state<string | null>(null);

  /**
   * Which section each component belongs to, so a coverage gap reads as
   * "Portal is missing X" rather than a bare component. A section covers the
   * whole subtree of every component it links.
   */
  const sectionByComponent = $derived.by(() => {
    const m = new Map<string, string>();
    if (!toc || !data?.coverage) return m;
    const bySlug = new Map<string, CoverageNode>();
    const index = (ns: CoverageNode[]) => {
      for (const n of ns) {
        bySlug.set(n.slug, n);
        index(n.children);
      }
    };
    index(data.coverage.nodes);
    const mark = (compSlugs: string[], name: string) => {
      const seen = new Set<string>();
      const dfs = (n: CoverageNode) => {
        if (seen.has(n.slug)) return;
        seen.add(n.slug);
        if (!m.has(n.slug)) m.set(n.slug, name);
        n.children.forEach(dfs);
      };
      for (const s of compSlugs) {
        const n = bySlug.get(s);
        if (n) dfs(n);
      }
    };
    for (const sec of toc.categories)
      if (sec.components?.length)
        mark(
          sec.components.map((c) => c.slug),
          sec.name,
        );
    return m;
  });

  const sectionOf = (g: WikiGap): string | null =>
    g.evidence.component
      ? (sectionByComponent.get(String(g.evidence.component)) ?? null)
      : null;

  const HEADS: Record<WikiGapKind, { title: string; detail: string }> = {
    unwritten: {
      title: "Written about nowhere",
      detail:
        "Lessons with no covering article.",
    },
    outgrown: {
      title: "Outgrown",
      detail:
        "Newer lessons on these components, not cited.",
    },
    stale: {
      title: "Stale sources",
      detail: "Sources changed since written.",
    },
    wanted: {
      title: "Wanted pages",
      detail: "Linked to from an article, and never written.",
    },
    draft: {
      title: "Drafts",
      detail: "Written, and waiting for someone to approve them.",
    },
    uncategorised: {
      title: "Uncategorised",
      detail: "No category; unreachable from contents.",
    },
  };

  const groups = $derived(
    WIKI_GAP_KINDS.map((kind) => ({
      kind,
      gaps: (data?.gaps ?? []).filter((g) => g.kind === kind),
    })).filter((g) => g.gaps.length),
  );

  $effect(() => {
    void scope;
    load();
  });

  const current = createSequence();

  async function load() {
    const isCurrent = current();
    error = null;
    try {
      const [next, nextToc] = await Promise.all([
        api.get<WikiGaps>(`/library/wiki/${scope}/gaps`),
        api.get<WikiToc>(`/library/wiki/${scope}/toc`),
      ]);
      if (!isCurrent()) return;
      data = next;
      toc = nextToc;
    } catch (e) {
      if (!isCurrent()) return;
      error = errText(e);
      data = null;
    }
  }

  async function rescan() {
    rescanning = true;
    error = null;
    try {
      await api.post(`/library/wiki/${scope}/gaps/rescan`, {});
      await load();
      void loadWikis();
    } catch (e) {
      error = errText(e);
    } finally {
      rescanning = false;
    }
  }

  async function dismiss(g: WikiGap) {
    acting = g.id;
    error = null;
    try {
      await api.post(`/library/wiki/${scope}/gaps/${g.id}/dismiss`, {});
      await load();
      void loadWikis();
    } catch (e) {
      error = errText(e);
    } finally {
      acting = null;
    }
  }

  /**
   * Hand the gap to the agent, in the composer rather than sent: pressing enter
   * is the go-ahead, the turn runs on the reader's own credentials, and the
   * article still lands behind a review box.
   */
  function draftWithAgent(g: WikiGap) {
    const parts = [`/wiki-draft ${scope}`];
    if (g.evidence.component) parts.push(`component=${g.evidence.component}`);
    if (g.evidence.slug) parts.push(`article=${g.evidence.slug}`);
    chat.input = parts.join(" ");
    navigate("/chat");
  }

  function write(g: WikiGap) {
    if (g.kind === "wanted") {
      navigate(wikiPath(scope, "new", slugify(g.key)));
      return;
    }
    seedArticle({ title: g.subject, component: g.evidence.component ?? undefined });
    navigate(wikiPath(scope, "new", g.evidence.component ?? ""));
  }

  const open = (g: WikiGap) =>
    g.evidence.slug && navigate(wikiPath(scope, g.evidence.slug));

  /** The agent drafts from a component's material, which only a product wiki has. */
  const agentCan = (g: WikiGap) =>
    scope !== ORG_WIDE &&
    (g.kind === "unwritten" || g.kind === "outgrown" || g.kind === "stale");

  function evidenceLine(g: WikiGap): string {
    const e = g.evidence;
    switch (g.kind) {
      case "unwritten":
      case "outgrown": {
        const bits = [
          e.entries ? `${e.entries} ${e.entries === 1 ? "lesson" : "lessons"}` : "",
          e.docs ? `${e.docs} ${e.docs === 1 ? "doc" : "docs"}` : "",
        ].filter(Boolean);
        return `${bits.join(" · ")}${g.kind === "outgrown" ? ` since ${fmtDate(e.since)}` : ""}`;
      }
      case "stale":
        return `${g.score} changed: ${(e.titles ?? []).join(" · ")}`;
      case "wanted":
        return `linked from ${(e.titles ?? []).join(" · ")}`;
      case "draft":
        return `last edited ${fmtDate(e.updated_at)}`;
      default:
        return "";
    }
  }

  $effect(() => {
    if (!isCurator()) return;
    return setTopActions(curate);
  });
</script>

<!-- Rendered by App into the carved row beside the subnav, not here. -->
{#snippet curate()}
  <Button
    variant="ghost"
    size="sm"
    icon="refresh"
    title="rescan now (hourly otherwise)"
    busy={rescanning}
    onclick={rescan}>rescan</Button
  >
{/snippet}

<WikiLayout {scope}>
  <div class="gaps">
    <h2>Gaps</h2>

    {#if error}<Note tone="danger">{error}</Note>{/if}

    {#if scope === ORG_WIDE}
      <Note tone="muted">
        The org-wide wiki has no components, so coverage-based gaps (uncovered
        lessons and outgrown articles) are not computed here — only stale
        sources, wanted pages, drafts and uncategorised articles.
      </Note>
    {/if}

    {#if data}
      {#if groups.length}
        {#each groups as { kind, gaps } (kind)}
          <section>
            <h3>{HEADS[kind].title} <span class="n">{gaps.length}</span></h3>
            <p class="detail">{HEADS[kind].detail}</p>
            <ul>
              {#each gaps as g (g.id)}
                <li>
                  <div class="what">
                    {#if g.evidence.slug}
                      <a
                        href={wikiPath(scope, g.evidence.slug)}
                        onclick={(e) => {
                          e.preventDefault();
                          open(g);
                        }}>{g.subject}</a
                      >
                    {:else}
                      <strong>{g.subject}</strong>
                    {/if}
                    {#if sectionOf(g)}
                      <span class="sec">in {sectionOf(g)}</span>
                    {/if}
                    <span class="line">{evidenceLine(g)}</span>
                    {#if g.evidence.items?.length}
                      <span class="items">
                        {#each g.evidence.items as it (it.id)}
                          <a
                            href="/library/{it.kind === 'entry' ? 'entries' : 'docs'}/{it.id}"
                            onclick={(e) => {
                              e.preventDefault();
                              navigate(
                                `/library/${it.kind === "entry" ? "entries" : "docs"}/${it.id}`,
                              );
                            }}>{it.title}</a
                          >
                        {/each}
                      </span>
                    {/if}
                    <span class="since">
                      seen since {fmtDate(g.first_seen_at)}
                      {#if g.dismissed_at}
                        · back after being dismissed at {g.dismissed_score}
                      {/if}
                    </span>
                  </div>
                  {#if isCurator()}
                    <span class="acts">
                      {#if agentCan(g)}
                        <Button
                          size="sm"
                          variant="ghost"
                          tone="accent"
                          icon="ai"
                          title="open chat with a /wiki-draft command for this"
                          onclick={() => draftWithAgent(g)}
                          >{g.kind === "unwritten" ? "draft" : "refresh"}</Button
                        >
                      {/if}
                      {#if g.kind === "unwritten" || g.kind === "wanted"}
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="edit"
                          title="write it by hand"
                          onclick={() => write(g)}>write</Button
                        >
                      {/if}
                      {#if g.kind === "unwritten" || g.kind === "outgrown" || g.kind === "wanted"}
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="close"
                          title="not worth an article; returns if evidence grows"
                          busy={acting === g.id}
                          onclick={() => dismiss(g)}>dismiss</Button
                        >
                      {/if}
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      {:else}
        <EmptyState
          icon="success"
          title="Nothing missing that the sweep can see."
          detail="Checks: uncovered lessons, outdated articles, stale sources, wanted pages, drafts, uncategorised."
        />
      {/if}

      {#if data.coverage}
        <CoverageTree {scope} coverage={data.coverage} onchanged={load} />
      {/if}
    {:else if !error}
      <p class="muted">loading…</p>
    {/if}
  </div>
</WikiLayout>

<style>
  .gaps {
    max-width: 88ch;
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0 0 var(--pad-3);
    border-bottom: 1px solid var(--border);
    padding-bottom: var(--pad-2);
  }
  section + section {
    margin-top: var(--pad-4);
  }
  h3 {
    font-size: var(--fs-sm);
    margin: 0;
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  h3 .n {
    color: var(--warn);
    font-variant-numeric: tabular-nums;
    margin-left: var(--pad-1);
  }
  .detail {
    margin: var(--pad-1) 0 var(--pad-2);
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  li {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--pad-3);
    padding: var(--pad-2) 0;
    border-bottom: 1px solid var(--border);
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .what a {
    color: inherit;
  }
  .line {
    font-size: var(--fs-sm);
  }
  .sec {
    font-size: var(--fs-xs);
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  .items {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--pad-2);
    font-size: var(--fs-xs);
  }
  .items a {
    color: var(--muted);
  }
  .items a:hover {
    color: var(--text);
  }
  .since {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .acts {
    flex: none;
    display: inline-flex;
    gap: var(--pad-1);
  }
  .muted {
    color: var(--muted);
  }

  @media (max-width: 52rem) {
    li {
      flex-direction: column;
    }
  }
</style>
