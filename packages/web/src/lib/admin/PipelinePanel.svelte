<script lang="ts">
  import { Band, Card, Deck, Dial, Note } from "../tui";
  import { census } from "./census.svelte";
  import Figure from "./Figure.svelte";
  import Gaps from "./Gaps.svelte";
  import Stat from "./Stat.svelte";

  const d = $derived(census.data.detail.sources);
  const r = $derived(census.data.detail.repos);
  const loading = $derived(census.loading);

  /** Whole days since a timestamp, or null if there has never been one. */
  const ago = (at: string | null) => {
    const t = at ? Date.parse(at) : NaN;
    if (!Number.isFinite(t)) return null;
    const days = Math.floor((Date.now() - t) / 86_400_000);
    return days < 1 ? "today" : `${days}d ago`;
  };

  const oldestIndex = $derived(ago(r.oldest_indexed_at));

  const ratio = (n: number, of: number) => (of ? n / of : 0);

  /* One reading of readiness for all three rungs: the ring colours the part
     that is done, so `failing` must not paint the ones that are ready red. All
     of it, some of it, none of it — and muted when there is nothing to be
     ready. */
  const grade = (done: number, of: number) =>
    !of
      ? ("muted" as const)
      : done === of
        ? ("ok" as const)
        : done
          ? ("warn" as const)
          : ("danger" as const);

  /* The pipeline in the order a deployment is wired up: a project comes from a
     source, a repo hangs off a project. Each ring is that rung's readiness
     against its own denominator, which is what `note` states — the figure in
     the middle is the population, not the ratio. */
  const rungs = $derived([
    {
      key: "sources",
      n: d.connections,
      value: ratio(d.connections - d.untokened, d.connections),
      tone: grade(d.connections - d.untokened, d.connections),
      note: d.connections
        ? `${d.connections - d.untokened} of ${d.connections} with a token`
        : "nothing connected yet",
    },
    {
      key: "projects",
      n: d.projects,
      value: ratio(d.knowledge - d.projects_no_wiki, d.knowledge),
      tone: grade(d.knowledge - d.projects_no_wiki, d.knowledge),
      note: d.projects
        ? `${d.knowledge} knowledge · ${d.trackers} tracker`
        : "none registered",
    },
    {
      key: "repos",
      n: r.repos,
      value: ratio(r.ready, r.repos),
      tone: grade(r.ready, r.repos),
      note: r.repos ? `${r.ready} of ${r.repos} indexed` : "none linked",
    },
  ]);

  /* Every repo is in exactly one of these, so the four widths are the whole
     population rather than four independent ratios. `never_indexed` is not a
     fifth: it overlaps idle and error, and is a caption instead. */
  const statuses = $derived([
    { key: "ready", label: "ready", n: r.ready, tone: "ok" as const },
    { key: "working", label: "working", n: r.working, tone: "accent" as const },
    { key: "idle", label: "idle", n: r.idle, tone: "muted" as const },
    { key: "failing", label: "failing", n: r.failing, tone: "danger" as const },
  ]);

  const indexCaption = $derived(
    [
      oldestIndex ? `oldest index ${oldestIndex}` : null,
      r.never_indexed ? `${r.never_indexed} never cloned` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const gaps = $derived([
    {
      n: d.untokened,
      label: "sources without a token",
      tone: "danger" as const,
      to: "sources",
    },
    {
      n: d.never_synced,
      label: "sources never synced",
      tone: "warn" as const,
      to: "sources",
    },
    {
      n: d.projects_no_wiki,
      label: "knowledge projects without a wiki",
      tone: "warn" as const,
      to: "projects",
    },
    {
      n: r.failing,
      label: "repos failing to index",
      tone: "danger" as const,
      to: "repos",
    },
    {
      n: r.never_indexed,
      label: "repos never cloned",
      tone: "warn" as const,
      to: "repos",
    },
    {
      n: r.no_component,
      label: "repos without a component",
      tone: "warn" as const,
      to: "repos",
    },
    {
      n: r.no_project,
      label: "repos without a project",
      tone: "warn" as const,
      to: "repos",
    },
  ]);
</script>

<Deck>
  <Card label="the pipeline" span="full" {loading} lines={4}>
    <div class="pipe">
      {#each rungs as rung, i (rung.key)}
        {#if i}
          <span class="link" aria-hidden="true"></span>
        {/if}
        <div class="rung">
          <Dial value={rung.value} tone={rung.tone} label={rung.key}>
            <Figure value={rung.n} size="sm" />
          </Dial>
          <span class="name">{rung.key}</span>
          <span class="note">{rung.note}</span>
        </div>
      {/each}
    </div>
  </Card>

  <Card label="index health" span={2} {loading} lines={3}>
    {#if r.repos}
      <Band
        segments={statuses}
        total={r.repos}
        caption={indexCaption}
        label="index status across {r.repos} repos"
      />
    {:else}
      <span class="quiet">no repositories linked yet</span>
    {/if}
  </Card>

  <Stat
    label="code searchable"
    value={r.chunks}
    span={2}
    unit="chunks"
    detail="from {r.files.toLocaleString()} files in {r.ready} indexed repos"
    {loading}
  />

  <Card label="needs attention" span="full" {loading} lines={3}>
    <Gaps items={gaps} />
  </Card>
</Deck>

{#if census.error}
  <Note tone="danger">{census.error}</Note>
{/if}

<style>
  .pipe {
    display: flex;
    align-items: flex-start;
    gap: var(--pad-2);
    width: 100%;
    min-width: 0;
  }
  .rung {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-1);
    text-align: center;
  }
  .name {
    font-size: var(--fs-sm);
    letter-spacing: var(--label-spacing);
  }
  .note {
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  /* Sits on the dials' centre line, so the three rungs read as one run. */
  .link {
    flex: 0 1 4rem;
    min-width: 0;
    height: 2px;
    margin-top: 2.6rem;
    background: color-mix(in srgb, var(--muted) 55%, transparent);
  }

  .quiet {
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  @media (max-width: 34rem) {
    .pipe {
      flex-direction: column;
      align-items: stretch;
    }
    .link {
      display: none;
    }
  }
</style>
