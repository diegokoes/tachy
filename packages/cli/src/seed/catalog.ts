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
export interface Catalog {
  customers: SeededCustomer[];
  components: SeededComponent[];
  patterns: string[];
  labels: string[];
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
  await seedCustomerFacts(tx, v, customers, components, products);

  return { customers, components, patterns, labels };
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
async function seedCustomerFacts(
  tx: Tx,
  v: Volumes,
  customers: SeededCustomer[],
  components: SeededComponent[],
  products: SeededProduct[],
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
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
          kind,
          label,
          value:
            kind === "version"
              ? `${intBetween(rng, 3, 9)}.${intBetween(rng, 0, 12)}.${intBetween(rng, 0, 9)}`
              : pick(rng, [
                  "two lines, one shared scanner",
                  "SAP via flat file",
                  "annual, renews in Q3",
                  "ops@example.com",
                ]),
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
      "kind",
      "label",
      "value",
      "notes",
      "source",
      "component_id",
    ],
    rows,
  );
}
