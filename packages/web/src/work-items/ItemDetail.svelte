<script lang="ts">
  import type {
    ComposerProject,
    LinkedCode,
    LinkedWorkItem,
    WorkItemView,
  } from "@tachy/contract";
  import { api } from "../api";
  import { chat } from "../chat/chatState.svelte";
  import { createResource, errText } from "../resource.svelte";
  import { pushScope } from "../keys/keys.svelte";
  import { refreshNotifications } from "../notifications/notify.svelte";
  import { link, navigate } from "../shell/router.svelte";
  import { Badge, Button, Icon, Note, Spinner, Time } from "../tui";
  import { typeColor, typeIcon } from "./ado-icons";
  import { boardItemPath, shownSections, type ShownField } from "./board";
  import { itemHtml } from "./itemHtml";
  import TimelineList from "./TimelineList.svelte";

  let { project, itemId }: { project: ComposerProject; itemId: string } =
    $props();

  const reading = createResource<WorkItemView | null>(
    () =>
      api.get<WorkItemView>(
        `/work-items/projects/${project.id}/items/${encodeURIComponent(itemId)}`,
      ),
    null,
  );
  $effect(() => {
    void reading.reload();
  });

  const view = $derived(reading.data);
  const sections = $derived(view ? shownSections(view) : null);
  const relations = $derived(view?.relations);
  const linkedItems = $derived(
    relations
      ? [
          ...(relations.parent
            ? [{ role: "parent", item: relations.parent }]
            : []),
          ...relations.children.map((item) => ({ role: "child", item })),
          ...relations.related.map((item) => ({ role: "related", item })),
        ]
      : [],
  );
  const html = (value: string) =>
    itemHtml(value, { slug: project.source_slug, itemId });

  let following = $state(false);
  let followBusy = $state(false);
  let followError = $state<string | null>(null);
  $effect(() => {
    if (view) following = view.following;
  });
  // The read marked this item's change notes read on the server.
  $effect(() => {
    if (view) void refreshNotifications();
  });

  async function toggleFollow() {
    const path = `/work-items/projects/${project.id}/items/${encodeURIComponent(itemId)}/follow`;
    followBusy = true;
    followError = null;
    try {
      const answer = following
        ? await api.delete<{ following: boolean }>(path)
        : await api.put<{ following: boolean }>(path, {});
      following = answer.following;
    } catch (e) {
      followError = errText(e);
    } finally {
      followBusy = false;
    }
  }

  $effect(() =>
    pushScope([
      {
        key: "f",
        label: following ? "unfollow" : "follow",
        run: () => void toggleFollow(),
      },
    ]),
  );

  function explainInChat() {
    chat.input = `/az explain ${itemId}`;
    navigate("/chat");
  }
</script>

{#snippet linkedItem(role: string, item: LinkedWorkItem)}
  <li>
    <span class="role">{role}</span>
    <a href={boardItemPath(project.id, String(item.id))} use:link
      >#{item.id} {item.title ?? ""}</a
    >
    <span class="dim"
      >{[item.type, item.state].filter(Boolean).join(" · ")}</span
    >
  </li>
{/snippet}

{#snippet value(field: ShownField)}
  {#if field.kind === "date"}<Time
      at={field.value}
    />{:else if field.kind === "empty"}<span class="dim">none</span
    >{:else}{field.value}{/if}
{/snippet}

{#snippet code(entry: LinkedCode)}
  <li class="code">
    {#if entry.url}
      <a href={entry.url} target="_blank" rel="noopener noreferrer"
        >{entry.title ?? entry.ref}</a
      >
    {:else}
      <span>{entry.title ?? entry.ref}</span>
    {/if}
    <span class="dim"
      >{[entry.repository, entry.status, entry.author, entry.note]
        .filter(Boolean)
        .join(" · ")}</span
    >
  </li>
{/snippet}

{#if reading.error}
  <Note tone="danger">{reading.error}</Note>
{:else if !view || !sections || !relations}
  <Spinner />
{:else}
  <header>
    <h2>
      <span class="glyph" style:color={typeColor(view.item.color) ?? undefined}>
        <Icon
          name={typeIcon(view.item.icon)}
          size="1.1em"
          label={view.item.type}
        />
      </span>
      <a
        class="id"
        href={view.item.url}
        target="_blank"
        rel="noopener noreferrer">#{view.item.id}</a
      >
      <span>{view.item.title}</span>
    </h2>
    <div class="facts">
      {#if view.item.state}<Badge tone="accent">{view.item.state}</Badge>{/if}
      <span>{view.item.assigned_to ?? "unassigned"}</span>
      {#if view.item.created_by}
        <span class="dim">opened by {view.item.created_by}</span>
      {/if}
      <span class="dim">opened <Time at={view.item.created_at} /></span>
      <span class="dim">changed <Time at={view.item.changed_at} /></span>
      {#each sections.pinned as field (field.ref)}
        <span
          ><span class="dim">{field.label}</span>
          {@render value(field)}</span
        >
      {/each}
      <span class="grow"></span>
      <Button
        size="sm"
        variant="ghost"
        icon={following ? "unfollow" : "follow"}
        busy={followBusy}
        aria-pressed={following}
        onclick={toggleFollow}>{following ? "following" : "follow"}</Button
      >
      <Button size="sm" variant="ghost" icon="ai" onclick={explainInChat}
        >explain in chat</Button
      >
    </div>
    {#if followError}<Note tone="danger">{followError}</Note>{/if}
  </header>

  <div class="columns">
    <div class="main">
      {#each sections.body as field (field.ref)}
        <section>
          <h3>{field.label}</h3>
          {#if field.kind === "html"}
            <div class="prose">{@html html(field.value)}</div>
          {:else}
            <p>{@render value(field)}</p>
          {/if}
        </section>
      {/each}
      <section>
        <h3>conversation and history</h3>
        {#if view.timeline.length}
          <TimelineList timeline={view.timeline} />
        {:else}
          <p class="dim">Nothing said or changed yet.</p>
        {/if}
      </section>
    </div>

    <aside>
      {#each sections.groups as group, i (group.label ?? `group-${i}`)}
        <section>
          {#if group.label}<h3>{group.label}</h3>{/if}
          <dl>
            {#each group.fields as field (field.ref)}
              <div>
                <dt>{field.label}</dt>
                <dd>
                  {#if field.kind === "date"}<Time
                      at={field.value}
                    />{:else}{field.value}{/if}
                </dd>
              </div>
            {/each}
          </dl>
        </section>
      {/each}

      {#if linkedItems.length}
        <section>
          <h3>work items</h3>
          <ul>
            {#each linkedItems as entry (`${entry.role}:${entry.item.id}`)}
              {@render linkedItem(entry.role, entry.item)}
            {/each}
          </ul>
        </section>
      {/if}
      {#if relations.pull_requests.length}
        <section>
          <h3>pull requests</h3>
          <ul>
            {#each relations.pull_requests as entry (entry.ref)}
              {@render code(entry)}
            {/each}
          </ul>
        </section>
      {/if}
      {#if relations.commits.length}
        <section>
          <h3>commits</h3>
          <ul>
            {#each relations.commits as entry (entry.ref)}
              {@render code(entry)}
            {/each}
          </ul>
        </section>
      {/if}
    </aside>
  </div>
{/if}

<style>
  header {
    margin-bottom: var(--pad-4);
  }
  h2 {
    display: flex;
    gap: var(--pad-3);
    align-items: baseline;
    margin: 0 0 var(--pad-3);
    font-size: 1rem;
    font-weight: 600;
  }
  .glyph {
    align-self: center;
    display: inline-flex;
    color: var(--muted);
  }
  .id {
    color: var(--accent);
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-2) var(--pad-4);
    font-size: var(--fs-sm);
  }
  .grow {
    flex: 1;
  }
  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(14rem, 20rem);
    gap: var(--pad-5, 2rem);
  }
  @media (max-width: 52rem) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  section {
    margin-bottom: var(--pad-4);
  }
  h3 {
    margin: 0 0 var(--pad-2);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--muted);
  }
  .prose {
    overflow-wrap: anywhere;
  }
  .prose :global(img) {
    max-width: 100%;
    height: auto;
  }
  dl {
    margin: 0;
    font-size: var(--fs-sm);
  }
  dl div {
    display: grid;
    grid-template-columns: 9rem minmax(0, 1fr);
    gap: var(--pad-2);
    padding: 0.15rem 0;
  }
  dt,
  .dim {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: var(--fs-sm);
  }
  li {
    display: grid;
    grid-template-columns: 4rem minmax(0, 1fr);
    column-gap: var(--pad-2);
    padding: 0.2rem 0;
  }
  li > :not(.role) {
    grid-column: 2;
  }
  .role {
    color: var(--muted);
  }
  li.code {
    grid-template-columns: minmax(0, 1fr);
  }
  li.code > * {
    grid-column: 1;
  }
</style>
