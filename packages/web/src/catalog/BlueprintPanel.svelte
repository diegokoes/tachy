<script lang="ts">
  import type { ProductBlueprint, ProductRow } from "@tachy/contract";
  import { api } from "../api";
  import { canCurateScope } from "../access/session.svelte";
  import { createResource, errText } from "../resource.svelte";
  import { keep, recall } from "../shell/kept";
  import { t } from "../terms";
  import Group from "../settings/Group.svelte";
  import { Button, DeleteButton, Field, Note, Select } from "../tui";
  import { csv } from "../tui/fields";

  const products = createResource(() => api.get<ProductRow[]>("/products"), []);
  void products.reload();

  let productSlug = $state(recall("admin.blueprints.product", ""));
  $effect(() => keep("admin.blueprints.product", productSlug));
  let blueprint = $state<ProductBlueprint | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const product = $derived(products.data.find((p) => p.slug === productSlug));
  const canEdit = $derived(
    !!product && canCurateScope({ team_slug: product.team_slug }),
  );
  const kindSlugs = $derived(blueprint?.kinds.map((kind) => kind.slug) ?? []);

  $effect(() => {
    if (!productSlug && products.data.length)
      productSlug = products.data[0].slug;
  });

  async function load() {
    if (!productSlug) return;
    try {
      blueprint = await api.get<ProductBlueprint>(
        `/products/${productSlug}/blueprint`,
      );
      factForms = Object.fromEntries(
        blueprint.kinds.map((kind) => [
          kind.slug,
          factForms[kind.slug] ?? { kind: "", choices: "" },
        ]),
      );
      error = null;
    } catch (e) {
      error = errText(e);
    }
  }

  $effect(() => {
    void productSlug;
    void load();
  });

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

  const base = $derived(`/products/${productSlug}/blueprint/kinds`);

  let kindForm = $state({ slug: "", name: "", parent: "", template: "" });
  function addKind() {
    void change(() =>
      api.put(base, {
        slug: kindForm.slug.trim(),
        name: kindForm.name.trim(),
        parent_kind: kindForm.parent || null,
        template_kind: kindForm.template || null,
      }),
    );
    kindForm = { slug: "", name: "", parent: "", template: "" };
  }

  /** One draft per kind, so two kinds' fact forms never share text. */
  let factForms = $state<Record<string, { kind: string; choices: string }>>({});
  function addFact(kind: string) {
    const draft = factForms[kind];
    void change(() =>
      api.put(`${base}/${kind}/facts`, {
        kind: draft.kind.trim(),
        choices: csv(draft.choices),
      }),
    );
    factForms[kind] = { kind: "", choices: "" };
  }

  const edgeOptions = (exclude: string) => [
    { value: "", label: "none" },
    ...kindSlugs.filter((slug) => slug !== exclude),
  ];
</script>

<div class="panel">
  <div class="pick">
    <Field label={t("product")}>
      <Select
        bind:value={productSlug}
        options={products.data.map((p) => ({ value: p.slug, label: p.name }))}
        aria-label="blueprint product"
      />
    </Field>
  </div>

  {#if error}<Note tone="danger">{error}</Note>{/if}

  {#if blueprint}
    {#if !blueprint.kinds.length}
      <p class="muted">no blueprint: this product's units take any kind</p>
    {/if}
    {#each blueprint.kinds as kind (kind.slug)}
      <Group
        label={kind.name.toLowerCase() === kind.slug
          ? kind.name
          : `${kind.name} · ${kind.slug}`}
        hint={[
          kind.parent_kind ? `inside ${kind.parent_kind}` : "",
          kind.template_kind ? `follows ${kind.template_kind}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined}
      >
        {#snippet action()}
          {#if canEdit}
            <DeleteButton
              label="delete kind"
              onclick={() => change(() => api.delete(`${base}/${kind.slug}`))}
            />
          {/if}
        {/snippet}
        {#if canEdit}
          <div class="form">
            <Field label="inside">
              <Select
                value={kind.parent_kind ?? ""}
                options={edgeOptions(kind.slug)}
                aria-label="inside"
                onchange={(value) =>
                  change(() =>
                    api.patch(`${base}/${kind.slug}`, {
                      parent_kind: String(value) || null,
                    }),
                  )}
              />
            </Field>
            <Field label="template">
              <Select
                value={kind.template_kind ?? ""}
                options={edgeOptions(kind.slug)}
                aria-label="template"
                onchange={(value) =>
                  change(() =>
                    api.patch(`${base}/${kind.slug}`, {
                      template_kind: String(value) || null,
                    }),
                  )}
              />
            </Field>
          </div>
        {/if}
        <div class="facts">
          {#each kind.facts as fact (fact.kind)}
            <span class="kind">{fact.kind}</span>
            <span class="muted">{fact.choices.join(", ")}</span>
            <span>
              {#if canEdit}
                <DeleteButton
                  label="remove fact"
                  onclick={() =>
                    change(() =>
                      api.delete(`${base}/${kind.slug}/facts/${fact.kind}`),
                    )}
                />
              {/if}
            </span>
          {/each}
        </div>
        {#if canEdit}
          <div class="form">
            <Field label="fact">
              <input
                aria-label="fact kind"
                bind:value={factForms[kind.slug].kind}
              />
            </Field>
            <Field label="choices">
              <input
                aria-label="fact choices"
                bind:value={factForms[kind.slug].choices}
              />
            </Field>
            <Button
              size="sm"
              variant="ghost"
              {busy}
              disabled={!factForms[kind.slug]?.kind.trim()}
              onclick={() => addFact(kind.slug)}>add fact</Button
            >
          </div>
        {/if}
      </Group>
    {/each}

    {#if canEdit}
      <Group label="add a kind">
        <div class="form">
          <Field label="slug">
            <input aria-label="kind slug" bind:value={kindForm.slug} />
          </Field>
          <Field label="name">
            <input aria-label="kind name" bind:value={kindForm.name} />
          </Field>
          <Field label="inside">
            <Select
              bind:value={kindForm.parent}
              options={edgeOptions("")}
              aria-label="inside"
            />
          </Field>
          <Field label="template">
            <Select
              bind:value={kindForm.template}
              options={edgeOptions("")}
              aria-label="template"
            />
          </Field>
          <Button
            size="sm"
            variant="primary"
            {busy}
            disabled={!kindForm.slug.trim() || !kindForm.name.trim()}
            onclick={addKind}>add kind</Button
          >
        </div>
      </Group>
    {/if}
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    max-width: 52rem;
  }
  .pick {
    max-width: 20rem;
  }
  .form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--pad-2);
    margin-top: var(--pad-2);
  }
  .form :global(.field) {
    min-width: 8rem;
  }
  .facts {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    column-gap: var(--pad-3);
    row-gap: var(--pad-1);
    align-items: center;
    margin-top: var(--pad-2);
  }
  .kind {
    font-family: var(--font-mono);
  }
  .muted {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
</style>
