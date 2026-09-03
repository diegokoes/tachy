import { insertRows, type Tx } from "./batches";
import { pastDate, pick, rngFor, uuidFor } from "./deterministic";
import {
  CONTEXTS,
  DIAGNOSTICS,
  IMPACTS,
  RESOLUTIONS,
  ROOT_CAUSES,
  SYMPTOMS,
} from "./corpus";
import type { SeededProduct, SeededUser } from "./org";

/**
 * A wiki per product plus the org-wide one, so the table of contents, category
 * pages and article outlines all have something to render in a dev database.
 * Articles are `reference_docs` rows with kind='wiki'; categories are their own
 * tree, and an article is deliberately filed under more than one.
 */
const CATEGORIES: { slug: string; name: string; children: string[] }[] = [
  { slug: "about", name: "About", children: [] },
  {
    slug: "installation",
    name: "Installation",
    children: ["requirements", "upgrading"],
  },
  {
    slug: "troubleshooting",
    name: "Troubleshooting",
    children: ["printing", "authentication"],
  },
  { slug: "hardware", name: "Hardware", children: ["printers"] },
];

const CHILD_NAMES: Record<string, string> = {
  requirements: "Requirements",
  upgrading: "Upgrading",
  printing: "Printing",
  authentication: "Authentication",
  printers: "Printers",
};

const ARTICLES: { slug: string; title: string; categories: string[] }[] = [
  { slug: "overview", title: "Overview", categories: ["about"] },
  { slug: "glossary", title: "Glossary", categories: ["about"] },
  {
    slug: "first-install",
    title: "First install",
    categories: ["requirements"],
  },
  { slug: "upgrade-notes", title: "Upgrade notes", categories: ["upgrading"] },
  // Filed twice on purpose: the many-to-many case the ToC has to render.
  {
    slug: "spooler-stalls",
    title: "Spooler stalls",
    categories: ["printing", "printers"],
  },
  {
    slug: "label-templates",
    title: "Label templates",
    categories: ["printing"],
  },
  {
    slug: "sso-loop",
    title: "SSO loop after token refresh",
    categories: ["authentication"],
  },
  // Deliberately uncategorised, so the "Uncategorised" bucket is non-empty.
  { slug: "field-notes", title: "Field notes", categories: [] },
];

/**
 * One template gave every wiki in the database the same nine bodies. The
 * product and the drawn detail make each page's prose its own, which is what
 * the lexical legs of search actually index.
 */
const BODY = (
  title: string,
  links: string[],
  scope: string,
  rng: () => number,
) =>
  `## Overview\n\n${title} — what it is and when it matters on ${scope}.` +
  (links.length ? ` See ${links.map((l) => `[[${l}]]`).join(" and ")}.` : "") +
  `\n\n## Architecture\n\nHow the pieces fit together. ${pick(rng, CONTEXTS)} is the case to watch.\n\n` +
  `### Components\n\nThe moving parts. ${pick(rng, DIAGNOSTICS)}.\n\n` +
  `## Common failures\n\n${pick(rng, SYMPTOMS)} — ${pick(rng, ROOT_CAUSES)}. ` +
  `${pick(rng, RESOLUTIONS)}, otherwise ${pick(rng, IMPACTS)}.\n`;

/**
 * Who links to whom. `not-written-yet` is deliberate: an unresolved link is a
 * state the reader has to be able to see, so the dev database has one.
 */
const LINKS: Record<string, string[]> = {
  main: ["overview", "first-install"],
  overview: ["glossary"],
  "spooler-stalls": ["label-templates", "not-written-yet"],
  "first-install": ["upgrade-notes"],
};

export async function seedWiki(
  tx: Tx,
  products: SeededProduct[],
  users: SeededUser[],
): Promise<void> {
  if (!users.length) return;

  // Which components each product divides into. Articles anchor to only some of
  // them on purpose: coverage is a gap report, so a dev database has to contain
  // components nobody has written about yet.
  const comps = await tx<{ id: string; product_id: string }[]>`
    select id, product_id from components order by product_id, slug
  `;
  const byProduct = new Map<string, string[]>();
  for (const c of comps)
    byProduct.set(c.product_id, [...(byProduct.get(c.product_id) ?? []), c.id]);

  // null = the org-wide wiki, which gets the same treatment as a product's.
  const scopes: {
    productId: string | null;
    teamId: string | null;
    name: string;
  }[] = [
    ...products.map((p) => ({
      productId: p.id,
      teamId: p.teamId,
      name: p.slug,
    })),
    { productId: null, teamId: null, name: "the whole estate" },
  ];

  const categoryRows: Record<string, unknown>[] = [];
  const articleRows: Record<string, unknown>[] = [];
  const membershipRows: Record<string, unknown>[] = [];

  // uuidFor keys on (kind, index), so the scope index is folded into the kind
  // to keep every wiki's categories distinct.
  scopes.forEach((scope, s) => {
    const catSlugs = [
      ...CATEGORIES.map((c) => c.slug),
      ...CATEGORIES.flatMap((c) => c.children),
    ];
    const catId = (slug: string) =>
      uuidFor(`wiki_category_${s}`, catSlugs.indexOf(slug));

    const own = scope.productId ? (byProduct.get(scope.productId) ?? []) : [];
    const anchorable = own.slice(0, Math.ceil(own.length / 2));

    CATEGORIES.forEach((c, ci) => {
      categoryRows.push({
        id: catId(c.slug),
        product_id: scope.productId,
        parent_id: null,
        slug: c.slug,
        name: c.name,
        description: `${c.name} for this product.`,
        ordinal: ci,
      });
      c.children.forEach((child, cj) => {
        categoryRows.push({
          id: catId(child),
          product_id: scope.productId,
          parent_id: catId(c.slug),
          slug: child,
          name: CHILD_NAMES[child] ?? child,
          description: null,
          ordinal: cj,
        });
      });
    });

    // The main page is an ordinary article at a reserved slug.
    const all = [
      { slug: "main", title: "Main page", categories: [] as string[] },
      ...ARTICLES,
    ];

    all.forEach((a, ai) => {
      const rng = rngFor(`wiki_article_${s}`, ai);
      const id = uuidFor(`wiki_article_${s}`, ai);
      articleRows.push({
        id,
        product_id: scope.productId,
        team_id: scope.teamId,
        created_by: users[ai % users.length].id,
        source: "seed",
        component_id:
          ai === 0 || !anchorable.length
            ? null
            : anchorable[(ai - 1) % anchorable.length],
        product_area: null,
        customer_id: null,
        title: a.title,
        body: BODY(a.title, LINKS[a.slug] ?? [], scope.name, rng),
        tags: [],
        structured: JSON.stringify({ seeded: true }),
        status: "approved",
        doc_version: null,
        kind: "wiki",
        slug: a.slug,
        version: 1,
        created_at: pastDate(rng, 200),
        updated_at: pastDate(rng, 60),
      });
      a.categories.forEach((c, ci) =>
        membershipRows.push({
          doc_id: id,
          category_id: catId(c),
          ordinal: ci,
        }),
      );
    });
  });

  await insertRows(
    tx,
    "wiki_categories",
    ["id", "product_id", "parent_id", "slug", "name", "description", "ordinal"],
    categoryRows,
  );

  await insertRows(
    tx,
    "reference_docs",
    [
      "id",
      "product_id",
      "team_id",
      "created_by",
      "source",
      "component_id",
      "product_area",
      "customer_id",
      "title",
      "body",
      "tags",
      "structured",
      "status",
      "doc_version",
      "kind",
      "slug",
      "version",
      "created_at",
      "updated_at",
    ],
    articleRows,
  );

  await insertRows(
    tx,
    "wiki_article_categories",
    ["doc_id", "category_id", "ordinal"],
    membershipRows,
  );

  // Edges are derived from the bodies above rather than invented, so the seeded
  // graph is the same shape syncLinks would have produced on a real save.
  const bySlug = new Map<string, string>();
  for (const a of articleRows)
    bySlug.set(`${a.product_id ?? "-"}:${a.slug}`, a.id as string);

  const linkRows: Record<string, unknown>[] = [];
  for (const a of articleRows) {
    for (const target of LINKS[a.slug as string] ?? []) {
      const to = bySlug.get(`${a.product_id ?? "-"}:${target}`) ?? null;
      linkRows.push({
        id: uuidFor("wiki_link", linkRows.length),
        from_doc_id: a.id,
        from_entry_id: null,
        to_doc_id: to,
        to_entry_id: null,
        kind: "mentions",
        target,
        label: target,
      });
    }
  }

  // Provenance: an article anchored to a component consolidates the entries
  // filed under it. Same edge `setComposedFrom` writes when the agent drafts a
  // page, so the "built from" footer and the staleness count have real input.
  //
  // One query for every anchored article, not one per article: at --scale=large
  // that loop was 189 round trips inside the bulk-load transaction.
  const anchored = [
    ...new Set(
      articleRows
        .filter((a) => a.component_id)
        .map((a) => a.component_id as string),
    ),
  ];
  const sourcesByComponent = new Map<string, string[]>();
  if (anchored.length) {
    const rows = await tx<{ component_id: string; id: string }[]>`
      select component_id, id from (
        select component_id, id,
               row_number() over (partition by component_id order by id) as rn
        from knowledge_entries
        where component_id = any(${anchored})
      ) ranked
      where rn <= 4
    `;
    for (const r of rows)
      sourcesByComponent.set(r.component_id, [
        ...(sourcesByComponent.get(r.component_id) ?? []),
        r.id,
      ]);
  }

  for (const a of articleRows)
    for (const src of sourcesByComponent.get(a.component_id as string) ?? [])
      linkRows.push({
        id: uuidFor("wiki_source_link", linkRows.length),
        from_doc_id: a.id,
        from_entry_id: null,
        to_doc_id: null,
        to_entry_id: src,
        kind: "composed_from",
        target: src,
        label: null,
      });

  await insertRows(
    tx,
    "library_links",
    [
      "id",
      "from_doc_id",
      "from_entry_id",
      "to_doc_id",
      "to_entry_id",
      "kind",
      "target",
      "label",
    ],
    linkRows,
  );

  // Articles get revision 1 like anything else written through core, so the
  // history panel is not empty on a seeded article.
  await insertRows(
    tx,
    "library_revisions",
    [
      "id",
      "knowledge_entry_id",
      "reference_doc_id",
      "version",
      "user_id",
      "actor",
      "turn_id",
      "changed_fields",
      "snapshot",
      "created_at",
    ],
    articleRows.map((a, i) => ({
      id: uuidFor("wiki_article_revision", i),
      knowledge_entry_id: null,
      reference_doc_id: a.id,
      version: 1,
      user_id: a.created_by,
      actor: "web",
      turn_id: null,
      changed_fields: [],
      snapshot: JSON.stringify({ seeded: true, title: a.title }),
      created_at: a.created_at,
    })),
  );
}
