<script lang="ts">
  import {
    Band,
    Columns,
    Dial,
    Note,
    compact,
    dayOfMonth,
    type Col,
  } from "../tui";
  import { census } from "./census.svelte";
  import { activity } from "./activity.svelte";
  import Counts from "./Counts.svelte";
  import Figure from "./Figure.svelte";
  import Gaps from "./Gaps.svelte";
  import Overview from "./Overview.svelte";

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

  const figures = $derived([
    { key: "sources", label: "sources", value: d.connections, to: "sources" },
    { key: "projects", label: "projects", value: d.projects, to: "projects" },
    { key: "repos", label: "repos", value: r.repos, to: "repos" },
    {
      key: "files",
      label: "files indexed",
      value: r.files,
      detail: `in ${r.ready} repos`,
      to: "repos",
    },
    { key: "chunks", label: "code chunks", value: r.chunks, to: "repos" },
  ]);

  /* The repos rung carries what the deleted index-health band used to say:
     every state a repo can be in that is not simply "indexed". Zero terms are
     dropped rather than printed, so the note is only ever news. */
  const repoNote = $derived(
    r.repos
      ? [
          `${r.ready} of ${r.repos} indexed`,
          r.working ? `${r.working} working` : null,
          r.failing ? `${r.failing} failing` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "none linked",
  );

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
        ? `${d.knowledge - d.projects_no_wiki} of ${d.knowledge} knowledge projects have a wiki`
        : "none registered",
    },
    {
      key: "repos",
      n: r.repos,
      value: ratio(r.ready, r.repos),
      tone: grade(r.ready, r.repos),
      note: repoNote,
    },
  ]);

  const indexCaption = $derived(
    [
      oldestIndex ? `oldest index ${oldestIndex}` : null,
      r.never_indexed ? `${r.never_indexed} never cloned` : null,
      r.idle ? `${r.idle} idle` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const traffic = $derived(activity.data.traffic);

  const callsPerDay = $derived(
    traffic.per_day.map(
      (d): Col => ({
        key: d.day,
        label: dayOfMonth(d.day),
        value: d.agent + d.sync + d.app,
      }),
    ),
  );
  const totalCalls = $derived(callsPerDay.reduce((n, c) => n + c.value, 0));

  /* Whose traffic it is — the agent reading on someone's behalf, sync, or the
     app itself — is the thing a request-rate scrape cannot tell you, so it is
     the whole of each connection's bar. */
  const byConnection = $derived(
    traffic.connections.map((c) => ({
      ...c,
      total: c.agent + c.sync + c.app,
      segments: [
        { key: "agent", label: "agent", n: c.agent, tone: "accent" as const },
        { key: "sync", label: "sync", n: c.sync, tone: "info" as const },
        { key: "app", label: "app", n: c.app, tone: "muted" as const },
      ],
      refusals: [
        c.rate_limited ? `${c.rate_limited} rate-limited` : null,
        c.auth_failures
          ? `credentials refused, last on ${c.last_auth_failure}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  );

  const refusingCredentials = $derived(
    traffic.connections.filter((c) => c.auth_failures > 0).length,
  );

  const gaps = $derived([
    {
      n: refusingCredentials,
      label: `sources that refused their credentials in the last ${traffic.days} days`,
      tone: "danger" as const,
      to: "sources",
    },
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

<Overview>
  {#snippet counts()}
    <Counts items={figures} {loading} />
  {/snippet}

  {#snippet health()}
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
    {#if indexCaption}<span class="quiet">{indexCaption}</span>{/if}
  {/snippet}

  {#snippet detail()}
    <span class="title">
      source calls · last {traffic.days} days · {compact(totalCalls)}
    </span>
    {#if totalCalls}
      <Columns rows={callsPerDay} format={compact} height="5rem" />
      <div class="connections">
        {#each byConnection as c (c.slug)}
          <div class="connection">
            <span class="conn-name">
              {c.slug}
              <span class="conn-type">{c.source_type} · {compact(c.total)}</span>
            </span>
            <Band segments={c.segments} total={c.total} label="{c.slug} calls by origin" />
            {#if c.refusals}
              <span class="refused" class:danger={c.auth_failures > 0}>
                {c.refusals}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <span class="quiet">no calls to a source recorded yet</span>
    {/if}
  {/snippet}

  {#snippet attention()}
    <Gaps items={gaps} />
  {/snippet}
</Overview>

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

  .title {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .quiet {
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .connections {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: var(--pad-3) var(--pad-4);
    margin-top: var(--pad-3);
  }
  .connection {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    min-width: 0;
  }
  .conn-name {
    font-size: var(--fs-sm);
    letter-spacing: var(--label-spacing);
  }
  .conn-type {
    margin-left: var(--pad-2);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .refused {
    font-size: var(--fs-xs);
    color: var(--warn);
  }
  .refused.danger {
    color: var(--danger);
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
