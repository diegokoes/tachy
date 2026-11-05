import { insertRows, type Tx } from "./batches";
import {
  chance,
  intBetween,
  pick,
  pickMany,
  rngFor,
  uuidFor,
} from "./deterministic";
import {
  COMPONENT_NAMES,
  CUSTOMER_NAMES,
  FACT_KINDS,
  PATTERN_SLUGS,
  slugify,
} from "./corpus";
import type { SeededProduct } from "./org";
import type { Volumes } from "./scale";

export interface SeededComponent {
  id: string;
  slug: string;
  productId: string;
  parentId: string | null;
}
export interface SeededCustomer {
  id: string;
  slug: string;
}
export interface SeededUnit {
  id: string;
  slug: string;
  customerId: string;
  /** Null for a general unit; an item is filed under it only in its product. */
  productId: string | null;
  /** The template it follows, when it has one - the sibling-boost case. */
  templateId: string | null;
}

export interface Catalog {
  customers: SeededCustomer[];
  components: SeededComponent[];
  patterns: string[];
  labels: string[];
  /** Two customers' setups, so entries and tickets can be tagged against them. */
  units: SeededUnit[];
}

export async function seedCatalog(
  tx: Tx,
  volumes: Volumes,
  products: SeededProduct[],
): Promise<Catalog> {
  const patterns = PATTERN_SLUGS.slice(0, volumes.resolutionPatterns);
  await insertRows(
    tx,
    "resolution_patterns",
    ["slug", "description"],
    patterns.map((slug) => ({
      slug,
      description: `Seeded pattern: ${slug.replace(/-/g, " ")}.`,
    })),
  );

  const customers: SeededCustomer[] = Array.from(
    { length: volumes.customers },
    (_, i) => ({
      id: uuidFor("customer", i),
      slug:
        i >= CUSTOMER_NAMES.length
          ? `${slugify(CUSTOMER_NAMES[i % CUSTOMER_NAMES.length])}-${i}`
          : slugify(CUSTOMER_NAMES[i]),
    }),
  );
  await insertRows(
    tx,
    "customers",
    ["id", "name", "slug", "aliases", "email_domains", "notes"],
    customers.map((c, i) => {
      const base = CUSTOMER_NAMES[i % CUSTOMER_NAMES.length];
      const rng = rngFor("customer", i);
      return {
        id: c.id,
        name: i >= CUSTOMER_NAMES.length ? `${base} ${i}` : base,
        slug: c.slug,
        aliases: chance(rng, 0.3) ? [base.split(" ")[0]] : [],
        email_domains: [`${c.slug}.example`],
        notes: chance(rng, 0.25) ? "Seeded customer record." : null,
      };
    }),
  );

  const components = await seedComponents(tx, volumes, products);
  const labels = await seedLabels(tx, volumes, products);
  const runs = await seedCustomerComponents(tx, volumes, customers, components);
  await seedBlueprints(tx, products);
  const units = await seedCustomerFacts(
    tx,
    volumes,
    customers,
    components,
    products,
  );
  await seedCustomerProducts(tx, [
    ...runs,
    ...units.flatMap((u) =>
      u.productId ? [{ customerId: u.customerId, productId: u.productId }] : [],
    ),
  ]);

  return { customers, components, patterns, labels, units };
}

/**
 * Built one depth at a time so a child's parent always exists and belongs to
 * the same product: the recursive path walk in `getComponentPath` assumes
 * same-product ancestry, and (product_id, slug) assumes it too.
 */
async function seedComponents(
  tx: Tx,
  volumes: Volumes,
  products: SeededProduct[],
): Promise<SeededComponent[]> {
  // Skewed like a real catalog, a few sprawling products and a long tail; an
  // even split draws the overview's components-per-product curve flat.
  // Zipf-like weights, floored so every product has a parent and a child.
  const weights = products.map((_, rank) => 1 / (rank + 1) ** 0.8);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) =>
    Math.max(3, Math.round((volumes.components * w) / weightSum)),
  );
  const components: SeededComponent[] = [];
  let n = 0;

  for (const [index, product] of products.entries()) {
    const perProduct = counts[index];
    const roots = Math.max(1, Math.ceil(perProduct / 3));
    const mine: SeededComponent[] = [];
    for (let i = 0; i < perProduct; i++) {
      const name = COMPONENT_NAMES[i % COMPONENT_NAMES.length];
      const parent = i < roots ? null : mine[i % roots];
      mine.push({
        id: uuidFor("component", n++),
        slug:
          i >= COMPONENT_NAMES.length ? `${slugify(name)}-${i}` : slugify(name),
        productId: product.id,
        parentId: parent ? parent.id : null,
      });
    }
    components.push(...mine);
  }

  for (const depth of [0, 1]) {
    const batch = components.filter((c) =>
      depth === 0 ? c.parentId === null : c.parentId !== null,
    );
    await insertRows(
      tx,
      "components",
      [
        "id",
        "product_id",
        "parent_id",
        "slug",
        "name",
        "description",
        "aliases",
      ],
      batch.map((c, i) => ({
        id: c.id,
        product_id: c.productId,
        parent_id: c.parentId,
        slug: c.slug,
        name: c.slug.replace(/-/g, " "),
        description: `Seeded component: ${c.slug.replace(/-/g, " ")}.`,
        aliases: chance(rngFor("component-alias", i), 0.2) ? [c.slug] : [],
      })),
    );
  }
  return components;
}

async function seedLabels(
  tx: Tx,
  volumes: Volumes,
  products: SeededProduct[],
): Promise<string[]> {
  const perProduct = Math.max(1, Math.floor(volumes.labels / products.length));
  const rows: Record<string, unknown>[] = [];
  const slugs: string[] = [];
  for (const product of products)
    for (let i = 0; i < perProduct; i++) {
      const slug = `area-${i}`;
      slugs.push(slug);
      rows.push({
        id: uuidFor("label", rows.length),
        product_id: product.id,
        slug,
        description: `Seeded label ${i}.`,
      });
    }
  await insertRows(
    tx,
    "labels",
    ["id", "product_id", "slug", "description"],
    rows,
  );
  return slugs;
}

interface ProductUse {
  customerId: string;
  productId: string;
}

/**
 * A stride rather than a dense block, so the join table looks scattered.
 * Returns which product each link puts the customer in.
 */
async function seedCustomerComponents(
  tx: Tx,
  volumes: Volumes,
  customers: SeededCustomer[],
  components: SeededComponent[],
): Promise<ProductUse[]> {
  const rows: Record<string, unknown>[] = [];
  const uses: ProductUse[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < volumes.customerComponents; i++) {
    const customer = customers[i % customers.length];
    const comp = components[(i * 7) % components.length];
    const key = `${customer.id}:${comp.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      customer_id: customer.id,
      component_id: comp.id,
      notes: chance(rngFor("cc", i), 0.2) ? "Customer-specific build." : null,
    });
    uses.push({ customerId: customer.id, productId: comp.productId });
  }
  await insertRows(
    tx,
    "customer_components",
    ["customer_id", "component_id", "notes"],
    rows,
  );
  return uses;
}

/** What `saveKnowledgeEntry` and the unit writes do as a side effect: link the product. */
async function seedCustomerProducts(tx: Tx, uses: ProductUse[]): Promise<void> {
  const pairs = new Map(
    uses.map((use) => [`${use.customerId}:${use.productId}`, use]),
  );
  await insertRows(
    tx,
    "customer_products",
    ["customer_id", "product_id"],
    [...pairs.values()].map((use) => ({
      customer_id: use.customerId,
      product_id: use.productId,
    })),
  );
}

/**
 * The first product is shaped like trellis: sites hold lines, and lines
 * follow a layout. The second has integrations, as a reporting product does.
 */
async function seedBlueprints(
  tx: Tx,
  products: SeededProduct[],
): Promise<void> {
  const [lines, integrations] = products;
  const kinds: Record<string, unknown>[] = [];
  const facts: Record<string, unknown>[] = [];
  const kind = (
    product: SeededProduct,
    slug: string,
    name: string,
    edges: { parent?: string; template?: string } = {},
  ) => {
    const id = uuidFor(`unit_kind_${product.slug}`, kinds.length);
    kinds.push({
      id,
      product_id: product.id,
      slug,
      name,
      parent_kind_id: edges.parent ?? null,
      template_kind_id: edges.template ?? null,
      position: kinds.length,
    });
    return id;
  };
  const fact = (kindId: string, slug: string, choices: string[] = []) =>
    facts.push({
      id: uuidFor("unit_kind_fact", facts.length),
      unit_kind_id: kindId,
      kind: slug,
      choices,
      position: facts.length,
    });

  if (lines) {
    const site = kind(lines, "site", "Site");
    const layout = kind(lines, "layout", "Line layout");
    const line = kind(lines, "line", "Production line", {
      parent: site,
      template: layout,
    });
    fact(site, "timezone");
    fact(layout, "printers");
    fact(line, "ip");
    fact(line, "coding_mode", ["CT1", "CT2", "CT3"]);
  }
  if (integrations) {
    const integration = kind(integrations, "integration", "Integration");
    fact(integration, "system", ["SAP", "Dynamics 365", "Oracle WMS"]);
    fact(integration, "connection");
    fact(integration, "version");
  }
  await insertRows(
    tx,
    "unit_kinds",
    [
      "id",
      "product_id",
      "slug",
      "name",
      "parent_kind_id",
      "template_kind_id",
      "position",
    ],
    kinds,
  );
  await insertRows(
    tx,
    "unit_kind_facts",
    ["id", "unit_kind_id", "kind", "choices", "position"],
    facts,
  );
}

/** A plausible value for each fact kind, so a profile reads like a profile. */
function factValue(kind: string, rng: () => number): string {
  switch (kind) {
    case "version":
      return `${intBetween(rng, 3, 9)}.${intBetween(rng, 0, 12)}.${intBetween(rng, 0, 9)}`;
    case "integration":
      return pick(rng, [
        "SAP via flat file, nightly",
        "SAP IDoc over RFC",
        "Oracle WMS over REST",
        "in-house MES, CSV drop",
        "Dynamics 365, hourly poll",
        "no upstream integration",
      ]);
    case "line_layout":
      return pick(rng, [
        "two lines, one shared scanner",
        "four lines, one printer each",
        "single line, dual lane",
        "three lines plus a rework station",
        "six lines across two halls",
      ]);
    case "contract":
      return pick(rng, [
        "annual, renews in Q3",
        "three-year, renews 2027",
        "annual, renews in January",
        "rolling monthly",
        "perpetual licence, support annual",
      ]);
    case "contact":
      return pick(rng, [
        "ops@example.com",
        "line-support@example.com",
        "night-shift lead, via the duty phone",
        "their integrator, not the site",
        "maintenance@example.com",
      ]);
    default:
      return pick(rng, ["yes", "no", "site-specific"]);
  }
}

/** One batch that added each seeded setup's units, so a history read has rows. */
async function seedSetupHistory(
  tx: Tx,
  unitRows: Record<string, unknown>[],
): Promise<void> {
  await insertRows(
    tx,
    "customer_changes",
    ["batch_id", "customer_id", "record", "record_id", "after", "actor"],
    unitRows.map((unit) => ({
      batch_id: uuidFor("customer_change_batch", 0),
      customer_id: unit.customer_id,
      record: "unit",
      record_id: unit.id,
      after: JSON.stringify(unit),
      actor: "web",
    })),
  );
}

/** (customer, kind, label) is enumerated, never sampled, so it stays unique. */
async function seedCustomerFacts(
  tx: Tx,
  volumes: Volumes,
  customers: SeededCustomer[],
  components: SeededComponent[],
  products: SeededProduct[],
): Promise<SeededUnit[]> {
  // Two real setups: lines in two sites, two following a layout, for the
  // resolution ladder and the unit tree; a second product's integrations. The
  // rest stay flat, which is the commoner shape.
  const unitRows: Record<string, unknown>[] = [];
  const unitIds = new Map<string, string>();
  const unit = (
    owner: SeededCustomer,
    product: SeededProduct,
    slug: string,
    name: string,
    kind: string,
    edges: { parent?: string; template?: string } = {},
  ) => {
    const id = uuidFor("customer_unit", unitRows.length);
    unitIds.set(slug, id);
    unitRows.push({
      id,
      customer_id: owner.id,
      product_id: product.id,
      parent_id: edges.parent ? unitIds.get(edges.parent) : null,
      template_id: edges.template ? unitIds.get(edges.template) : null,
      kind,
      slug,
      name,
      aliases: [],
      notes: null,
    });
  };
  const [setupOwner, integrationsOwner] = customers;
  const [lines, integrations] = products;
  if (setupOwner && lines) {
    unit(setupOwner, lines, "layout-3", "Layout 3", "layout");
    unit(setupOwner, lines, "calderra", "Altavon / Calderra", "site");
    unit(setupOwner, lines, "logrono", "Logrono", "site");
    for (const slug of ["pln191", "pln192"])
      unit(setupOwner, lines, slug, slug.toUpperCase(), "line", {
        parent: "calderra",
        template: "layout-3",
      });
    unit(setupOwner, lines, "tpc141", "TPC141", "line", {
      parent: "calderra",
    });
    unit(setupOwner, lines, "tpc146", "TPC146", "line", { parent: "logrono" });
  }
  if (integrationsOwner && integrations) {
    unit(integrationsOwner, integrations, "sap", "SAP", "integration");
    unit(
      integrationsOwner,
      integrations,
      "dynamics",
      "Dynamics 365",
      "integration",
    );
  }
  await insertRows(
    tx,
    "customer_units",
    [
      "id",
      "customer_id",
      "product_id",
      "parent_id",
      "template_id",
      "kind",
      "slug",
      "name",
      "aliases",
      "notes",
    ],
    unitRows,
  );

  await seedSetupHistory(tx, unitRows);

  const rows: Record<string, unknown>[] = [];

  // Facts at three levels of that setup, so a resolved read shows the ladder
  // choosing between them.
  const at = (
    owner: SeededCustomer,
    slug: string | null,
    kind: string,
    label: string,
    value: string,
  ) =>
    rows.push({
      id: uuidFor("customer_fact_unit", rows.length),
      customer_id: owner.id,
      unit_id: slug ? unitIds.get(slug) : null,
      kind,
      label,
      value,
      notes: null,
      source: "seed",
      component_id: null,
    });
  if (setupOwner && lines) {
    at(setupOwner, null, "coding_mode", "", "CT1");
    at(setupOwner, "calderra", "timezone", "", "Europe/Madrid");
    at(setupOwner, "layout-3", "coding_mode", "", "CT2");
    at(setupOwner, "pln191", "ip", "plc", "10.4.12.31");
    at(setupOwner, "pln191", "ip", "scada", "10.4.12.32");
    at(setupOwner, "tpc141", "ip", "plc", "10.4.12.41");
  }
  if (integrationsOwner && integrations) {
    at(integrationsOwner, "sap", "system", "", "SAP");
    at(integrationsOwner, "sap", "connection", "", "IDoc over RFC, nightly");
    at(integrationsOwner, "dynamics", "system", "", "Dynamics 365");
    at(integrationsOwner, "dynamics", "connection", "", "hourly poll");
  }

  outer: for (const customer of customers) {
    for (const kind of FACT_KINDS) {
      // 'version' is per product, so the product slug is the label; the
      // others need none, and '' keeps the unique key usable.
      const labels = kind === "version" ? products.map((p) => p.slug) : [""];
      for (const label of labels) {
        if (rows.length >= volumes.customerFacts) break outer;
        const i = rows.length;
        const rng = rngFor("fact", i);
        rows.push({
          id: uuidFor("customer_fact", i),
          customer_id: customer.id,
          unit_id: null,
          kind,
          label,
          // Per kind, or a 'contract' and an 'integration' come back with the
          // same sentence and the profile reads as noise.
          value: factValue(kind, rng),
          notes: null,
          source: "seed",
          component_id: chance(rng, 0.3)
            ? pickMany(rng, components, 1)[0].id
            : null,
        });
      }
    }
  }
  await insertRows(
    tx,
    "customer_facts",
    [
      "id",
      "customer_id",
      "unit_id",
      "kind",
      "label",
      "value",
      "notes",
      "source",
      "component_id",
    ],
    rows,
  );

  return unitRows.map((u) => ({
    id: u.id as string,
    slug: u.slug as string,
    customerId: u.customer_id as string,
    productId: (u.product_id as string) ?? null,
    templateId: (u.template_id as string) ?? null,
  }));
}
