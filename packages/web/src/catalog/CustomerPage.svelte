<script lang="ts">
  import type {
    CustomerChangeBatch,
    CustomerFactRow,
    CustomerFiled,
    CustomerProfile,
    CustomerRights,
    CustomerUnitRow,
    ProductBlueprint,
    ProductRow,
  } from "@tachy/contract";
  import { api, readError } from "../api";
  import { errText } from "../resource.svelte";
  import { link, navigate } from "../shell/router.svelte";
  import { onUnauthorized } from "../access/session.svelte";
  import { presetScope } from "../library/filters";
  import Group from "../settings/Group.svelte";
  import { Button, Chip, Menu, Note } from "../tui";
  import {
    canEditPart,
    childKind,
    factChoices,
    factKindChoices,
    historyNames,
    setupGroups,
    unitAncestors,
  } from "./customer";
  import CustomerHistory from "./CustomerHistory.svelte";
  import DocumentList from "./DocumentList.svelte";
  import EntryList from "./EntryList.svelte";
  import FactList, { type FactDraft } from "./FactList.svelte";
  import SetupTree from "./SetupTree.svelte";
  import SourceList from "./SourceList.svelte";
  import UnitDialog, { type UnitDraft } from "./UnitDialog.svelte";

  let { slug, unit }: { slug: string; unit: string | null } = $props();

  let profile = $state<CustomerProfile | null>(null);
  let unitRead = $state<CustomerProfile | null>(null);
  let filed = $state<CustomerFiled>({ documents: [], entries: [] });
  let rights = $state<CustomerRights | null>(null);
  let units = $state<CustomerUnitRow[]>([]);
  let facts = $state<CustomerFactRow[]>([]);
  let history = $state<CustomerChangeBatch[]>([]);
  let products = $state<ProductRow[]>([]);
  let blueprints = $state<Record<string, ProductBlueprint>>({});
  let busy = $state(false);
  /** Refusals, each said where its action was taken. */
  let error = $state<string | null>(null);
  let factError = $state<string | null>(null);
  let dialogError = $state<string | null>(null);
  let historyError = $state<string | null>(null);

  const selected = $derived(units.find((u) => u.slug === unit) ?? null);
  const groups = $derived(setupGroups(units));
  const productName = (productSlug: string | null) =>
    products.find((p) => p.slug === productSlug)?.name ?? "general";
  const unitName = (unitSlug: string) =>
    units.find((u) => u.slug === unitSlug)?.name ?? unitSlug;

  async function loadBlueprint(productSlug: string | null) {
    if (!productSlug || blueprints[productSlug]) return;
    blueprints[productSlug] = await api.get<ProductBlueprint>(
      `/products/${productSlug}/blueprint`,
    );
  }

  async function load() {
    try {
      const base = `/customers/${slug}`;
      [profile, rights, units, facts, history, products] = await Promise.all([
        api.get<CustomerProfile>(`${base}/profile`),
        api.get<CustomerRights>(`${base}/rights`),
        api.get<CustomerUnitRow[]>(`${base}/units`),
        api.get<CustomerFactRow[]>(`${base}/facts`),
        api.get<CustomerChangeBatch[]>(`${base}/history`),
        api.get<ProductRow[]>("/products"),
      ]);
      if (unit)
        unitRead = await api.get<CustomerProfile>(
          `${base}/profile?unit=${encodeURIComponent(unit)}`,
        );
      else filed = await api.get<CustomerFiled>(`${base}/filed`);
      const used = [
        ...units.map((u) => u.product_slug),
        ...(rights?.products ?? []),
      ];
      await Promise.all([...new Set(used)].map(loadBlueprint));
      error = null;
    } catch (e) {
      error = errText(e);
    }
  }

  $effect(() => {
    void unit;
    void load();
  });

  /** Runs a write, then reads the page again; resolves to the refusal, or null. */
  async function change(write: () => Promise<unknown>): Promise<string | null> {
    busy = true;
    try {
      await write();
      await load();
      return null;
    } catch (e) {
      return errText(e);
    } finally {
      busy = false;
    }
  }

  const linkable = $derived(
    (rights?.products ?? []).filter((p) => !profile?.products.includes(p)),
  );
  const linkProduct = async (product: string) =>
    (error = await change(() =>
      api.put(`/customers/${slug}/products/${product}`, {}),
    ));
  const unlinkProduct = async (product: string) =>
    (error = await change(() =>
      api.delete(`/customers/${slug}/products/${product}`),
    ));

  const unitProducts = $derived([
    ...(rights?.customer ? [{ value: "", label: "general" }] : []),
    ...(rights?.products ?? []).map((p) => ({
      value: p,
      label: productName(p),
    })),
  ]);
  let dialog = $state<{
    initial: UnitDraft;
    editing: CustomerUnitRow | null;
  } | null>(null);

  /** Opens on the unit in view as the parent, when the caller may add to its product. */
  function openAddUnit() {
    const inside =
      selected &&
      unitProducts.some((p) => p.value === (selected.product_slug ?? ""))
        ? selected
        : null;
    const product = inside
      ? (inside.product_slug ?? "")
      : unitProducts[0].value;
    dialogError = null;
    dialog = {
      editing: null,
      initial: {
        product,
        kind: (inside && childKind(blueprints[product], inside.kind)) ?? "",
        name: "",
        slug: "",
        parent: inside?.slug ?? "",
        template: "",
      },
    };
  }

  function openEditUnit() {
    if (!selected) return;
    dialogError = null;
    dialog = {
      editing: selected,
      initial: {
        product: selected.product_slug ?? "",
        kind: selected.kind,
        name: selected.name,
        slug: selected.slug,
        parent: units.find((u) => u.id === selected.parent_id)?.slug ?? "",
        template: units.find((u) => u.id === selected.template_id)?.slug ?? "",
      },
    };
  }

  async function saveUnit(draft: UnitDraft) {
    const editing = dialog?.editing;
    dialogError = await change(() =>
      editing
        ? api.patch(`/customers/${slug}/units/${editing.slug}`, {
            name: draft.name.trim(),
            kind: draft.kind.trim(),
            parent: draft.parent || null,
            template: draft.template || null,
          })
        : api.put(`/customers/${slug}/units`, {
            slug: draft.slug.trim(),
            name: draft.name.trim(),
            kind: draft.kind.trim(),
            product: draft.product || null,
            parent: draft.parent || null,
            template: draft.template || null,
          }),
    );
    if (dialogError) return;
    dialog = null;
    if (!editing) navigate(`/customers/${slug}/${draft.slug.trim()}`);
  }

  async function deleteUnit() {
    if (!selected) return;
    const gone = selected.slug;
    dialogError = await change(() =>
      api.delete(`/customers/${slug}/units/${gone}`),
    );
    if (dialogError) return;
    dialog = null;
    navigate(`/customers/${slug}`);
  }

  const canEditHere = $derived(
    canEditPart(rights, selected ? selected.product_slug : null),
  );
  const unitBlueprint = $derived(
    selected?.product_slug ? blueprints[selected.product_slug] : undefined,
  );
  const factKinds = $derived(
    factKindChoices(
      unitBlueprint,
      selected?.kind ?? null,
      facts.map((f) => f.kind),
    ),
  );
  const ownFact = (kind: string, label: string) =>
    facts.find(
      (f) =>
        f.kind === kind &&
        f.label === label &&
        (f.unit_slug ?? null) === (selected?.slug ?? null),
    );

  async function setFact(draft: FactDraft) {
    factError = await change(() =>
      api.put(`/customers/${slug}/facts`, {
        unit: selected?.slug ?? null,
        kind: draft.kind.trim(),
        label: draft.label.trim() || undefined,
        value: draft.value.trim(),
        doc: draft.doc || null,
      }),
    );
    return !factError;
  }

  async function deleteFact(factId: string) {
    factError = await change(() =>
      api.delete(`/customers/${slug}/facts/${factId}`),
    );
    return !factError;
  }

  const documents = $derived(
    selected ? (unitRead?.documents ?? []) : filed.documents,
  );
  const entries = $derived(
    selected ? (unitRead?.entries ?? []) : filed.entries,
  );
  const uploadProducts = $derived.by(() => {
    if (selected?.product_slug)
      return canEditPart(rights, selected.product_slug)
        ? [
            {
              value: selected.product_slug,
              label: productName(selected.product_slug),
            },
          ]
        : [];
    return (rights?.products ?? []).map((p) => ({
      value: p,
      label: productName(p),
    }));
  });

  async function upload(file: File, productSlug: string) {
    const productId = products.find((p) => p.slug === productSlug)?.id;
    if (!productId) return;
    const form = new FormData();
    form.append("file", file);
    form.append("productId", productId);
    form.append("customerSlug", slug);
    if (selected) form.append("unit", selected.slug);
    error = await change(async () => {
      const response = await fetch("/api/reference/files", {
        method: "POST",
        body: form,
      });
      if (response.status === 401) onUnauthorized();
      if (!response.ok) throw await readError(response);
    });
  }

  function openInLibrary() {
    presetScope({ customer: slug, unit: selected?.slug });
    navigate("/library");
  }

  const ancestors = $derived(selected ? unitAncestors(units, selected) : []);
  const template = $derived(
    units.find((u) => u.id === selected?.template_id) ?? null,
  );
  const followers = $derived(
    selected ? units.filter((u) => u.template_id === selected.id) : [],
  );
  const unitConflicts = $derived(
    (profile?.conflicts ?? []).filter((c) => c.unit === selected?.slug),
  );

  const undo = async (batchId: string) =>
    (historyError = await change(() =>
      api.post(`/customer-history/${batchId}/restore`, {}),
    ));
</script>

{#snippet unitLinks(list: CustomerUnitRow[], joiner: string)}
  {#each list as other, index (other.id)}
    {#if index}<span class="joiner">{joiner}</span>{/if}
    <a href="/customers/{slug}/{other.slug}" use:link>{other.name}</a>
  {/each}
{/snippet}

{#if profile}
  <div class="page">
    <header class="customer">
      <h1>{profile.name}</h1>
      <div class="line">
        <span class="cap">products</span>
        {#each profile.products as product (product)}
          <Chip
            tone="accent"
            onremove={canEditPart(rights, product)
              ? () => unlinkProduct(product)
              : undefined}>{productName(product)}</Chip
          >
        {:else}
          <span class="muted">none</span>
        {/each}
        {#if linkable.length}
          <Menu
            label="link a product"
            icon="plus"
            items={linkable.map((p) => ({ key: p, label: productName(p) }))}
            onpick={linkProduct}
          />
        {/if}
        {#if history.length}
          <span class="sep" aria-hidden="true">·</span>
          <CustomerHistory
            batches={history}
            canUndo={!!rights?.customer || !!rights?.products.length}
            {busy}
            error={historyError}
            nameOf={historyNames({ products, units, facts })}
            onundo={undo}
          />
        {/if}
      </div>
      {#if profile.notes}<p class="notes">{profile.notes}</p>{/if}
    </header>

    <div class="layout">
      <div class="side">
        <Group label="setup">
          {#snippet action()}
            {#if unitProducts.length}
              <Button
                variant="ghost"
                size="sm"
                square
                icon="plus"
                title="add a unit"
                onclick={openAddUnit}
              />
            {/if}
          {/snippet}
          <SetupTree customer={profile} {groups} current={unit} {productName} />
        </Group>
      </div>

      <div class="main">
        {#if selected}
          <header class="unit">
            <div>
              <h2>{selected.name}</h2>
              <p class="where">
                <span class="kind">{selected.kind}</span>
                <span class="joiner">·</span>
                {productName(selected.product_slug)}
                {#if ancestors.length}
                  <span class="joiner">· inside</span>
                  {@render unitLinks(ancestors, "›")}
                {/if}
                {#if template}
                  <span class="joiner">· follows</span>
                  {@render unitLinks([template], ",")}
                {/if}
                {#if followers.length}
                  <span class="joiner">· followed by</span>
                  {@render unitLinks(followers, ",")}
                {/if}
              </p>
            </div>
            {#if canEditHere}
              <Button
                variant="ghost"
                size="sm"
                square
                icon="edit"
                title="edit unit"
                onclick={openEditUnit}
              />
            {/if}
          </header>
          {#each unitConflicts as conflict (conflict.problem)}
            <Note tone="warn">outside the blueprint: {conflict.problem}</Note>
          {/each}
        {/if}

        {#if error}<Note tone="danger">{error}</Note>{/if}

        {#if !unit || unitRead?.unit}
          <FactList
            facts={selected ? (unitRead?.facts ?? []) : profile.facts}
            missing={selected ? (unitRead?.missing ?? []) : []}
            {ownFact}
            canEdit={canEditHere}
            kindChoices={factKinds}
            valueChoices={(kind) =>
              factChoices(unitBlueprint, selected?.kind ?? null, kind)}
            {documents}
            originName={(origin) =>
              origin ? unitName(origin) : "the customer"}
            {busy}
            error={factError}
            onset={setFact}
            ondelete={deleteFact}
          />

          {#if documents.length || uploadProducts.length}
            <DocumentList
              {documents}
              current={unit}
              {unitName}
              {uploadProducts}
              {busy}
              onupload={upload}
            />
          {/if}

          {#if entries.length}
            <EntryList
              {entries}
              current={unit}
              {unitName}
              onlibrary={openInLibrary}
            />
          {/if}
        {/if}

        {#if !selected}
          {#if profile.components.length}
            <Group label="components">
              <div class="chips">
                {#each profile.components as component (component.product_slug + component.slug)}
                  <Chip>{component.slug}</Chip>
                {/each}
              </div>
            </Group>
          {/if}

          {#if profile.repos.length || profile.projects.length}
            <SourceList repos={profile.repos} projects={profile.projects} />
          {/if}

          {#if profile.conflicts.length}
            <Group label="outside the blueprint">
              {#each profile.conflicts as conflict (conflict.unit + conflict.problem)}
                <div class="item">
                  <a href="/customers/{slug}/{conflict.unit}" use:link
                    >{unitName(conflict.unit)}</a
                  >
                  <span class="muted">{conflict.problem}</span>
                </div>
              {/each}
            </Group>
          {/if}
        {/if}
      </div>
    </div>
  </div>

  {#if dialog}
    <UnitDialog
      {units}
      {blueprints}
      products={unitProducts}
      initial={dialog.initial}
      editing={dialog.editing}
      {busy}
      error={dialogError}
      onsave={saveUnit}
      ondelete={deleteUnit}
      oncancel={() => (dialog = null)}
    />
  {/if}
{:else if error}
  <Note tone="danger">{error}</Note>
{/if}

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
  }
  h1 {
    margin: 0;
    font-size: var(--fs-fig);
  }
  .line,
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-2);
  }
  .line {
    margin-top: var(--pad-2);
  }
  .cap {
    color: var(--muted);
    font-size: var(--fs-sm);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
  }
  .sep,
  .muted,
  .joiner {
    color: var(--muted);
  }
  .notes {
    margin: var(--pad-2) 0 0;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.25fr);
    gap: var(--pad-4) calc(var(--pad-4) * 3);
    align-items: start;
  }
  @media (max-width: 60rem) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    min-width: 0;
  }
  .unit {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--pad-3);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-lg);
  }
  .where {
    margin: var(--pad-1) 0 0;
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .where .kind {
    font-family: var(--font-mono);
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
    padding: var(--pad-1) 0;
  }
</style>
