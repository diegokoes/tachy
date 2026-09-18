<script lang="ts">
  import {
    Bars,
    Columns,
    Dial,
    Note,
    Ranking,
    compact,
    dayOfMonth,
    type Bar,
    type Col,
  } from "../tui";
  import { activity } from "./activity.svelte";
  import { showCustomer, t } from "../terms";
  import { census } from "./census.svelte";
  import Counts from "./Counts.svelte";
  import Figure from "./Figure.svelte";
  import Gaps from "./Gaps.svelte";
  import Overview from "./Overview.svelte";

  const c = $derived(census.data.detail.catalog);
  const k = $derived(census.data.detail.knowledge);
  const s = $derived(census.data.detail.sources);
  const loading = $derived(census.loading);

  const ratio = (n: number, of: number) => (of ? n / of : 1);

  const figures = $derived([
    { key: "teams", label: t("teams"), value: c.teams, to: "teams" },
    { key: "products", label: t("products"), value: c.products, to: "products" },
    {
      key: "components",
      label: "components",
      value: c.components,
      detail: `${c.components_root} top level`,
      to: "components",
    },
    { key: "labels", label: "labels", value: c.labels, to: "labels" },
    { key: "patterns", label: "patterns", value: c.patterns, to: "patterns" },
    { key: "entries", label: "knowledge entries", value: k.entries },
    ...(showCustomer()
      ? [
          {
            key: "customers",
            label: t("customers"),
            value: c.customers,
            detail: [
              `${c.customer_units} units`,
              s.projects_for_customer
                ? `${s.projects_for_customer} projects`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
            to: "customers",
          },
        ]
      : []),
  ]);

  /* A description is not decoration: it is the text an incoming question is
     matched against, so an undescribed component is one the agent cannot pick.
     One question asked of three kinds of thing, so it is drawn three times the
     same way — the ring is the whole health read for this page. */
  const described = $derived([
    {
      key: "components",
      label: "components",
      n: c.components,
      missing: c.components_no_description,
    },
    {
      key: "labels",
      label: "labels",
      n: c.labels,
      missing: c.labels_no_description,
    },
    {
      key: "patterns",
      label: "patterns",
      n: c.patterns,
      missing: c.patterns_no_description,
    },
  ]);

  const bySize = $derived(
    [...c.components_by_product]
      .sort((a, b) => b.n - a.n)
      .map((p): Bar => ({ key: p.slug, label: p.name, value: p.n })),
  );

  const concentration = $derived.by(() => {
    const total = bySize.reduce((sum, p) => sum + p.value, 0);
    if (!total || bySize.length < 4) return null;
    if (bySize.every((p) => p.value === bySize[0].value)) return null;
    const head = bySize.slice(0, 3).reduce((sum, p) => sum + p.value, 0);
    return `top 3 hold ${Math.round((head / total) * 100)}%`;
  });

  const treeCaption = $derived(
    [
      `${c.products} ${t("products")}`,
      `${c.components} components`,
      concentration,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  /* The corpus the taxonomy above exists to file. Ordered as an entry moves
     through it, not by size, so the chart reads the same on every deployment. */
  const STATUS_TONES = {
    approved: "ok",
    draft: "accent",
    deprecated: "warn",
    rejected: "danger",
    archived: "muted",
  } as const;

  const statuses = $derived(
    Object.entries(STATUS_TONES).map(
      ([key, tone]): Col => ({
        key,
        label: key,
        value: k.by_status[key] ?? 0,
        tone,
      }),
    ),
  );

  const library = $derived(activity.data.library);

  const readsPerDay = $derived(
    library.per_day.map(
      (d): Col => ({ key: d.day, label: dayOfMonth(d.day), value: d.reads }),
    ),
  );

  const mostRead = $derived(
    library.top.map((item) => ({
      key: item.id,
      label: item.title,
      note: `${item.kind} · ${item.readers} ${item.readers === 1 ? "reader" : "readers"}`,
      value: compact(item.reads),
    })),
  );

  const gaps = $derived([
    {
      n: c.teams_no_product,
      label: `${t("teams")} that own nothing`,
      tone: "warn" as const,
      to: "teams",
    },
    {
      n: c.products_no_component,
      label: `${t("products")} with no components`,
      tone: "warn" as const,
      to: "products",
    },
    {
      n: c.components_no_description,
      label: "components with no description",
      tone: "warn" as const,
      to: "components",
    },
    {
      n: c.labels_no_description,
      label: "labels with no description",
      tone: "warn" as const,
      to: "labels",
    },
    {
      n: c.patterns_no_description,
      label: "resolution patterns with no description",
      tone: "warn" as const,
      to: "patterns",
    },
    ...(showCustomer()
      ? [
          {
            n: c.customers_no_domains,
            label: `${t("customers")} with no email domain`,
            tone: "warn" as const,
            to: "customers",
          },
        ]
      : []),
  ]);
</script>

{#snippet engagement()}
  <span class="title spaced">
    library · last {library.days} days · {compact(library.reads)} reads by
    {library.readers}
    {library.readers === 1 ? "person" : "people"}
    {#if library.corrections}
      · {library.corrections}
      {library.corrections === 1 ? "correction" : "corrections"} filed
    {/if}
  </span>
  {#if library.reads}
    <Columns rows={readsPerDay} format={compact} height="5rem" />
    <span class="subtitle">most read</span>
    <Ranking rows={mostRead} />
  {:else}
    <span class="quiet">nobody has read anything in the last {library.days} days</span>
  {/if}
{/snippet}

<Overview>
  {#snippet counts()}
    <Counts items={figures} {loading} />
  {/snippet}

  {#snippet health()}
    <div class="dials">
      {#each described as v (v.key)}
        <div class="one">
          <Dial
            value={ratio(v.n - v.missing, v.n)}
            tone={v.missing ? "warn" : "ok"}
            label="{v.label} with a description"
          >
            <Figure value={v.n - v.missing} size="sm" />
          </Dial>
          <span class="name">{v.label}</span>
          <span class="note">of {v.n}</span>
        </div>
      {/each}

      {#if showCustomer()}
        <div class="one">
          <Dial
            value={ratio(c.customers - c.customers_no_domains, c.customers)}
            tone={c.customers_no_domains ? "warn" : "ok"}
            label="{t('customers')} with an email domain"
          >
            <Figure value={c.customers - c.customers_no_domains} size="sm" />
          </Dial>
          <span class="name">{t("customers")}</span>
          <span class="note">of {c.customers} have a domain</span>
        </div>
      {/if}
    </div>
  {/snippet}

  {#snippet detail()}
    {#if bySize.length}
      <span class="title">components per {t("product")}</span>
      <Bars rows={bySize} unit="components" />
      <span class="quiet">{treeCaption}</span>
    {:else}
      <span class="quiet">no {t("products")} yet</span>
    {/if}

    {#if k.entries}
      <!-- Label beside the bars, not above them: the bars are short and wide,
           so a title on its own row spent a line of height on nothing. -->
      <div class="beside spaced">
        <div class="beside-label">
          <span class="title">knowledge entries by status</span>
        </div>
        <Columns rows={statuses} />
      </div>
    {/if}

    {@render engagement()}
  {/snippet}


  {#snippet attention()}
    <Gaps items={gaps} />
  {/snippet}
</Overview>

{#if census.error}
  <Note tone="danger">{census.error}</Note>
{/if}

<style>
  .dials {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--pad-4);
    min-width: 0;
  }
  .one {
    flex: 1 1 8rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-1);
    text-align: center;
  }
  .name {
    font-size: var(--fs-sm);
    letter-spacing: var(--label-spacing);
  }
  .note {
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .title {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .title.spaced {
    margin-top: var(--pad-4);
  }
  .quiet {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .beside {
    display: grid;
    grid-template-columns: minmax(10rem, 16rem) minmax(0, 1fr);
    align-items: center;
    gap: var(--pad-4);
    min-width: 0;
  }
  .beside-label {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    min-width: 0;
  }
  .beside.spaced {
    margin-top: var(--pad-4);
  }
  @media (max-width: 40rem) {
    .beside {
      grid-template-columns: 1fr;
    }
  }

  .subtitle {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
