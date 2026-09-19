<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import { createResource, errText } from "../resource.svelte";
  import { t } from "../terms";
  import {
    Badge,
    Button,
    Chip,
    CrudTable,
    FilterBar,
    Note,
    Select,
    type Column,
    type Draft,
  } from "../tui";
  import { slugify, uniqueSlug } from "../slug";
  import { ComponentCache } from "../filing.svelte";
  import type { Customer, Product } from "./rows";
  import type { CustomerUnitRow, ResolvedFact } from "@tachy/contract";
import { INFO } from "./help";
import { csv } from "../fields";
  import { sectionHoist } from "./sectionAction.svelte";
  import { NEW_RECORD, recordPath } from "./records";
  import RecordPage from "./RecordPage.svelte";

  /** Given, the panel is one customer's page rather than the list of them. */
  let { id }: { id?: string } = $props();

  type Profile = {
    slug: string;
    facts: {
      id?: string;
      kind: string;
      label: string;
      value: string;
      component: string | null;
    }[];
    components: { slug: string; product_slug: string }[];
    repos: { slug: string; component: string | null }[];
    projects: { source_slug: string; external_key: string }[];
  };
  type FactRow = Profile["facts"][number] & { id: string };

  const customers = createResource(() => api.get<Customer[]>("/customers"), []);
  const products = createResource(() => api.get<Product[]>("/products"), []);

  let profiles = $state<Record<string, Profile>>({});
  let facts = $state<Record<string, FactRow[]>>({});
  let units = $state<Record<string, CustomerUnitRow[]>>({});
  /** Which unit's resolved ladder is being shown, per customer. "" = the flat set. */
  let viewUnit = $state<Record<string, string>>({});
  let resolved = $state<Record<string, ResolvedFact[]>>({});
  let unitForm = $state({
    slug: "",
    name: "",
    kind: "",
    parent: "",
    profile: "",
  });
  const components = new ComponentCache();
  let kinds = $state<{ kind: string; count: number }[]>([]);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);

  /* One row of each form per customer, so two open profiles never share a draft. */
  let factForm = $state({ kind: "", label: "", value: "", source: "", notes: "", product: "", component: "", unit: "" });
  let compForm = $state({ product: "", component: "" });

  async function loadProfile(slug: string) {
    try {
      const [p, f, u] = await Promise.all([
        api.get<Profile>(`/customers/${slug}/profile`),
        api.get<FactRow[]>(`/customers/${slug}/facts`),
        api.get<CustomerUnitRow[]>(`/customers/${slug}/units`).catch(() => []),
      ]);
      units[slug] = u;
      profiles[slug] = p;
      facts[slug] = f;
    } catch (e) {
      error = errText(e);
    }
  }

  async function openProfile(slug: string) {
    factForm = { kind: "", label: "", value: "", source: "", notes: "", product: "", component: "", unit: "" };
    compForm = { product: products.data[0]?.slug ?? "", component: "" };
    if (compForm.product) await components.load(compForm.product);
    kinds = await api
      .get<{ kind: string; count: number }[]>("/customer-fact-kinds")
      .catch(() => []);
    await loadProfile(slug);
  }

  async function addFact(slug: string) {
    if (!factForm.kind.trim() || !factForm.value.trim()) return;
    busy = slug;
    error = null;
    try {
      await api.put(`/customers/${slug}/facts`, {
        kind: factForm.kind.trim(),
        label: factForm.label.trim() || undefined,
        value: factForm.value.trim(),
        source: factForm.source.trim() || undefined,
        unit: factForm.unit || undefined,
        notes: factForm.notes.trim() || undefined,
        // A component needs its product; the API rejects one without the other.
        ...(factForm.component
          ? { product_slug: factForm.product, component: factForm.component }
          : {}),
      });
      factForm = { kind: "", label: "", value: "", source: "", notes: "", product: "", component: "", unit: "" };
      await loadProfile(slug);
      kinds = await api.get<{ kind: string; count: number }[]>(
        "/customer-fact-kinds",
      );
    } catch (e) {
      error = errText(e);
    } finally {
      busy = null;
    }
  }

  async function addUnit(slug: string) {
    if (!unitForm.slug.trim() || !unitForm.name.trim() || !unitForm.kind.trim())
      return;
    busy = slug;
    error = null;
    try {
      await api.put(`/customers/${slug}/units`, {
        slug: unitForm.slug.trim(),
        name: unitForm.name.trim(),
        kind: unitForm.kind.trim(),
        parent: unitForm.parent || undefined,
        profile: unitForm.profile || undefined,
      });
      unitForm = { slug: "", name: "", kind: "", parent: "", profile: "" };
      await loadProfile(slug);
    } catch (e) {
      error = errText(e);
    } finally {
      busy = null;
    }
  }

  /** Slug of the unit being edited, per customer. */
  let editUnit = $state<Record<string, string>>({});
  let editForm = $state({
    name: "",
    kind: "",
    parent: "",
    profile: "",
    aliases: "",
  });

  function startEditUnit(slug: string, u: CustomerUnitRow) {
    editUnit[slug] = u.slug;
    const rows = units[slug] ?? [];
    editForm = {
      name: u.name,
      kind: u.kind,
      parent: unitName(rows, u.parent_id) ?? "",
      profile: unitName(rows, u.profile_id) ?? "",
      aliases: (u.aliases ?? []).join(", "),
    };
  }

  async function saveUnit(slug: string) {
    const unit = editUnit[slug];
    if (!unit) return;
    busy = slug;
    error = null;
    try {
      await api.patch(`/customers/${slug}/units/${unit}`, {
        name: editForm.name.trim(),
        kind: editForm.kind.trim(),
        parent: editForm.parent || null,
        profile: editForm.profile || null,
        aliases: csv(editForm.aliases),
      });
      editUnit[slug] = "";
      await loadProfile(slug);
    } catch (e) {
      error = errText(e);
    } finally {
      busy = null;
    }
  }

  /** A unit cannot sit under, or conform to, its own descendant. */
  function unitSubtree(rows: CustomerUnitRow[], root: CustomerUnitRow): string[] {
    const kids = rows.filter((u) => u.parent_id === root.id);
    return [root.slug, ...kids.flatMap((k) => unitSubtree(rows, k))];
  }

  async function delUnit(slug: string, unit: string) {
    error = null;
    try {
      await api.delete(`/customers/${slug}/units/${unit}`);
      if (viewUnit[slug] === unit) viewUnit[slug] = "";
      await loadProfile(slug);
    } catch (e) {
      error = errText(e);
    }
  }

  /** The resolved ladder for one unit, or back to the customer's flat set. */
  async function showUnit(slug: string, unit: string) {
    viewUnit[slug] = unit;
    if (!unit) return;
    try {
      resolved[`${slug}:${unit}`] = await api.get<ResolvedFact[]>(
        `/customers/${slug}/units/${unit}/facts`,
      );
    } catch (e) {
      error = errText(e);
    }
  }

  /** Depth-first with a depth, so the tree reads as a tree in a flat list. */
  function unitTree(rows: CustomerUnitRow[]) {
    const byParent = new Map<string | null, CustomerUnitRow[]>();
    for (const u of rows)
      byParent.set(u.parent_id, [...(byParent.get(u.parent_id) ?? []), u]);
    const out: { u: CustomerUnitRow; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const u of byParent.get(parent) ?? []) {
        out.push({ u, depth });
        walk(u.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  const unitName = (rows: CustomerUnitRow[], id: string | null) =>
    rows.find((u) => u.id === id)?.slug ?? null;

  async function delFact(slug: string, id: string) {
    error = null;
    try {
      await api.delete(`/customers/${slug}/facts/${id}`);
      await loadProfile(slug);
    } catch (e) {
      error = errText(e);
    }
  }

  async function addComponent(slug: string) {
    if (!compForm.product || !compForm.component) return;
    busy = slug;
    error = null;
    try {
      await api.put(`/customers/${slug}/components`, {
        product_slug: compForm.product,
        component: compForm.component,
      });
      compForm = { ...compForm, component: "" };
      await loadProfile(slug);
    } catch (e) {
      error = errText(e);
    } finally {
      busy = null;
    }
  }

  async function delComponent(slug: string, productSlug: string, comp: string) {
    error = null;
    try {
      await api.delete(
        `/customers/${slug}/components?product_slug=${encodeURIComponent(productSlug)}&component=${encodeURIComponent(comp)}`,
      );
      await loadProfile(slug);
    } catch (e) {
      error = errText(e);
    }
  }

  const columns: Column<Customer>[] = $derived([
    {
      key: "name",
      label: t("customer"),
      width: "16rem",
      edit: "text",
      required: true,
    },
    {
      key: "slug",
      label: "slug",
      width: "12rem",
      edit: "text",
      required: true,
      info: INFO.slug,
      derive: (d) =>
        uniqueSlug(
          slugify(String(d.name ?? "")),
          customers.data.map((c) => c.slug),
        ),
    },
    {
      key: "email_domains",
      label: "email domains",
      edit: "text",
      info: INFO.emailDomains,
      value: (r) => (r.email_domains ?? []).join(", "),
    },
    {
      key: "aliases",
      label: "aliases",
      formOnly: true,
      edit: "text",
      info: INFO.aliases.customer,
      value: (r) => (r.aliases ?? []).join(", "),
    },
    { key: "notes", label: "notes", edit: "textarea" },
  ]);

  onMount(() => {
    customers.reload();
    products.reload();
  });

  const creating = $derived(id === NEW_RECORD);
  const record = $derived(
    id && !creating ? (customers.data.find((c) => c.slug === id) ?? null) : null,
  );

  /* Everything hanging off the customer, once the products its forms offer
     have arrived. */
  $effect(() => {
    if (!id || creating || products.loading) return;
    const slug = id;
    untrack(() => void openProfile(slug));
  });

  const back = () => navigate(recordPath("customers"));

  async function createCustomer(d: Draft) {
    await customers.mutate(() =>
      api.post("/customers", {
        slug: d.slug,
        name: d.name,
        aliases: csv(String(d.aliases ?? "")),
        emailDomains: csv(String(d.email_domains ?? "")),
        notes: d.notes || undefined,
      }),
    );
    navigate(recordPath("customers", String(d.slug)), { replace: true });
  }

  const saveCustomer = (row: Customer, d: Draft) =>
    customers.mutate(() =>
      api.patch(`/customers/${row.slug}`, {
        name: d.name,
        aliases: csv(String(d.aliases ?? "")),
        emailDomains: csv(String(d.email_domains ?? "")),
        notes: d.notes || null,
      }),
    );

  const deleteCustomer = (row: Customer) =>
    customers.mutate(() => api.delete(`/customers/${row.slug}`));

  let filter = $state("");
  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return customers.data;
    return customers.data.filter((c) =>
      [
      c.slug ?? "",
      c.name ?? "",
      (c.aliases ?? []).join(" "),
      (c.email_domains ?? []).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  });
</script>

{#snippet detail(r: Customer)}
  {@const p = profiles[r.slug]}
  {#if error}<Note tone="danger">{error}</Note>{/if}
  <div class="profile">
    <div class="block wide">
      <span
        class="dim"
        title="Sites, lines, tenants. `profile`: shared template, inherited, not a parent."
        >estate</span
      >
      {#each unitTree(units[r.slug] ?? []) as { u, depth } (u.id)}
        <div class="frow" style="--depth: {depth}">
          <span class="indent"></span>
          <Badge tone="muted">{u.kind}</Badge>
          <button class="unitname" onclick={() => showUnit(r.slug, u.slug)}>
            {u.name}
          </button>
          <span class="lbl">{u.slug}</span>
          {#if u.profile_id}
            <span class="dim sm"
              >conforms to {unitName(units[r.slug] ?? [], u.profile_id)}</span
            >
          {/if}
          <button
            class="tiny"
            title="rename, move, or add an alias"
            onclick={() => startEditUnit(r.slug, u)}>edit</button>
          <Button
            variant="ghost"
            tone="danger"
            square
            icon="cancel"
            title="remove unit"
            aria-label="remove unit"
            onclick={() => delUnit(r.slug, u.slug)}
          />
        </div>
        {#if editUnit[r.slug] === u.slug}
          <div class="frow add" style="--depth: {depth}">
            <span class="indent"></span>
            <input aria-label="unit name" placeholder="name" bind:value={editForm.name} />
            <input aria-label="unit kind" placeholder="kind" bind:value={editForm.kind} />
            <Select
              bind:value={editForm.parent}
              aria-label="inside"
              options={[
                { value: "", label: "top level" },
                ...(units[r.slug] ?? [])
                  .filter((x) => !unitSubtree(units[r.slug] ?? [], u).includes(x.slug))
                  .map((x) => ({ value: x.slug, label: `inside ${x.slug}` })),
              ]}
            />
            <Select
              bind:value={editForm.profile}
              aria-label="conforms to"
              options={[
                { value: "", label: "no shared profile" },
                ...(units[r.slug] ?? [])
                  .filter((x) => x.slug !== u.slug)
                  .map((x) => ({ value: x.slug, label: `conforms to ${x.slug}` })),
              ]}
            />
            <input
              aria-label="unit aliases"
              placeholder="aliases"
              title="Alternate names. Resolved like the slug."
              bind:value={editForm.aliases}
            />
            <Button size="sm" variant="primary" busy={busy === r.slug} onclick={() => saveUnit(r.slug)}>
              save
            </Button>
            <Button size="sm" variant="ghost" onclick={() => (editUnit[r.slug] = "")}>
              cancel
            </Button>
          </div>
        {/if}
      {/each}
      {#if !(units[r.slug] ?? []).length}
        <span class="dim sm">
          Not broken down. Every fact below is true of the whole account.
        </span>
      {/if}
      <div class="frow add">
        <input aria-label="unit slug" placeholder="slug" bind:value={unitForm.slug} />
        <input aria-label="unit name" placeholder="name" bind:value={unitForm.name} />
        <input aria-label="unit kind" placeholder="kind" list="unit-kinds" bind:value={unitForm.kind} />
        <Select
          bind:value={unitForm.parent}
          aria-label="inside"
          options={[
            { value: "", label: "top level" },
            ...(units[r.slug] ?? []).map((u) => ({ value: u.slug, label: `inside ${u.slug}` })),
          ]}
        />
        <Select
          bind:value={unitForm.profile}
          aria-label="conforms to"
          options={[
            { value: "", label: "no shared profile" },
            ...(units[r.slug] ?? []).map((u) => ({ value: u.slug, label: `conforms to ${u.slug}` })),
          ]}
        />
        <Button
          variant="ghost"
          tone="ok"
          square
          icon="plus"
          title="add unit"
          aria-label="add unit"
          busy={busy === r.slug}
          disabled={!unitForm.slug.trim() || !unitForm.name.trim() || !unitForm.kind.trim()}
          onclick={() => addUnit(r.slug)}
        />
      </div>
      <datalist id="unit-kinds">
        {#each [...new Set((units[r.slug] ?? []).map((u) => u.kind))] as k}
          <option value={k}></option>
        {/each}
      </datalist>
    </div>

    <div class="block wide">
      <span
        class="dim"
        title="Install-specific facts: version, layout, integrations. Not problems or fixes."
        >specifics</span
      >
      {#if (units[r.slug] ?? []).length}
        <div class="frow">
          <span class="dim sm">showing</span>
          <Select
            value={viewUnit[r.slug] ?? ""}
            aria-label="resolve for unit"
            options={[
              { value: "", label: "the whole customer" },
              ...(units[r.slug] ?? []).map((u) => ({
                value: u.slug,
                label: `as ${u.slug} sees it`,
              })),
            ]}
            onchange={(v) => showUnit(r.slug, String(v))}
          />
        </div>
      {/if}

      {#if viewUnit[r.slug]}
        <!-- Resolved ladder: inherited facts are greyed and say where from, so
             a reader can tell what is true of this line specifically. -->
        {#each resolved[`${r.slug}:${viewUnit[r.slug]}`] ?? [] as f (f.kind + f.label)}
          <div class="frow" class:inherited={f.inherited}>
            <Badge tone="muted">{f.kind}</Badge>
            {#if f.label}<span class="lbl">{f.label}</span>{/if}
            <code>{f.value}</code>
            <span class="dim sm">
              {f.inherited
                ? `from ${f.origin_slug ?? "the customer"}${f.origin_kind ? ` (${f.origin_kind})` : ""}`
                : "set here"}
            </span>
          </div>
        {/each}
        {#if !(resolved[`${r.slug}:${viewUnit[r.slug]}`] ?? []).length}
          <span class="dim sm">Nothing applies to this unit yet.</span>
        {/if}
      {:else}
      {#each facts[r.slug] ?? [] as f (f.id)}
        <div class="frow">
          <Badge tone="muted">{f.kind}</Badge>
          {#if f.label}<span class="lbl">{f.label}</span>{/if}
          <code>{f.value}</code>
          <Button
            variant="ghost"
            tone="danger"
            square
            icon="cancel"
            title="remove"
            aria-label="remove specific"
            onclick={() => delFact(r.slug, f.id)}
          />
        </div>
      {/each}
      {#if !(facts[r.slug] ?? []).length}
        <span class="dim sm">
          Nothing recorded. An answer for them is only as good as what is here.
        </span>
      {/if}
      {/if}
      <div class="frow add">
        <input
          aria-label="kind"
          list="fact-kinds"
          placeholder="version"
          bind:value={factForm.kind}
        />
        <input
          aria-label="label"
          placeholder="which product / line (optional)"
          bind:value={factForm.label}
        />
        <input
          aria-label="value"
          placeholder="value"
          bind:value={factForm.value}
          onkeydown={(e) => e.key === "Enter" && addFact(r.slug)}
        />
        <Button
          variant="ghost"
          tone="ok"
          square
          icon="plus"
          title="add specific"
          aria-label="add specific"
          busy={busy === r.slug}
          disabled={!factForm.kind.trim() || !factForm.value.trim()}
          onclick={() => addFact(r.slug)}
        />
      </div>
      <!-- Where it was learned is what makes a handover fact auditable later. -->
      <div class="frow add">
        <input
          aria-label="source"
          placeholder="ticket URL, wiki page, person"
          bind:value={factForm.source}
        />
        <input aria-label="notes" placeholder="notes (optional)" bind:value={factForm.notes} />
        <Select
          bind:value={factForm.product}
          aria-label="fact product"
          options={[
            { value: "", label: "any product" },
            ...products.data.map((pr) => ({ value: pr.slug, label: pr.name })),
          ]}
          onchange={(v) => {
            factForm.component = "";
            components.load(String(v));
          }}
        />
        {#if (units[r.slug] ?? []).length}
          <Select
            bind:value={factForm.unit}
            aria-label="fact unit"
            options={[
              { value: "", label: "whole customer" },
              ...(units[r.slug] ?? []).map((u) => ({
                value: u.slug,
                label: `true of ${u.slug}`,
              })),
            ]}
          />
        {/if}
        <Select
          bind:value={factForm.component}
          aria-label="fact component"
          disabled={!factForm.product}
          options={[
            { value: "", label: "whole product" },
            ...components.of(factForm.product).map((c) => ({
              value: c.slug,
              label: c.name,
            })),
          ]}
        />
      </div>
      <datalist id="fact-kinds">
        {#each kinds as k}<option value={k.kind}></option>{/each}
      </datalist>
      {#if kinds.length}
        <span class="dim sm">
          already in use: {kinds.map((k) => k.kind).join(", ")}. Reuse one
          rather than coining a near-duplicate.
        </span>
      {/if}
    </div>

    <div class="block">
      <span class="dim">components they run</span>
      <div class="chips">
        {#each p?.components ?? [] as c (c.product_slug + c.slug)}
          <Chip
            onremove={() => delComponent(r.slug, c.product_slug, c.slug)}
            >{c.slug}</Chip
          >
        {/each}
        {#if !(p?.components ?? []).length}
          <span class="dim sm">none recorded</span>
        {/if}
      </div>
      <div class="frow add">
        <Select
          bind:value={compForm.product}
          aria-label="product"
          options={products.data.map((pr) => ({
            value: pr.slug,
            label: pr.name,
          }))}
          onchange={(v) => components.load(String(v))}
        />
        <Select
          bind:value={compForm.component}
          aria-label="component"
          options={[
            { value: "", label: "component…" },
            ...components.of(compForm.product).map((c) => ({
              value: c.slug,
              label: c.name,
            })),
          ]}
        />
        <Button
          variant="ghost"
          tone="ok"
          square
          icon="plus"
          title="add component"
          aria-label="add component"
          disabled={!compForm.component}
          onclick={() => addComponent(r.slug)}
        />
      </div>
    </div>

    <div class="block">
      <span class="dim">their records</span>
      <div class="chips">
        {#each p?.repos ?? [] as repo (repo.slug)}
          <Chip>{repo.slug}</Chip>
        {/each}
        {#each p?.projects ?? [] as proj (proj.external_key)}
          <Chip tone="accent">{proj.external_key}</Chip>
        {/each}
        {#if !(p?.repos ?? []).length && !(p?.projects ?? []).length}
          <span class="dim sm">
            no repo or project is filed under them. Set those on the repo and
            project rows.
          </span>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

{#if id}
  <RecordPage
    noun={t("customer")}
    title={record?.name ?? ""}
    {columns}
    row={record}
    {creating}
    loading={customers.loading}
    loadError={customers.error}
    body={detail}
    onclose={back}
    oncreate={createCustomer}
    onsave={saveCustomer}
    ondelete={deleteCustomer}
  />
{:else}
  {#if error}<Note tone="danger">{error}</Note>{/if}

  <FilterBar
    bind:value={filter}
    shown={filtered.length}
    total={customers.data.length}
    placeholder="filter customers…"
    label="filter customers"
  />

  <CrudTable
    hoist={sectionHoist("customers")}
    {columns}
    rows={filtered}
    rowKey={(r) => r.slug}
    loading={customers.loading}
    error={customers.error}
    emptyTitle={`No ${t("customers")} yet.`}
    emptyDetail={`Attributed by requester email domain. List domains.`}
    addLabel={`add ${t("customer")}`}
    onopen={(r) => navigate(recordPath("customers", r.slug))}
    onadd={() => navigate(recordPath("customers", NEW_RECORD))}
  />
{/if}

<style>
  .indent {
    display: inline-block;
    width: calc(var(--depth, 0) * 1rem);
  }
  .tiny {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 0.8em;
    opacity: 0.6;
    color: inherit;
    cursor: pointer;
  }
  .tiny:hover {
    opacity: 1;
    text-decoration: underline;
  }
  .unitname {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .unitname:hover {
    text-decoration: underline;
  }
  /* Inherited facts read as context rather than as this unit's own record. */
  .frow.inherited code,
  .frow.inherited .lbl {
    opacity: 0.6;
  }
  .profile {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-4);
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    align-items: flex-start;
  }
  .block.wide {
    flex: 1 1 28rem;
  }
  .frow {
    display: flex;
    align-items: center;
    gap: var(--gap);
  }
  .frow.add {
    margin-top: var(--pad-2);
  }
  .frow.add input {
    min-width: 9rem;
  }
  .lbl {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
  }
  .dim {
    color: var(--muted);
  }
  .sm {
    font-size: var(--fs-xs);
  }
</style>
