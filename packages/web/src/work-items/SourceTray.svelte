<script lang="ts">
  import { api } from "../api";
  import { Button, Chip, Select } from "../tui";
  import type { ContextItem } from "./composer.svelte";

  let {
    items,
    onadd,
    onremove,
  }: {
    items: ContextItem[];
    onadd: (item: ContextItem) => void;
    onremove: (index: number) => void;
  } = $props();

  type Connection = { slug: string; source_type: string };
  type Fetched = {
    work_item_id: string | null;
    item: {
      title?: string;
      externalUrl?: string;
      messages?: { bodyText?: string; automated?: boolean }[];
    };
  };

  /** Enough for a reviewer to follow the thread without paying for all of it. */
  const MAX_TEXT = 6000;

  let connections = $state<Connection[]>([]);
  let source = $state("");
  let externalId = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    api
      .get<Connection[]>("/source-connections")
      .then((c) => {
        connections = c;
        source ||= c[0]?.slug ?? "";
      })
      .catch(() => (connections = []));
  });

  const typeOf = (slug: string) =>
    connections.find((c) => c.slug === slug)?.source_type ?? null;

  async function add() {
    const id = externalId.trim().replace(/^#/, "");
    if (!source || !id) return;
    if (items.some((i) => i.source === source && i.external_id === id)) {
      externalId = "";
      return;
    }
    busy = true;
    error = null;
    try {
      const fetched = await api.post<Fetched>(
        `/work-items/${encodeURIComponent(source)}/${encodeURIComponent(id)}/fetch`,
        {},
      );
      const text = (fetched.item.messages ?? [])
        .filter((m) => !m.automated && m.bodyText?.trim())
        .map((m) => m.bodyText!.trim())
        .join("\n---\n")
        .slice(0, MAX_TEXT);
      onadd({
        source,
        external_id: id,
        title: fetched.item.title ?? `${source} ${id}`,
        text,
        work_item_id: fetched.work_item_id,
        source_type: typeOf(source),
      });
      externalId = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="tray">
  <span class="label">context</span>
  {#each items as item, i (`${item.source}:${item.external_id}`)}
    <Chip tone="accent" onremove={() => onremove(i)}>
      {item.source} #{item.external_id} · {item.title}
    </Chip>
  {/each}
  {#if connections.length}
    <form
      class="add"
      onsubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <Select
        value={source}
        options={connections.map((c) => ({ value: c.slug, label: c.slug }))}
        aria-label="Source"
        onchange={(v) => (source = String(v))}
      />
      <input
        class="id"
        placeholder="ticket id"
        aria-label="Ticket id"
        bind:value={externalId}
      />
      <Button
        size="sm"
        variant="ghost"
        icon="plus"
        type="submit"
        {busy}
        aria-label="Add as context"
        title="add as context"
      />
    </form>
  {/if}
  {#if error}<span class="err">{error}</span>{/if}
</div>

<style>
  .tray {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-2);
  }
  .label {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
  }
  .id {
    width: 7rem;
  }
  .err {
    font-size: var(--fs-xs);
    color: var(--danger);
  }
</style>
