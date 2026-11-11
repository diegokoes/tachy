<script lang="ts">
  import { navigate, router } from "../shell/router.svelte";
  import { Badge, InfoMark, Time } from "../tui";
  import { PROPOSAL_TONES, type ReviewGroup, type ReviewRow } from "./queue";

  let { groups }: { groups: ReviewGroup[] } = $props();

  /** A row in "mine" may be decided; the other groups say the status by name. */
  const statusShown = (group: ReviewGroup, row: ReviewRow) =>
    group.key === "mine" ? row.status : undefined;
</script>

<nav class="list" aria-label="review">
  {#each groups as group (group.key)}
    <section>
      <h3>
        {group.title} <span class="n">{group.rows.length}</span>
        <InfoMark label="about {group.title}">{group.detail}</InfoMark>
      </h3>
      <ul>
        {#each group.rows as row (row.key)}
          {@const status = statusShown(group, row)}
          <li>
            <a
              href={row.path}
              aria-current={router.path.startsWith(row.path)
                ? "page"
                : undefined}
              onclick={(e) => {
                e.preventDefault();
                navigate(row.path);
              }}
            >
              <span class="title">{row.title}</span>
              <span class="meta">
                <Badge>{row.kind}</Badge>
                {#if status}
                  <Badge tone={PROPOSAL_TONES[status]}>{status}</Badge>
                {/if}
                {#if row.by}<span class="by">{row.by}</span>{/if}
                <Time at={row.at} date />
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</nav>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    min-width: 0;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: var(--pad-1);
    font-size: var(--fs-sm);
    margin: 0 0 var(--pad-2);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  h3 .n {
    color: var(--warn);
    font-variant-numeric: tabular-nums;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  a {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    padding: var(--pad-2);
    border-bottom: 1px solid var(--border);
    border-left: 2px solid transparent;
    color: inherit;
    text-decoration: none;
  }
  a:hover {
    background: color-mix(in srgb, var(--rule) 8%, transparent);
  }
  a[aria-current="page"] {
    border-left-color: var(--accent);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .by {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
