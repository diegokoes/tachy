<script lang="ts">
  import { onMount } from "svelte";
  import type { ComponentNode } from "@tachy/contract";
  import { api } from "../api";
  import { createResource, errText } from "../resource.svelte";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import {
    Button,
    Chip,
    Modal,
    Note,
    RecordModal,
    Select,
    blankDraft,
    draftFrom,
    missingRequired,
    type Column,
    type Draft,
  } from "../tui";
  import { slugify, uniqueSlug } from "../slug";
  import { csv } from "../fields";
  import { INFO } from "./help";
  import type { Repo } from "./rows";
  import { pushScope } from "../keys.svelte";
  import ArchitectureMap from "./ArchitectureMap.svelte";
  import SlugRename from "./SlugRename.svelte";
  import {
    EMPTY_FILTERS,
    options,
    pick,
    type Filters,
    type GraphNode,
  } from "./architecture";

  const tree = createResource(
    () => api.get<ComponentNode[]>("/components"),
    [],
  );
  const repos = createResource(
    () => api.get<{ repos: Repo[] }>("/repos").then((r) => r.repos),
    [],
  );

  let filters = $state<Filters>({ ...EMPTY_FILTERS });
  let renaming = $state<ComponentNode | null>(null);
  let error = $state<string | null>(null);

  /* Create and edit are the same form, as everywhere else in admin; only the
     commit differs. The map replaces the table, so this panel drives the
     record dialog itself rather than through CrudTable. */
  let form = $state<{ mode: "create" | "edit"; row: ComponentNode | null } | null>(
    null,
  );
  let draft = $state<Draft>({});
  let busy = $state(false);
  let armed = $state(false);

  const picked = $derived(options(tree.data, filters.team));
  const shown = $derived(pick(tree.data, filters));
  const narrowed = $derived(
    Boolean(filters.team || filters.product || filters.query.trim()),
  );

  /** Which product a new or edited component belongs to. */
  const productOf = (d: Draft) =>
    String(d.product_slug ?? form?.row?.product_slug ?? filters.product ?? "");

  const siblings = (productSlug: string) =>
    tree.data.filter((c) => c.product_slug === productSlug);

  const mayEdit = (c: ComponentNode | null) =>
    canCurateScope({ team_slug: c?.team_slug ?? null });

  /** A component may not be re-parented under itself or anything beneath it. */
  function subtree(row: ComponentNode | null): Set<string> {
    if (!row) return new Set();
    const ids = new Set([row.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const c of tree.data)
        if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) {
          ids.add(c.id);
          grew = true;
        }
    }
    return ids;
  }

  const reposOf = (c: ComponentNode) =>
    repos.data.filter((r) => r.component_id === c.id);

  const columns: Column<ComponentNode>[] = $derived([
    {
      key: "product_slug",
      label: t("product"),
      edit: "select",
      required: true,
      only: "create",
      info: "Which product this component belongs to. Fixed once created.",
      options: picked.products,
      initial: filters.product || undefined,
    },
    { key: "name", label: "name", edit: "text", required: true },
    {
      key: "slug",
      label: "id",
      formOnly: true,
      edit: "text",
      required: true,
      info: INFO.slug,
      derive: (d) =>
        uniqueSlug(
          slugify(String(d.name ?? "")),
          siblings(productOf(d)).map((c) => c.slug),
        ),
      action: { label: "rename…", onclick: (r) => (renaming = r) },
    },
    {
      key: "parent",
      label: "parent",
      edit: "select",
      info: INFO.parent,
      options: (d) => {
        const blocked = subtree(form?.row ?? null);
        return [
          { value: "", label: "(top level)" },
          ...siblings(productOf(d))
            .filter((c) => !blocked.has(c.id))
            .map((c) => ({ value: c.slug, label: c.name })),
        ];
      },
      value: (r) =>
        tree.data.find((p) => p.id === r.parent_id)?.slug ?? "",
    },
    {
      key: "aliases",
      label: "aliases",
      edit: "text",
      info: INFO.aliases.component,
      value: (r) => (r.aliases ?? []).join(", "),
    },
    { key: "description", label: "description", edit: "textarea", span: "full" },
  ]);

  function startEdit(row: ComponentNode) {
    draft = draftFrom(columns, row);
    form = { mode: "edit", row };
    armed = false;
    error = null;
  }

  function startAdd() {
    draft = blankDraft(columns);
    form = { mode: "create", row: null };
    armed = false;
    error = null;
  }

  function close() {
    form = null;
    draft = {};
    armed = false;
  }

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    error = null;
    try {
      await fn();
      await tree.reload();
      return true;
    } catch (e) {
      error = errText(e);
      return false;
    } finally {
      busy = false;
    }
  }

  async function commit() {
    if (!form) return;
    const missing = missingRequired(columns, draft);
    if (missing.length) {
      error = `required: ${missing.join(", ")}`;
      return;
    }
    const product = productOf(draft);
    const body = {
      name: draft.name,
      parentSlug: draft.parent || null,
      description: draft.description || null,
      aliases: csv(String(draft.aliases ?? "")),
    };
    const ok = await run(() =>
      form!.row
        ? api.patch(
            `/products/${product}/components/${form!.row.slug}`,
            body,
          )
        : api.post(`/products/${product}/components`, {
            ...body,
            slug: draft.slug,
            parentSlug: draft.parent || undefined,
            description: draft.description || undefined,
          }),
    );
    if (ok) close();
  }

  async function remove() {
    const row = form?.row;
    if (!row) return;
    if (!armed) {
      armed = true;
      return;
    }
    armed = false;
    if (
      await run(() =>
        api.delete(`/products/${row.product_slug}/components/${row.slug}`),
      )
    )
      close();
  }

  const open = (n: GraphNode) => {
    const row = tree.data.find((c) => c.id === n.key);
    if (row && mayEdit(row)) startEdit(row);
  };

  /* The map takes the whole window, so the filters and the add button wait
     behind ctrl+k instead of holding a strip of it. */
  let finding = $state(false);
  let findEl = $state<HTMLInputElement>();

  $effect(() =>
    pushScope([
      {
        key: "ctrl+k",
        label: "find",
        inFields: true,
        run: () => (finding = true),
      },
    ]),
  );

  $effect(() => {
    if (finding) findEl?.focus();
  });

  onMount(() => {
    void tree.reload();
    void repos.reload();
  });
</script>

{#snippet whereExtra()}
  {#if form?.row}
    {@const row = form.row}
    {@const rs = reposOf(row)}
    <div class="where">
      <span class="dim">
        {row.team_name} › {row.product_name}
      </span>
      {#if rs.length}
        <span class="chips">
          {#each rs as r (r.id)}
            <Chip
              tone={r.index_status === "ready" ? "default" : "warn"}
              title={`${r.url} · ${r.index_status}`}>{r.slug}</Chip
            >
          {/each}
        </span>
      {:else}
        <span class="dim sm">no repo implements this yet</span>
      {/if}
    </div>
  {/if}
{/snippet}

{#if error && !form}<Note tone="danger">{error}</Note>{/if}
{#if tree.error}<Note tone="danger">{tree.error}</Note>{/if}

<div class="stage">
  <ArchitectureMap rows={tree.data} {filters} onpick={open} />
  {#if narrowed}
    <button
      class="scope"
      type="button"
      title="change the filter (ctrl+k)"
      onclick={() => (finding = true)}
    >
      {[
        picked.teams.find((o) => o.value === filters.team)?.label,
        picked.products.find((o) => o.value === filters.product)?.label,
        filters.query.trim() && `"${filters.query.trim()}"`,
      ]
        .filter(Boolean)
        .join(" › ")}
      <span class="dim">· {shown.length} of {tree.data.length}</span>
    </button>
  {/if}
</div>

{#if finding}
  <Modal title="find" width="46rem" onCancel={() => (finding = false)}>
    {#snippet barExtra()}
      {#if picked.products.length}
        <Button
          variant="ghost"
          tone="ok"
          size="sm"
          icon="plus"
          onclick={() => {
            finding = false;
            startAdd();
          }}>add component</Button
        >
      {/if}
    {/snippet}
    <div class="bar">
      <Select
        bind:value={filters.team}
        options={picked.teams}
        placeholder="any {t('team')}"
        clearable
        searchable
        active={!!filters.team}
        keepOpen
        aria-label={t("team")}
        onchange={() => (filters.product = "")}
      />
      <Select
        bind:value={filters.product}
        options={picked.products}
        placeholder="any {t('product')}"
        clearable
        searchable
        active={!!filters.product}
        keepOpen
        aria-label={t("product")}
      />
      <input
        class="q"
        bind:this={findEl}
        bind:value={filters.query}
        placeholder="find a component…"
        aria-label="find a component"
        onkeydown={(e) => e.key === "Enter" && (finding = false)}
      />
      <span class="dim sm">{shown.length} of {tree.data.length}</span>
      {#if narrowed}
        <Button
          variant="ghost"
          size="sm"
          icon="cancel"
          title="whole catalogue"
          aria-label="whole catalogue"
          onclick={() => (filters = { ...EMPTY_FILTERS })}
        />
      {/if}
    </div>
  </Modal>
{/if}

{#if form}
  {@const f = form}
  <RecordModal
    title={f.row ? `component: ${f.row.name}` : "add component"}
    {columns}
    {draft}
    mode={f.mode}
    row={f.row ?? undefined}
    {busy}
    {error}
    width="44rem"
    extra={whereExtra}
    destructive={f.row && mayEdit(f.row)
      ? {
          label: armed ? "click again to confirm" : "delete",
          icon: armed ? "check" : "del",
          busy,
          onclick: remove,
        }
      : undefined}
    onConfirm={commit}
    onCancel={close}
  />
{/if}

{#if renaming}
  {@const r = renaming}
  <SlugRename
    title={`rename ${r.name}`}
    current={r.slug}
    taken={siblings(r.product_slug).map((c) => c.slug)}
    impact={`/products/${r.product_slug}/components/${r.slug}`}
    onRename={(to) =>
      api.post(`/products/${r.product_slug}/components/${r.slug}/rename`, {
        to,
      })}
    onDone={async () => {
      renaming = null;
      close();
      await tree.reload();
    }}
    onCancel={() => (renaming = null)}
  >
    {#snippet message(impact, to)}
      <p>
        Renaming <strong>{r.slug}</strong> to <strong>{to}</strong> rewrites
        {impact.entries} knowledge {impact.entries === 1 ? "entry" : "entries"}.
      </p>
    {/snippet}
  </SlugRename>
{/if}

<style>
  .stage {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .scope {
    position: absolute;
    top: var(--pad-3);
    left: var(--pad-4);
    padding: var(--pad-1) var(--pad-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-chip);
    background: var(--panel-solid);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .q {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .dim {
    color: var(--muted);
  }
  .sm {
    font-size: var(--fs-xs);
  }
  .where {
    display: flex;
    align-items: center;
    gap: var(--gap);
    flex-wrap: wrap;
    margin-top: var(--pad-3);
    padding-top: var(--pad-3);
    border-top: 1px dashed var(--border);
  }
  .chips {
    display: flex;
    gap: var(--pad-1);
    flex-wrap: wrap;
  }
</style>
