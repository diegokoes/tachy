<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource, errText } from "../resource.svelte";
  import { t } from "../terms";
  import {
    Badge,
    Button,
    Chip,
    CrudTable,
    Note,
    Select,
    type Column,
  } from "../tui";
  import { slugify, uniqueSlug } from "../slug";
  import {
    csv,
    INFO,
    TIP,
    type Component,
    type Customer,
    type Product,
  } from "./shared";

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

  let expanded = $state(new Set<string>());
  let profiles = $state<Record<string, Profile>>({});
  let facts = $state<Record<string, FactRow[]>>({});
  let components = $state<Record<string, Component[]>>({});
  let kinds = $state<{ kind: string; count: number }[]>([]);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);

  /* One row of each form per customer, so two open profiles never share a draft. */
  let factForm = $state({ kind: "", label: "", value: "" });
  let compForm = $state({ product: "", component: "" });

  async function loadProfile(slug: string) {
    try {
      const [p, f] = await Promise.all([
        api.get<Profile>(`/customers/${slug}/profile`),
        api.get<FactRow[]>(`/customers/${slug}/facts`),
      ]);
      profiles[slug] = p;
      facts[slug] = f;
    } catch (e) {
      error = errText(e);
    }
  }

  async function loadComponents(productSlug: string) {
    if (!productSlug || components[productSlug]) return;
    try {
      components[productSlug] = await api.get<Component[]>(
        `/products/${productSlug}/components`,
      );
    } catch {
      components[productSlug] = [];
    }
  }

  async function toggle(slug: string) {
    const next = new Set(expanded);
    if (next.has(slug)) {
      next.delete(slug);
      expanded = next;
      return;
    }
    next.add(slug);
    expanded = next;
    factForm = { kind: "", label: "", value: "" };
    compForm = { product: products.data[0]?.slug ?? "", component: "" };
    if (compForm.product) await loadComponents(compForm.product);
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
      });
      factForm = { kind: "", label: "", value: "" };
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
      hint: TIP.slug,
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
      hint: TIP.emailDomains,
      info: INFO.emailDomains,
      value: (r) => (r.email_domains ?? []).join(", "),
    },
    {
      key: "aliases",
      label: "aliases",
      formOnly: true,
      edit: "text",
      hint: TIP.aliases.customer,
      info: INFO.aliases.customer,
      value: (r) => (r.aliases ?? []).join(", "),
    },
    { key: "notes", label: "notes", edit: "textarea" },
  ]);

  onMount(() => {
    customers.reload();
    products.reload();
  });
</script>

{#snippet detail(r: Customer)}
  {@const p = profiles[r.slug]}
  <div class="profile">
    <div class="block wide">
      <span
        class="dim"
        title="True of THIS install and nobody else — the version they run, their layout, an integration they depend on. A fact, not a problem and its fix."
        >specifics</span
      >
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
          Nothing recorded — an answer for them is only as good as what is here.
        </span>
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
          placeholder="4.2.1"
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
      <datalist id="fact-kinds">
        {#each kinds as k}<option value={k.kind}></option>{/each}
      </datalist>
      {#if kinds.length}
        <span class="dim sm">
          already in use: {kinds.map((k) => k.kind).join(", ")} — reuse one
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
          onchange={(v) => loadComponents(String(v))}
        />
        <Select
          bind:value={compForm.component}
          aria-label="component"
          options={[
            { value: "", label: "component…" },
            ...(components[compForm.product] ?? []).map((c) => ({
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
            no repo or project is filed under them — set those on the repo and
            project rows.
          </span>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}

<CrudTable
  {columns}
  rows={customers.data}
  rowKey={(r) => r.slug}
  expand={detail}
  {expanded}
  ontoggle={toggle}
  loading={customers.loading}
  error={customers.error}
  emptyTitle={`No ${t("customers")} yet.`}
  emptyDetail={`Attribution is by the requester's email domain, so a ${t("customer")} needs its domains listed.`}
  addLabel={`add ${t("customer")}`}
  editTitle={(r) => r.name}
  oncreate={(d) =>
    customers.mutate(() =>
      api.post("/customers", {
        slug: d.slug,
        name: d.name,
        aliases: csv(String(d.aliases ?? "")),
        emailDomains: csv(String(d.email_domains ?? "")),
        notes: d.notes || undefined,
      }),
    )}
  onsave={(row, d) =>
    customers.mutate(() =>
      api.patch(`/customers/${row.slug}`, {
        name: d.name,
        aliases: csv(String(d.aliases ?? "")),
        emailDomains: csv(String(d.email_domains ?? "")),
        notes: d.notes || null,
      }),
    )}
  ondelete={(row) => customers.mutate(() => api.delete(`/customers/${row.slug}`))}
/>

<style>
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
