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
  /** The profile it conforms to, when it has one — the sibling-boost case. */
  profileId: string | null;
}

export interface Catalog {
  customers: SeededCustomer[];
  components: SeededComponent[];
  patterns: string[];
  labels: string[];
  /** One customer's estate, so entries and tickets can be tagged against it. */
  units: SeededUnit[];
}

export async function seedCatalog(
  tx: Tx,
  v: Volumes,
  products: SeededProduct[],
): Promise<Catalog> {
  const patterns = PATTERN_SLUGS.slice(0, v.resolutionPatterns);
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
    { length: v.customers },
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

  const components = await seedComponents(tx, v, products);
  const labels = await seedLabels(tx, v, products);
  await seedCustomerComponents(tx, v, customers, components);
  const units = await seedCustomerFacts(tx, v, customers, components, products);

  return { customers, components, patterns, labels, units };
}

/**
 * Built one depth at a time so a child's parent always exists and always
 * belongs to the same product -- the recursive path walk in getComponentPath
 * assumes same-product ancestry, and (product_id, slug) assumes it too.
 */
async function seedComponents(
  tx: Tx,
  v: Volumes,
  products: SeededProduct[],
): Promise<SeededComponent[]> {
  const perProduct = Math.max(1, Math.floor(v.components / products.length));
  const roots = Math.max(1, Math.ceil(perProduct / 3));
  const components: SeededComponent[] = [];
  let n = 0;

  for (const p of products) {
    const mine: SeededComponent[] = [];
    for (let i = 0; i < perProduct; i++) {
      const name = COMPONENT_NAMES[i % COMPONENT_NAMES.length];
      const parent = i < roots ? null : mine[i % roots];
      mine.push({
        id: uuidFor("component", n++),
        slug:
          i >= COMPONENT_NAMES.length ? `${slugify(name)}-${i}` : slugify(name),
        productId: p.id,
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
  v: Volumes,
  products: SeededProduct[],
): Promise<string[]> {
  const perProduct = Math.max(1, Math.floor(v.labels / products.length));
  const rows: Record<string, unknown>[] = [];
  const slugs: string[] = [];
  for (const p of products)
    for (let i = 0; i < perProduct; i++) {
      const slug = `area-${i}`;
      slugs.push(slug);
      rows.push({
        id: uuidFor("label", rows.length),
        product_id: p.id,
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

/** A stride rather than a dense block, so the join table looks scattered. */
async function seedCustomerComponents(
  tx: Tx,
  v: Volumes,
  customers: SeededCustomer[],
  components: SeededComponent[],
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < v.customerComponents; i++) {
    const c = customers[i % customers.length];
    const comp = components[(i * 7) % components.length];
    const key = `${c.id}:${comp.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      customer_id: c.id,
      component_id: comp.id,
      notes: chance(rngFor("cc", i), 0.2) ? "Customer-specific build." : null,
    });
  }
  await insertRows(
    tx,
    "customer_components",
    ["customer_id", "component_id", "notes"],
    rows,
  );
}

/** (customer, kind, label) is enumerated, never sampled, so it stays unique. */
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

async function seedCustomerFacts(
  tx: Tx,
  v: Volumes,
  customers: SeededCustomer[],
  components: SeededComponent[],
  products: SeededProduct[],
): Promise<SeededUnit[]> {
  // One customer gets a real estate — two sites of lines, two of which share a
  // layout — so the resolution ladder and the unit tree have something to show.
  // The rest stay flat, which is the commoner shape.
  const unitRows: Record<string, unknown>[] = [];
  const unitIds = new Map<string, string>();
  const estateOwner = customers[0];
  if (estateOwner) {
    const unit = (
      slug: string,
      name: string,
      kind: string,
      parent?: string,
      profile?: string,
    ) => {
      const id = uuidFor("customer_unit", unitRows.length);
      unitIds.set(slug, id);
      unitRows.push({
        id,
        customer_id: estateOwner.id,
        parent_id: parent ? unitIds.get(parent) : null,
        profile_id: profile ? unitIds.get(profile) : null,
        kind,
        slug,
        name,
        aliases: [],
        notes: null,
      });
    };
    unit("layout-3", "Layout 3", "layout");
    unit("cantabria", "Altadis / Cantabria", "site");
    unit("logrono", "Logrono", "site");
    unit("tlc191", "TLC191", "line", "cantabria", "layout-3");
    unit("tlc192", "TLC192", "line", "cantabria", "layout-3");
    unit("tpc141", "TPC141", "line", "cantabria");
    unit("tpc146", "TPC146", "line", "logrono");
  }
  await insertRows(
    tx,
    "customer_units",
    [
      "id",
      "customer_id",
      "parent_id",
      "profile_id",
      "kind",
      "slug",
      "name",
      "aliases",
      "notes",
    ],
    unitRows,
  );

  const rows: Record<string, unknown>[] = [];

  // Facts at three levels of that estate, so a resolved read shows the ladder
  // actually choosing between them.
  if (estateOwner) {
    const at = (
      slug: string | null,
      kind: string,
      label: string,
      value: string,
    ) =>
      rows.push({
        id: uuidFor("customer_fact_unit", rows.length),
        customer_id: estateOwner.id,
        unit_id: slug ? unitIds.get(slug) : null,
        kind,
        label,
        value,
        notes: null,
        source: "seed",
        component_id: null,
      });
    at(null, "coding_mode", "", "CT1");
    at("cantabria", "timezone", "", "Europe/Madrid");
    at("layout-3", "coding_mode", "", "CT2");
    at("tlc191", "ip", "plc", "10.4.12.31");
    at("tlc191", "ip", "scada", "10.4.12.32");
    at("tpc141", "ip", "plc", "10.4.12.41");
  }

  outer: for (const c of customers) {
    for (const kind of FACT_KINDS) {
      // 'version' is per product, so the product slug is the label; the
      // others need none, and '' keeps the unique key usable.
      const labels = kind === "version" ? products.map((p) => p.slug) : [""];
      for (const label of labels) {
        if (rows.length >= v.customerFacts) break outer;
        const i = rows.length;
        const rng = rngFor("fact", i);
        rows.push({
          id: uuidFor("customer_fact", i),
          customer_id: c.id,
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
    profileId: (u.profile_id as string) ?? null,
  }));
}
