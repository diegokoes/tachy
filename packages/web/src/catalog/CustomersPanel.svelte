<script lang="ts">
  import { isCurator } from "../access/session.svelte";
  import { onMount, untrack } from "svelte";
  import { keep, recall } from "../shell/kept";
  import { api } from "../api";
  import { createResource, errText } from "../resource.svelte";
  import { t } from "../terms";
  import {
    Badge,
    Button,
    Chip,
    CrudTable,
    DeleteButton,
    Field,
    FilterBar,
    GroupHead,
    Note,
    Select,
    type Column,
    type Draft,
  } from "../tui";
  import { slugify, uniqueSlug } from "../slug";
  import { ComponentCache } from "../library/filing.svelte";
  import type { Customer, Product } from "./rows";
  import type {
    CustomerFactRow,
    CustomerProfile,
    CustomerUnitRow,
    ResolvedFact,
  } from "@tachy/contract";
  import { INFO } from "../admin/help";
  import { csv } from "../tui/fields";
  import { sectionHoist } from "../admin/sectionAction.svelte";

  const customers = createResource(() => api.get<Customer[]>("/customers"), []);
  const products = createResource(() => api.get<Product[]>("/products"), []);

  let profiles = $state<Record<string, CustomerProfile>>({});
  let facts = $state<Record<string, CustomerFactRow[]>>({});
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

  // One row of each form per customer, so two open profiles never share a
  // draft.
  let factForm = $state({
    kind: "",
    label: "",
    value: "",
    source: "",
    notes: "",
    product: "",
    component: "",
    unit: "",
  });
  let compForm = $state({ product: "", component: "" });

  const unitKinds = (slug: string) => [
    ...new Set((units[slug] ?? []).map((unit) => unit.kind)),
  ];

  async function loadProfile(slug: string) {
    try {
      const [profile, factRows, unitRows] = await Promise.all([
        api.get<CustomerProfile>(`/customers/${slug}/profile`),
        api.get<CustomerFactRow[]>(`/customers/${slug}/facts`),
        api.get<CustomerUnitRow[]>(`/customers/${slug}/units`).catch(() => []),
      ]);
      units[slug] = unitRows;
      profiles[slug] = profile;
      facts[slug] = factRows;
    } catch (e) {
      error = errText(e);
    }
  }

  async function openProfile(slug: string) {
    factForm = {
      kind: "",
      label: "",
      value: "",
      source: "",
      notes: "",
      product: "",
      component: "",
      unit: "",
    };
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
      factForm = {
        kind: "",
        label: "",
        value: "",
        source: "",
        notes: "",
        product: "",
        component: "",
        unit: "",
      };
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

  function startEditUnit(slug: string, unit: CustomerUnitRow) {
    editUnit[slug] = unit.slug;
    const rows = units[slug] ?? [];
    editForm = {
      name: unit.name,
      kind: unit.kind,
      parent: unitName(rows, unit.parent_id) ?? "",
      profile: unitName(rows, unit.profile_id) ?? "",
      aliases: (unit.aliases ?? []).join(", "),
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
  function unitSubtree(
    rows: CustomerUnitRow[],
    root: CustomerUnitRow,
  ): string[] {
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
    for (const unit of rows)
      byParent.set(unit.parent_id, [
        ...(byParent.get(unit.parent_id) ?? []),
        unit,
      ]);
    const flat: { unit: CustomerUnitRow; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const unit of byParent.get(parent) ?? []) {
        flat.push({ unit, depth });
        walk(unit.id, depth + 1);
      }
    };
    walk(null, 0);
    return flat;
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
      face: "ui",
      label: t("customer"),
      width: "16rem",
      edit: "text",
      required: true,
    },
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
    { key: "notes", face: "ui", label: "notes", edit: "textarea" },
  ]);

  onMount(() => {
    customers.reload();
    products.reload();
  });

  /** The customer whose record dialog is open, if one is. */
  let opened = $state<string | null>(null);

  // Everything hanging off the customer (units, facts, component rules) fetched
  // when its dialog opens, once the products its forms offer have arrived.
  $effect(() => {
    if (!opened || products.loading) return;
    const slug = opened;
    untrack(() => void openProfile(slug));
  });

  async function createCustomer(draft: Draft) {
    await customers.mutate(() =>
      api.post("/customers", {
        slug: draft.slug,
        name: draft.name,
        aliases: csv(String(draft.aliases ?? "")),
        emailDomains: csv(String(draft.email_domains ?? "")),
        notes: draft.notes || undefined,
      }),
    );
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

  let filter = $state(recall("admin.customers.filter", ""));
  $effect(() => keep("admin.customers.filter", filter));
  const filtered = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return customers.data;
    return customers.data.filter((c) =>
      [
        c.slug ?? "",
        c.name ?? "",
        (c.aliases ?? []).join(" "),
        (c.email_domains ?? []).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  });
</script>

{#snippet detail(customer: Customer)}
  {@const profile = profiles[customer.slug]}
  {#if error}<Note tone="danger">{error}</Note>{/if}
  <div class="profile">
    <div class="block wide">
      <GroupHead label="estate" />
      {#each unitTree(units[customer.slug] ?? []) as { unit, depth } (unit.id)}
        <div class="frow" style="--depth: {depth}">
          <span class="indent"></span>
          <Badge tone="muted">{unit.kind}</Badge>
          <button
            class="unitname"
            onclick={() => showUnit(customer.slug, unit.slug)}
          >
            {unit.name}
          </button>
          <span class="lbl">{unit.slug}</span>
          {#if unit.profile_id}
            <span class="dim sm"
              >conforms to {unitName(
                units[customer.slug] ?? [],
                unit.profile_id,
              )}</span
            >
          {/if}
          <button
            class="tiny"
            onclick={() => startEditUnit(customer.slug, unit)}>edit</button
          >
          <DeleteButton
            label="remove unit"
            onclick={() => delUnit(customer.slug, unit.slug)}
          />
        </div>
        {#if editUnit[customer.slug] === unit.slug}
          <div class="frow add" style="--depth: {depth}">
            <span class="indent"></span>
            <Field label="name">
              <input aria-label="unit name" bind:value={editForm.name} />
            </Field>
            <Field label="kind">
              <Select
                bind:value={editForm.kind}
                options={unitKinds(customer.slug)}
                creatable
                aria-label="unit kind"
              />
            </Field>
            <Field label="inside">
              <Select
                bind:value={editForm.parent}
                aria-label="inside"
                options={[
                  { value: "", label: "top level" },
                  ...(units[customer.slug] ?? [])
                    .filter(
                      (x) =>
                        !unitSubtree(units[customer.slug] ?? [], unit).includes(
                          x.slug,
                        ),
                    )
                    .map((x) => x.slug),
                ]}
              />
            </Field>
            <Field label="conforms to">
              <Select
                bind:value={editForm.profile}
                aria-label="conforms to"
                options={[
                  { value: "", label: "none" },
                  ...(units[customer.slug] ?? [])
                    .filter((x) => x.slug !== unit.slug)
                    .map((x) => x.slug),
                ]}
              />
            </Field>
            <Field label="aliases">
              <input aria-label="unit aliases" bind:value={editForm.aliases} />
            </Field>
            <Button
              size="sm"
              variant="primary"
              busy={busy === customer.slug}
              onclick={() => saveUnit(customer.slug)}
            >
              save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onclick={() => (editUnit[customer.slug] = "")}
            >
              cancel
            </Button>
          </div>
        {/if}
      {/each}
      {#if !(units[customer.slug] ?? []).length}
        <span class="dim sm"> not broken down </span>
      {/if}
      <div class="frow add">
        <Field label="slug">
          <input aria-label="unit slug" bind:value={unitForm.slug} />
        </Field>
        <Field label="name">
          <input aria-label="unit name" bind:value={unitForm.name} />
        </Field>
        <Field label="kind">
          <Select
            bind:value={unitForm.kind}
            options={unitKinds(customer.slug)}
            creatable
            aria-label="unit kind"
          />
        </Field>
        <Field label="inside">
          <Select
            bind:value={unitForm.parent}
            aria-label="inside"
            options={[
              { value: "", label: "top level" },
              ...(units[customer.slug] ?? []).map((u) => u.slug),
            ]}
          />
        </Field>
        <Field label="conforms to">
          <Select
            bind:value={unitForm.profile}
            aria-label="conforms to"
            options={[
              { value: "", label: "none" },
              ...(units[customer.slug] ?? []).map((u) => u.slug),
            ]}
          />
        </Field>
        <Button
          variant="ghost"
          tone="ok"
          square
          icon="plus"
          title="add unit"
          aria-label="add unit"
          busy={busy === customer.slug}
          disabled={!unitForm.slug.trim() ||
            !unitForm.name.trim() ||
            !unitForm.kind.trim()}
          onclick={() => addUnit(customer.slug)}
        />
      </div>
    </div>

    <div class="block wide">
      <GroupHead label="specifics" />
      {#if (units[customer.slug] ?? []).length}
        <div class="frow">
          <span class="dim sm">showing</span>
          <Select
            value={viewUnit[customer.slug] ?? ""}
            aria-label="resolve for unit"
            options={[
              { value: "", label: "the whole customer" },
              ...(units[customer.slug] ?? []).map((u) => ({
                value: u.slug,
                label: `as ${u.slug} sees it`,
              })),
            ]}
            onchange={(v) => showUnit(customer.slug, String(v))}
          />
        </div>
      {/if}

      {#if viewUnit[customer.slug]}
        <!-- Resolved ladder: inherited facts are greyed and say where from, so
             a reader can tell what is true of this line specifically. -->
        {#each resolved[`${customer.slug}:${viewUnit[customer.slug]}`] ?? [] as fact (fact.kind + fact.label)}
          <div class="frow" class:inherited={fact.inherited}>
            <Badge tone="muted">{fact.kind}</Badge>
            {#if fact.label}<span class="lbl">{fact.label}</span>{/if}
            <code>{fact.value}</code>
            <span class="dim sm">
              {fact.inherited
                ? `from ${fact.origin_slug ?? "the customer"}${fact.origin_kind ? ` (${fact.origin_kind})` : ""}`
                : "set here"}
            </span>
          </div>
        {/each}
        {#if !(resolved[`${customer.slug}:${viewUnit[customer.slug]}`] ?? []).length}
          <span class="dim sm">nothing applies to this unit yet</span>
        {/if}
      {:else}
        {#each facts[customer.slug] ?? [] as fact (fact.id)}
          <div class="frow">
            <Badge tone="muted">{fact.kind}</Badge>
            {#if fact.label}<span class="lbl">{fact.label}</span>{/if}
            <code>{fact.value}</code>
            <DeleteButton
              label="remove specific"
              onclick={() => delFact(customer.slug, fact.id)}
            />
          </div>
        {/each}
        {#if !(facts[customer.slug] ?? []).length}
          <span class="dim sm"> nothing recorded yet </span>
        {/if}
      {/if}
      <div class="frow add">
        <Field label="kind">
          <Select
            bind:value={factForm.kind}
            options={kinds.map((factKind) => factKind.kind)}
            creatable
            aria-label="kind"
          />
        </Field>
        <Field label="about">
          <input aria-label="label" bind:value={factForm.label} />
        </Field>
        <Field label="value">
          <input
            aria-label="value"
            bind:value={factForm.value}
            onkeydown={(e) => e.key === "Enter" && addFact(customer.slug)}
          />
        </Field>
        <Button
          variant="ghost"
          tone="ok"
          square
          icon="plus"
          title="add specific"
          aria-label="add specific"
          busy={busy === customer.slug}
          disabled={!factForm.kind.trim() || !factForm.value.trim()}
          onclick={() => addFact(customer.slug)}
        />
      </div>
      <!-- Where it was learned is what makes a handover fact auditable later. -->
      <div class="frow add">
        <Field label="learned from">
          <input aria-label="source" bind:value={factForm.source} />
        </Field>
        <Field label="notes">
          <input aria-label="notes" bind:value={factForm.notes} />
        </Field>
        <Field label={t("product")}>
          <Select
            bind:value={factForm.product}
            aria-label="fact product"
            options={[
              { value: "", label: "any" },
              ...products.data.map((pr) => ({
                value: pr.slug,
                label: pr.name,
              })),
            ]}
            onchange={(v) => {
              factForm.component = "";
              components.load(String(v));
            }}
          />
        </Field>
        {#if (units[customer.slug] ?? []).length}
          <Field label="unit">
            <Select
              bind:value={factForm.unit}
              aria-label="fact unit"
              options={[
                { value: "", label: "whole customer" },
                ...(units[customer.slug] ?? []).map((u) => u.slug),
              ]}
            />
          </Field>
        {/if}
        <Field label="component">
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
        </Field>
      </div>
    </div>

    <div class="block">
      <GroupHead label="components they run" />
      <div class="chips">
        {#each profile?.components ?? [] as component (component.product_slug + component.slug)}
          <Chip
            onremove={() =>
              delComponent(
                customer.slug,
                component.product_slug,
                component.slug,
              )}>{component.slug}</Chip
          >
        {/each}
        {#if !(profile?.components ?? []).length}
          <span class="dim sm">none recorded</span>
        {/if}
      </div>
      <div class="frow add">
        <Field label={t("product")}>
          <Select
            bind:value={compForm.product}
            aria-label="product"
            options={products.data.map((pr) => ({
              value: pr.slug,
              label: pr.name,
            }))}
            onchange={(v) => components.load(String(v))}
          />
        </Field>
        <Field label="component">
          <Select
            bind:value={compForm.component}
            aria-label="component"
            options={[
              { value: "", label: "none" },
              ...components.of(compForm.product).map((c) => ({
                value: c.slug,
                label: c.name,
              })),
            ]}
          />
        </Field>
        <Button
          variant="ghost"
          tone="ok"
          square
          icon="plus"
          title="add component"
          aria-label="add component"
          disabled={!compForm.component}
          onclick={() => addComponent(customer.slug)}
        />
      </div>
    </div>

    <div class="block">
      <GroupHead label="their records" />
      <div class="chips">
        {#each profile?.repos ?? [] as repo (repo.slug)}
          <Chip>{repo.slug}</Chip>
        {/each}
        {#each profile?.projects ?? [] as proj (proj.external_key)}
          <Chip tone="accent">{proj.external_key}</Chip>
        {/each}
        {#if !(profile?.repos ?? []).length && !(profile?.projects ?? []).length}
          <span class="dim sm">
            no repo or project is filed under them; set those on the repo and
            project rows
          </span>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}

<FilterBar
  bind:value={filter}
  shown={filtered.length}
  total={customers.data.length}
  label="filter customers"
/>

<!-- Units, facts and component rules ride under the fields in the same
     dialog, so it is wider than the others. -->
{#snippet profileExtra(form: { mode: "create" | "edit"; row: Customer | null })}
  {#if form.row}<div class="profile">{@render detail(form.row)}</div>{/if}
{/snippet}

<CrudTable
  hoist={sectionHoist("customers")}
  {columns}
  rows={filtered}
  rowKey={(r) => r.slug}
  loading={customers.loading}
  error={customers.error}
  emptyTitle={`no ${t("customers")} yet`}
  emptyDetail="attributed by requester email domain: list domains"
  addLabel={`add ${t("customer")}`}
  noun={t("customer")}
  editTitle={(r) => r.name}
  width="60rem"
  formExtra={profileExtra}
  canEdit={isCurator}
  canDelete={isCurator}
  canCreate={isCurator()}
  onform={(f) => (opened = f?.row?.slug ?? null)}
  oncreate={createCustomer}
  onsave={saveCustomer}
  ondelete={deleteCustomer}
/>

<style>
  .profile {
    margin-top: var(--pad-3);
    padding-top: var(--pad-3);
    border-top: 1px dashed var(--border);
  }
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
    align-items: end;
    flex-wrap: wrap;
  }
  .frow.add :global(.field) {
    min-width: 9rem;
  }
  .frow.add :global(.field .asel) {
    flex: 1;
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
