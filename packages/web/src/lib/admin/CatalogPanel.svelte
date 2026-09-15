<script lang="ts">
  import { Band, Bars, Card, Deck, Dial, Meter, Note, type Bar } from "../tui";
  import { showCustomer, t } from "../terms";
  import { census } from "./census.svelte";
  import Figure from "./Figure.svelte";
  import Gaps from "./Gaps.svelte";
  import Stat from "./Stat.svelte";

  const c = $derived(census.data.detail.catalog);
  const k = $derived(census.data.detail.knowledge);
  const loading = $derived(census.loading);

  const ratio = (n: number, of: number) => (of ? n / of : 1);

  const describedN = $derived(c.components - c.components_no_description);
  const described = $derived(ratio(describedN, c.components));

  const tree = $derived(
    c.components_by_product.map(
      (p): Bar => ({
        key: p.slug,
        label: p.name,
        value: p.n,
        tone: p.n ? "accent" : "warn",
      }),
    ),
  );

  /* The corpus the taxonomy above exists to file. Ordered as an entry moves
     through it, not by size, so the band reads the same on every deployment. */
  const STATUS_TONES = {
    approved: "ok",
    draft: "accent",
    deprecated: "warn",
    rejected: "danger",
    archived: "muted",
  } as const;

  const statuses = $derived(
    Object.entries(STATUS_TONES).map(([key, tone]) => ({
      key,
      label: key,
      n: k.by_status[key] ?? 0,
      tone,
    })),
  );

  const vocab = $derived([
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

<Deck>
  <Card label="the tree" span={2} {loading} lines={4}>
    {#if tree.length}
      <Bars rows={tree} unit="" />
      <span class="quiet">
        {c.products}
        {t("products")} · {c.components} components · {c.components_root} top level
      </span>
    {:else}
      <span class="quiet">no {t("products")} yet</span>
    {/if}
  </Card>

  <!-- A description is not decoration: it is the text an incoming question is
       matched against, so an undescribed component is one the agent cannot
       pick. That is why this is the dial and not a line in a caption. -->
  <Card label="described" {loading} lines={3}>
    <div class="dialrow">
      <Dial
        value={described}
        tone={c.components_no_description ? "warn" : "ok"}
        label="components with a description"
      >
        <Figure value={describedN} size="sm" />
      </Dial>
      <span class="quiet">
        of {c.components} components carry a description
      </span>
    </div>
  </Card>

  <!-- Figure and meter share a denominator on purpose: the bar underneath a
       count of products has to be about products, or it reads as a fraction of
       the number above it. Teams are the caption. -->
  <Stat
    label={t("products")}
    value={c.products}
    detail="{c.teams} {t('teams')} · {c.components} components"
    meter={ratio(c.products - c.products_no_component, c.products)}
    tone={c.products_no_component ? "warn" : "accent"}
    {loading}
  />

  <Card label="classified" span="full" {loading} lines={3}>
    {#if k.entries}
      <Band
        segments={statuses}
        total={k.entries}
        caption="{k.entries_no_component.toLocaleString()} of {k.entries.toLocaleString()} entries carry no component"
        label="knowledge entries by status"
      />
    {:else}
      <span class="quiet">nothing recorded yet</span>
    {/if}
  </Card>

  <Card label="vocabulary" {loading} lines={2}>
    <dl class="vocab">
      {#each vocab as v (v.key)}
        <dt>{v.label}</dt>
        <dd>
          <Meter
            value={ratio(v.n - v.missing, v.n)}
            width={8}
            tone={v.missing ? "warn" : "ok"}
            label="{v.label} described"
          />
          <span class="quiet">{v.n - v.missing} of {v.n}</span>
        </dd>
      {/each}
    </dl>
    <span class="quiet">carry a description</span>
  </Card>

  {#if showCustomer()}
    <Stat
      label={t("customers")}
      value={c.customers}
      detail="{c.customer_units} units in the estate"
      meter={ratio(c.customers - c.customers_no_domains, c.customers)}
      tone={c.customers_no_domains ? "warn" : "accent"}
      {loading}
    />
  {/if}

  <Card label="needs attention" span={2} {loading} lines={3}>
    <Gaps items={gaps} />
  </Card>
</Deck>

{#if census.error}
  <Note tone="danger">{census.error}</Note>
{/if}

<style>
  .quiet {
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .dialrow {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
    min-width: 0;
  }

  .vocab {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: var(--pad-1) var(--pad-2);
    margin: 0;
    width: 100%;
    min-width: 0;
    font-size: var(--fs-xs);
  }
  .vocab dt {
    color: var(--muted);
    letter-spacing: var(--label-spacing);
  }
  .vocab dd {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin: 0;
    min-width: 0;
  }
</style>
