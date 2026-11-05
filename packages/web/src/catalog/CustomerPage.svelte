<script lang="ts">
  import type {
    CustomerChangeBatch,
    CustomerFactRow,
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
  import { fmtDate } from "../dates.svelte";
  import Group from "../settings/Group.svelte";
  import {
    Badge,
    Button,
    Chip,
    DeleteButton,
    Field,
    Icon,
    Note,
    Select,
  } from "../tui";
  import {
    batchAuthor,
    batchText,
    canEditPart,
    factChoices,
    factKindChoices,
    setupGroups,
    unitKindChoices,
  } from "./customer";

  let { slug, unit }: { slug: string; unit: string | null } = $props();

  let profile = $state<CustomerProfile | null>(null);
  let unitRead = $state<CustomerProfile | null>(null);
  let rights = $state<CustomerRights | null>(null);
  let units = $state<CustomerUnitRow[]>([]);
  let facts = $state<CustomerFactRow[]>([]);
  let history = $state<CustomerChangeBatch[]>([]);
  let products = $state<ProductRow[]>([]);
  let blueprints = $state<Record<string, ProductBlueprint>>({});
  let error = $state<string | null>(null);
  let busy = $state(false);

  const selected = $derived(units.find((u) => u.slug === unit) ?? null);
  const groups = $derived(setupGroups(units));
  const productName = (productSlug: string | null) =>
    products.find((p) => p.slug === productSlug)?.name ?? "general";

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
      unitRead = unit
        ? await api.get<CustomerProfile>(
            `${base}/profile?unit=${encodeURIComponent(unit)}`,
          )
        : null;
      await Promise.all(
        [...new Set(units.map((u) => u.product_slug))].map(loadBlueprint),
      );
      error = null;
    } catch (e) {
      error = errText(e);
    }
  }

  $effect(() => {
    void unit;
    void load();
  });

  /** Runs a change, then reads the page again; a refusal shows above it. */
  async function change(write: () => Promise<unknown>) {
    busy = true;
    error = null;
    try {
      await write();
      await load();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = false;
    }
  }

  // Product links: a team links its own product to any customer.
  let productPick = $state("");
  const linkable = $derived(
    (rights?.products ?? []).filter((p) => !profile?.products.includes(p)),
  );

  // A unit added under the setup; its product decides the kinds offered.
  let unitForm = $state({
    slug: "",
    name: "",
    kind: "",
    product: "",
    parent: "",
    template: "",
  });
  const unitProducts = $derived([
    ...(rights?.customer ? [{ value: "", label: "general" }] : []),
    ...(rights?.products ?? []).map((p) => ({
      value: p,
      label: productName(p),
    })),
  ]);
  const unitKinds = $derived(
    unitKindChoices(
      unitForm.product ? blueprints[unitForm.product] : undefined,
      units.filter((u) => !u.product_slug).map((u) => u.kind),
    ),
  );
  const sameProductUnits = $derived(
    units
      .filter((u) => (u.product_slug ?? "") === unitForm.product)
      .map((u) => u.slug),
  );

  function addUnit() {
    void change(() =>
      api.put(`/customers/${slug}/units`, {
        slug: unitForm.slug.trim(),
        name: unitForm.name.trim(),
        kind: unitForm.kind.trim(),
        product: unitForm.product || null,
        parent: unitForm.parent || null,
        template: unitForm.template || null,
      }),
    );
    unitForm = { ...unitForm, slug: "", name: "", parent: "", template: "" };
  }

  // A fact on the unit in view, or on the whole customer.
  let factForm = $state({ kind: "", label: "", value: "", doc: "" });
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
  const valueChoices = $derived(
    factChoices(unitBlueprint, selected?.kind ?? null, factForm.kind),
  );
  const canEditHere = $derived(
    canEditPart(rights, selected ? selected.product_slug : null),
  );

  function setFact(preset?: { kind: string }) {
    const kind = (preset?.kind ?? factForm.kind).trim();
    if (!kind || !factForm.value.trim()) return;
    void change(() =>
      api.put(`/customers/${slug}/facts`, {
        unit: selected?.slug ?? null,
        kind,
        label: factForm.label.trim() || undefined,
        value: factForm.value.trim(),
        ...(factForm.doc ? { doc: factForm.doc } : {}),
      }),
    );
    factForm = { kind: "", label: "", value: "", doc: "" };
  }

  /** The stored fact behind a resolved one, when it is the unit's own. */
  const ownFact = (kind: string, label: string) =>
    facts.find(
      (f) =>
        f.kind === kind &&
        f.label === label &&
        (f.unit_slug ?? null) === (selected?.slug ?? null),
    );

  // Units are edited in place: the form replaces the unit's heading.
  let editing = $state(false);
  let editForm = $state({ name: "", kind: "", parent: "", template: "" });
  function startEdit() {
    if (!selected) return;
    editForm = {
      name: selected.name,
      kind: selected.kind,
      parent: units.find((u) => u.id === selected.parent_id)?.slug ?? "",
      template: units.find((u) => u.id === selected.template_id)?.slug ?? "",
    };
    editing = true;
  }
  function saveUnit() {
    if (!selected) return;
    editing = false;
    void change(() =>
      api.patch(`/customers/${slug}/units/${selected.slug}`, {
        name: editForm.name.trim(),
        kind: editForm.kind.trim(),
        parent: editForm.parent || null,
        template: editForm.template || null,
      }),
    );
  }
  function deleteUnit() {
    if (!selected) return;
    const gone = selected.slug;
    void change(async () => {
      await api.delete(`/customers/${slug}/units/${gone}`);
      navigate(`/customers/${slug}`);
    });
  }

  // A document uploaded here is filed under the unit in view. The picker opens
  // from a button and the upload starts once a file is chosen.
  let uploadProduct = $state("");
  let fileInput = $state<HTMLInputElement | null>(null);
  const uploadProducts = $derived(
    selected?.product_slug ? [selected.product_slug] : (rights?.products ?? []),
  );
  async function upload() {
    const file = fileInput?.files?.[0];
    const productSlug = selected?.product_slug ?? uploadProduct;
    const productId = products.find((p) => p.slug === productSlug)?.id;
    if (!file || !productId) return;
    const form = new FormData();
    form.append("file", file);
    form.append("productId", productId);
    form.append("customerSlug", slug);
    if (selected) form.append("unit", selected.slug);
    await change(async () => {
      const response = await fetch("/api/reference/files", {
        method: "POST",
        body: form,
      });
      if (response.status === 401) onUnauthorized();
      if (!response.ok) throw await readError(response);
    });
    if (fileInput) fileInput.value = "";
  }

  const restore = (batchId: string) =>
    change(() => api.post(`/customer-history/${batchId}/restore`, {}));
</script>

{#snippet factRows(rows: CustomerProfile["facts"])}
  {#each rows as fact (fact.kind + fact.label)}
    {@const own = ownFact(fact.kind, fact.label)}
    <div class="fact" class:inherited={fact.inherited}>
      <span class="kind">{fact.kind}</span>
      <span class="label">{fact.label}</span>
      <span class="value">
        {fact.value}
        {#if fact.inherited || fact.doc}
          <span class="meta">
            {#if fact.inherited}from {fact.origin ?? "the customer"}{/if}
            {#if fact.inherited && fact.doc}·{/if}
            {#if fact.doc}
              <a href="/library/docs/{fact.doc.id}" use:link>{fact.doc.title}</a
              >
            {/if}
          </span>
        {/if}
      </span>
      <span class="act">
        {#if own && canEditHere}
          <DeleteButton
            label="remove fact"
            onclick={() =>
              change(() => api.delete(`/customers/${slug}/facts/${own.id}`))}
          />
        {/if}
      </span>
    </div>
  {/each}
{/snippet}

{#snippet factEditor()}
  <div class="form">
    <Field label="fact">
      <Select
        bind:value={factForm.kind}
        options={factKinds.kinds}
        creatable={factKinds.free}
        aria-label="fact kind"
      />
    </Field>
    <Field label="label">
      <input aria-label="fact label" bind:value={factForm.label} />
    </Field>
    <Field label="value">
      {#if valueChoices.length}
        <Select
          bind:value={factForm.value}
          options={valueChoices}
          aria-label="fact value"
        />
      {:else}
        <input aria-label="fact value" bind:value={factForm.value} />
      {/if}
    </Field>
    {#if unitRead?.documents?.length}
      <Field label="doc">
        <Select
          bind:value={factForm.doc}
          options={[
            { value: "", label: "none" },
            ...unitRead.documents.map((d) => ({ value: d.id, label: d.title })),
          ]}
          aria-label="fact doc"
        />
      </Field>
    {/if}
    <Button
      variant="primary"
      size="sm"
      {busy}
      disabled={!factForm.kind.trim() || !factForm.value.trim()}
      onclick={() => setFact()}>set fact</Button
    >
  </div>
{/snippet}

{#if profile}
  <div class="page">
    <header>
      <h1>{profile.name} <span class="slug">{profile.slug}</span></h1>
      {#if profile.notes}<p class="notes">{profile.notes}</p>{/if}
      <div class="products">
        {#each profile.products as product (product)}
          <Chip tone="accent">{productName(product)}</Chip>
        {/each}
        {#if linkable.length}
          <span class="link-product">
            <Select
              bind:value={productPick}
              options={[
                { value: "", label: "none" },
                ...linkable.map((p) => ({ value: p, label: productName(p) })),
              ]}
              aria-label="product to link"
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={!productPick}
              onclick={() =>
                change(() =>
                  api.put(`/customers/${slug}/products/${productPick}`, {}),
                )}>link product</Button
            >
          </span>
        {/if}
      </div>
    </header>

    {#if error}<Note tone="danger">{error}</Note>{/if}

    <div class="layout">
      <div class="col">
        <Group label="setup">
          <a
            class="unit top"
            class:current={!unit}
            href="/customers/{slug}"
            use:link>the whole customer</a
          >
          {#each groups as group (group.product ?? "")}
            <p class="product">{productName(group.product)}</p>
            {#each group.rows as row (row.unit.id)}
              <a
                class="unit"
                class:current={row.unit.slug === unit}
                style="--depth: {row.depth}"
                href="/customers/{slug}/{row.unit.slug}"
                use:link
              >
                <Badge tone="muted">{row.unit.kind}</Badge>
                <span>{row.unit.name}</span>
                <span class="slug">{row.unit.slug}</span>
              </a>
            {/each}
          {/each}
          {#if unitProducts.length}
            <div class="form">
              <Field label="product">
                <Select
                  bind:value={unitForm.product}
                  options={unitProducts}
                  aria-label="unit product"
                  onchange={(value) => loadBlueprint(String(value))}
                />
              </Field>
              <Field label="kind">
                <Select
                  bind:value={unitForm.kind}
                  options={unitKinds.kinds}
                  creatable={unitKinds.free}
                  aria-label="unit kind"
                />
              </Field>
              <Field label="slug">
                <input aria-label="unit slug" bind:value={unitForm.slug} />
              </Field>
              <Field label="name">
                <input aria-label="unit name" bind:value={unitForm.name} />
              </Field>
              <Field label="inside">
                <Select
                  bind:value={unitForm.parent}
                  options={[{ value: "", label: "none" }, ...sameProductUnits]}
                  aria-label="inside"
                />
              </Field>
              <Field label="template">
                <Select
                  bind:value={unitForm.template}
                  options={[{ value: "", label: "none" }, ...sameProductUnits]}
                  aria-label="template"
                />
              </Field>
              <Button
                variant="primary"
                size="sm"
                {busy}
                disabled={!unitForm.slug.trim() ||
                  !unitForm.name.trim() ||
                  !unitForm.kind.trim()}
                onclick={addUnit}>add unit</Button
              >
            </div>
          {/if}
        </Group>

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
          <Group label="repos and projects">
            <div class="chips">
              {#each profile.repos as repo (repo.slug)}<Chip>{repo.slug}</Chip
                >{/each}
              {#each profile.projects as project (project.external_key)}
                <Chip tone="accent">{project.external_key}</Chip>
              {/each}
            </div>
          </Group>
        {/if}
      </div>

      <div class="col">
        {#if unitRead?.unit && selected}
          <Group
            label={unitRead.unit.name}
            hint="{unitRead.unit.kind} · {productName(unitRead.unit.product)}"
          >
            {#snippet action()}
              {#if canEditHere}
                <Button size="sm" variant="ghost" onclick={startEdit}
                  >edit</Button
                >
                <DeleteButton label="delete unit" onclick={deleteUnit} />
              {/if}
            {/snippet}
            {#if editing}
              <div class="form">
                <Field label="name">
                  <input aria-label="unit name" bind:value={editForm.name} />
                </Field>
                <Field label="kind">
                  <Select
                    bind:value={editForm.kind}
                    options={unitKindChoices(unitBlueprint, [selected.kind])
                      .kinds}
                    creatable={!unitBlueprint?.kinds.length}
                    aria-label="unit kind"
                  />
                </Field>
                <Field label="inside">
                  <Select
                    bind:value={editForm.parent}
                    options={[
                      { value: "", label: "none" },
                      ...units
                        .filter(
                          (u) =>
                            u.slug !== selected.slug &&
                            u.product_slug === selected.product_slug,
                        )
                        .map((u) => u.slug),
                    ]}
                    aria-label="inside"
                  />
                </Field>
                <Field label="template">
                  <Select
                    bind:value={editForm.template}
                    options={[
                      { value: "", label: "none" },
                      ...units
                        .filter(
                          (u) =>
                            u.slug !== selected.slug &&
                            u.product_slug === selected.product_slug,
                        )
                        .map((u) => u.slug),
                    ]}
                    aria-label="template"
                  />
                </Field>
                <Button variant="primary" size="sm" {busy} onclick={saveUnit}
                  >save</Button
                >
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => (editing = false)}>cancel</Button
                >
              </div>
            {/if}
            <div class="facts">
              {@render factRows(unitRead.facts)}
              {#each unitRead.missing ?? [] as missing (missing)}
                <div class="fact missing">
                  <span class="kind">{missing}</span>
                  <span class="label"></span>
                  <span class="value muted">not recorded</span>
                </div>
              {/each}
            </div>
            {#if canEditHere}{@render factEditor()}{/if}
          </Group>

          <Group label="documents">
            {#each unitRead.documents ?? [] as doc (doc.id)}
              <div class="item">
                <a href="/library/docs/{doc.id}" use:link>{doc.title}</a>
                {#if doc.unit !== selected.slug}<span class="from"
                    >from {doc.unit}</span
                  >{/if}
                {#if doc.original}
                  <a
                    class="original"
                    href="/api/reference/{doc.id}/file"
                    download
                    aria-label="download the original"
                    ><Icon name="download" size="1em" /></a
                  >
                {/if}
              </div>
            {/each}
            {#if canEditPart(rights, selected.product_slug) || (!selected.product_slug && uploadProducts.length)}
              <div class="form">
                {#if !selected.product_slug}
                  <Field label="product">
                    <Select
                      bind:value={uploadProduct}
                      options={uploadProducts.map((p) => ({
                        value: p,
                        label: productName(p),
                      }))}
                      aria-label="doc product"
                    />
                  </Field>
                {/if}
                <input
                  class="picker"
                  type="file"
                  accept=".pdf,.docx,.xlsx"
                  aria-label="document to upload"
                  bind:this={fileInput}
                  onchange={upload}
                />
                <Button
                  size="sm"
                  variant="primary"
                  icon="attach"
                  {busy}
                  disabled={!selected.product_slug && !uploadProduct}
                  onclick={() => fileInput?.click()}>upload a document</Button
                >
              </div>
            {/if}
          </Group>

          {#if unitRead.entries?.length}
            <Group label="entries">
              {#each unitRead.entries as entry (entry.id)}
                <div class="item">
                  <a href="/library/entries/{entry.id}" use:link
                    >{entry.title}</a
                  >
                  {#if entry.unit !== selected.slug}<span class="from"
                      >on {entry.unit}</span
                    >{/if}
                </div>
              {/each}
            </Group>
          {/if}
        {:else}
          <Group label="facts">
            <div class="facts">{@render factRows(profile.facts)}</div>
            {#if canEditHere}{@render factEditor()}{/if}
          </Group>

          {#if profile.library}
            <Group label="library">
              <p class="muted">
                {profile.library.entries} entries · {profile.library.docs} docs
              </p>
            </Group>
          {/if}

          {#if profile.conflicts.length}
            <Group label="outside the blueprint">
              {#each profile.conflicts as conflict (conflict.unit + conflict.problem)}
                <div class="item">
                  <a href="/customers/{slug}/{conflict.unit}" use:link
                    >{conflict.unit}</a
                  >
                  <span class="muted">{conflict.problem}</span>
                </div>
              {/each}
            </Group>
          {/if}
        {/if}

        {#if history.length}
          <Group label="history">
            {#each history as batch (batch.batch_id)}
              <div class="item">
                <span class="when">{fmtDate(batch.at)}</span>
                <span>{batchText(batch)}</span>
                <span class="muted">{batchAuthor(batch)}</span>
                {#if rights?.customer || rights?.products.length}
                  <Button
                    size="sm"
                    variant="ghost"
                    {busy}
                    onclick={() => restore(batch.batch_id)}>restore</Button
                  >
                {/if}
              </div>
            {/each}
          </Group>
        {/if}
      </div>
    </div>
  </div>
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
  .slug {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .notes {
    margin: var(--pad-2) 0 0;
  }
  .products,
  .chips,
  .link-product {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-2);
    margin-top: var(--pad-2);
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    column-gap: calc(var(--pad-4) * 3);
    align-items: start;
  }
  @media (max-width: 60rem) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    min-width: 0;
  }
  .product {
    margin: var(--pad-3) 0 var(--pad-1);
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .unit {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-1) var(--pad-2);
    padding-left: calc(var(--pad-2) + var(--depth, 0) * 1.25rem);
    color: inherit;
    text-decoration: none;
  }
  .unit:hover,
  .unit.current {
    background: var(--accent-dim);
  }
  .facts {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    column-gap: var(--pad-3);
    row-gap: var(--pad-1);
    align-items: center;
  }
  .fact {
    display: contents;
  }
  .kind,
  .value {
    font-family: var(--font-mono);
  }
  .meta {
    display: block;
    font-family: var(--font-ui);
  }
  .label,
  .from,
  .meta,
  .muted {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  /* Inherited facts read as context rather than as this unit's own record. */
  .fact.inherited .value,
  .fact.missing .kind {
    opacity: 0.65;
  }
  .form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--pad-2);
    margin-top: var(--pad-3);
  }
  .form :global(.field) {
    min-width: 8rem;
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
    padding: var(--pad-1) 0;
  }
  .when {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .original {
    color: inherit;
  }
  /* The native control is unstyleable; the button opens it. */
  .picker {
    display: none;
  }
</style>
