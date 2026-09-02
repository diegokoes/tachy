import {
  CONFIDENCES,
  FEEDBACK_KINDS,
  KNOWLEDGE_STATUSES,
  REFERENCE_STATUSES,
  RESOLUTION_CLARITIES,
} from "@tachy/core";
import { insertRows, insertWindowed, type Tx } from "./batches";
import { embedColumn, type Embedder } from "./embed";
import {
  chance,
  intBetween,
  pastDate,
  pick,
  pickMany,
  rngFor,
  uuidFor,
} from "./deterministic";
import {
  CLOUDS,
  CONTEXTS,
  DIAGNOSTICS,
  DOC_TITLES,
  IMPACTS,
  RESOLUTIONS,
  ROOT_CAUSES,
  SECTION_HEADINGS,
  SYMPTOMS,
  TAGS,
} from "./corpus";
import type { SeededProduct, SeededUser } from "./org";
import type { SeededComponent, SeededCustomer, SeededUnit } from "./catalog";
import type { SeededProject, SeededWorkItem } from "./sources";
import type { Volumes } from "./scale";

export interface Knowledge {
  entries: string[];
  docs: string[];
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const bucket = out.get(k);
    if (bucket) bucket.push(x);
    else out.set(k, [x]);
  }
  return out;
}

/**
 * Note the column lists below: search_text, search_tsv and search_tsv_en are
 * GENERATED, and naming one in an insert is an error rather than a no-op.
 */
export async function seedKnowledge(
  tx: Tx,
  v: Volumes,
  products: SeededProduct[],
  users: SeededUser[],
  components: SeededComponent[],
  customers: SeededCustomer[],
  workItems: SeededWorkItem[],
  projects: SeededProject[],
  patterns: string[],
  units: SeededUnit[],
  embed: Embedder,
): Promise<Knowledge> {
  const entries = Array.from({ length: v.knowledgeEntries }, (_, i) =>
    uuidFor("knowledge_entry", i),
  );

  // Grouped once. Filtering the whole component list inside the row loop is
  // 25k x 250 comparisons at --scale=large, for an answer that never changes.
  const byProduct = groupBy(components, (c) => c.productId);
  const byCustomer = groupBy(units, (u) => u.customerId);

  await insertWindowed(
    tx,
    "knowledge_entries",
    [
      "id",
      "work_item_id",
      "product_id",
      "team_id",
      "customer_id",
      "customer_unit_id",
      "created_by",
      "status",
      "superseded_by",
      "issue_summary",
      "symptoms",
      "root_cause",
      "resolution",
      "resolution_pattern",
      "signals",
      "tags",
      "component_id",
      "product_area",
      "confidence",
      "cloud",
      "resolution_clarity",
      "hidden_fix",
      "affected_version",
      "fixed_version",
      "structured",
      "embedding",
      "created_at",
      "updated_at",
    ],
    v.knowledgeEntries,
    (i) => {
      const rng = rngFor("knowledge", i);
      /*
       * Drawn from the row's own stream rather than by `i % list.length`. Modular
       * cycling correlated the parts: ROOT_CAUSES and RESOLUTIONS are the same
       * length, so every entry paired cause N with fix N, and the whole corpus
       * collapsed to lcm(12,10,10) = 60 distinct bodies — and therefore 60
       * distinct embeddings, however many rows were asked for. Independent draws
       * plus the row-specific detail below keep the text effectively unique.
       */
      const product = pick(rng, products);
      const mine = byProduct.get(product.id) ?? [];
      const component = mine.length ? pick(rng, mine) : undefined;
      const symptom = pick(rng, SYMPTOMS);
      // One index for both: they are written as a matched cause/fix pair.
      const scenario = intBetween(
        rng,
        0,
        Math.min(ROOT_CAUSES.length, RESOLUTIONS.length) - 1,
      );
      const cause = ROOT_CAUSES[scenario];
      const fix = RESOLUTIONS[scenario];
      const context = pick(rng, CONTEXTS);
      const impact = pick(rng, IMPACTS);
      const diagnostic = pick(rng, DIAGNOSTICS);
      const errorCode = `E${intBetween(rng, 100, 999)}`;
      const affected = `${intBetween(rng, 3, 9)}.${intBetween(rng, 0, 12)}`;
      const created = pastDate(rng, 500);

      const customer = chance(rng, 0.5) ? pick(rng, customers) : null;
      const mineUnits = customer ? (byCustomer.get(customer.id) ?? []) : [];
      const unit =
        mineUnits.length && chance(rng, 0.66) ? pick(rng, mineUnits) : null;

      const summary = component
        ? `${symptom} on ${product.slug} ${component.slug} (${errorCode})`
        : `${symptom} on ${product.slug} (${errorCode})`;
      // The diagnostic is an observation, not a claim about the cause, so it goes
      // in signals rather than being asserted as part of the explanation.
      const rootCause = `${cause}. Seen ${context}.`;
      const resolution = `${fix}. Until then ${impact}. Confirmed on ${affected}.`;

      return {
        id: entries[i],
        work_item_id: workItems.length
          ? workItems[i % workItems.length].id
          : null,
        product_id: product.id,
        team_id: product.teamId,
        customer_id: customer ? customer.id : null,
        /*
         * Mirrors the product rule: a unit only ever sits beside the customer it
         * belongs to. Two thirds of the estate owner's entries land on a line, and
         * the lines that share a profile get enough of them for D3's sibling boost
         * to be visible rather than theoretical.
         */
        customer_unit_id: unit ? unit.id : null,
        created_by: users[i % users.length].id,
        status: pick(rng, KNOWLEDGE_STATUSES),
        // superseded_by is a second pass: see supersede() below.
        superseded_by: null,
        issue_summary: summary,
        symptoms: pickMany(rng, SYMPTOMS, intBetween(rng, 1, 3)),
        root_cause: rootCause,
        resolution: resolution,
        resolution_pattern: patterns.length ? pick(rng, patterns) : null,
        signals: [
          `error code ${errorCode}`,
          `${product.slug} ${affected}`,
          diagnostic,
        ],
        tags: pickMany(rng, TAGS, intBetween(rng, 1, 4)),
        component_id: component ? component.id : null,
        // product_area is DERIVED from the component hierarchy: filled by the
        // recursive-CTE pass in index.ts, exactly as saveKnowledgeEntry does.
        product_area: null,
        confidence: pick(rng, CONFIDENCES),
        cloud: pick(rng, CLOUDS),
        resolution_clarity: pick(rng, RESOLUTION_CLARITIES),
        hidden_fix: chance(rng, 0.15),
        affected_version: affected,
        fixed_version: chance(rng, 0.6)
          ? `${intBetween(rng, 9, 11)}.${intBetween(rng, 0, 6)}`
          : null,
        structured: JSON.stringify({ seeded: true }),
        // The embed text is the row's real prose, so distinct rows get distinct
        // vectors — the whole point of decorrelating the draws above. The column
        // holds it until the window's fill swaps in the vector.
        embedding: `${summary} ${rootCause} ${resolution}`,
        created_at: created,
        updated_at: created,
      };
    },
    { fill: embedColumn(embed, "knowledge_entry") },
  );

  await seedFeedback(tx, v, entries, users);
  const docs = await seedReference(
    tx,
    v,
    products,
    users,
    components,
    projects,
    embed,
  );

  return { entries, docs };
}

async function seedFeedback(
  tx: Tx,
  v: Volumes,
  entries: string[],
  users: SeededUser[],
): Promise<void> {
  if (!entries.length) return;
  const rows = Array.from({ length: v.knowledgeFeedback }, (_, i) => {
    const rng = rngFor("feedback", i);
    const kind = pick(rng, FEEDBACK_KINDS);
    return {
      id: uuidFor("knowledge_feedback", i),
      knowledge_entry_id: entries[i % entries.length],
      user_id: users[i % users.length].id,
      kind,
      rating: kind === "rating" ? intBetween(rng, 1, 5) : null,
      comment:
        kind === "rating"
          ? null
          : pick(rng, [
              "Confirmed on our install.",
              "The fix works but needs a restart.",
              "Superseded by the 9.2 firmware.",
              "Could use a screenshot.",
            ]),
      patch: null,
    };
  });
  await insertRows(
    tx,
    "knowledge_feedback",
    [
      "id",
      "knowledge_entry_id",
      "user_id",
      "kind",
      "rating",
      "comment",
      "patch",
    ],
    rows,
  );
}

async function seedReference(
  tx: Tx,
  v: Volumes,
  products: SeededProduct[],
  users: SeededUser[],
  components: SeededComponent[],
  projects: SeededProject[],
  embed: Embedder,
): Promise<string[]> {
  const byProduct = groupBy(components, (c) => c.productId);

  /** What a chunk needs from its parent, so the two read as one document. */
  const meta = Array.from({ length: v.referenceDocs }, (_, i) => {
    const rng = rngFor("reference", i);
    const product = pick(rng, products);
    const mine = byProduct.get(product.id) ?? [];
    const component = mine.length ? pick(rng, mine) : undefined;
    const title = pick(rng, DOC_TITLES);
    return {
      id: uuidFor("reference_doc", i),
      rng,
      product,
      component,
      title,
      fullTitle: i >= DOC_TITLES.length ? `${title} (${i})` : title,
    };
  });
  const docs = meta.map((m) => m.id);

  await insertWindowed(
    tx,
    "reference_docs",
    [
      "id",
      "product_id",
      "team_id",
      "created_by",
      "source",
      "source_project_id",
      "external_key",
      "component_id",
      "product_area",
      "customer_id",
      "title",
      "body",
      "tags",
      "structured",
      "status",
      "doc_version",
      "superseded_by",
      "version",
    ],
    v.referenceDocs,
    (i) => {
      const { rng, product, component, title } = meta[i];
      const project = pick(rng, projects);
      // Same reasoning as the entries above: independent draws, and a body built
      // from several of them, so docs do not collapse onto a handful of vectors.
      const docScenario = intBetween(
        rng,
        0,
        Math.min(ROOT_CAUSES.length, RESOLUTIONS.length) - 1,
      );
      const docBody = [
        `${title} — ${product.slug}${component ? ` / ${component.slug}` : ""}.`,
        `${ROOT_CAUSES[docScenario]}.`,
        `${RESOLUTIONS[docScenario]}.`,
        `Applies ${pick(rng, CONTEXTS)}. ${pick(rng, DIAGNOSTICS)}.`,
      ].join(" ");

      return {
        id: meta[i].id,
        product_id: product.id,
        team_id: product.teamId,
        created_by: users[i % users.length].id,
        source: "seed",
        source_project_id: chance(rng, 0.4) ? project.id : null,
        external_key: chance(rng, 0.4) ? `wiki/page-${i}` : null,
        component_id: component ? component.id : null,
        product_area: null,
        customer_id: null,
        title: meta[i].fullTitle,
        body: docBody,
        tags: pickMany(rng, TAGS, intBetween(rng, 1, 3)),
        structured: JSON.stringify({ seeded: true }),
        status: pick(rng, REFERENCE_STATUSES),
        doc_version: `${intBetween(rng, 1, 9)}.0`,
        superseded_by: null,
        version: 1,
      };
    },
  );

  const per = Math.max(
    1,
    Math.floor(v.referenceChunks / Math.max(1, docs.length)),
  );
  await insertWindowed(
    tx,
    "reference_doc_chunks",
    ["id", "doc_id", "ordinal", "chunk_text", "embedding"],
    docs.length * per,
    (i) => {
      const d = Math.floor(i / per);
      const k = i % per;
      const crng = rngFor("reference_chunk", i);
      const cs = intBetween(
        crng,
        0,
        Math.min(ROOT_CAUSES.length, RESOLUTIONS.length) - 1,
      );
      const parent = meta[d];
      /*
       * Anchored to its own document. The heading used to be drawn from
       * DOC_TITLES independently of `docs[d]`, which both made a chunk read as
       * if it belonged to a different page and capped the corpus at
       * 20x4x28x8 combinations — below the birthday bound for the 16k chunks
       * --scale=large asks for, so thousands were exact duplicates.
       */
      const heading = SECTION_HEADINGS[k % SECTION_HEADINGS.length];
      const chunkText = [
        `${parent.fullTitle} — ${heading} (${parent.product.slug}${parent.component ? ` / ${parent.component.slug}` : ""}).`,
        `${ROOT_CAUSES[cs]}. ${RESOLUTIONS[cs]}.`,
        `Applies ${pick(crng, CONTEXTS)}. ${pick(crng, DIAGNOSTICS)}.`,
        `Otherwise ${pick(crng, IMPACTS)}.`,
      ].join(" ");
      return {
        id: uuidFor("reference_doc_chunk", i),
        doc_id: parent.id,
        // (doc_id, ordinal) unique by construction.
        ordinal: k,
        // Embed the chunk's own text: embedding the literal string "section 3"
        // gave every third chunk in the corpus the same vector.
        chunk_text: chunkText,
        embedding: chunkText,
      };
    },
    { fill: embedColumn(embed, "reference_doc_chunk") },
  );

  return docs;
}

/**
 * A second pass rather than a forward reference inside the insert: a forward
 * reference happens to work in one statement (the FK trigger fires at the end
 * of it) and silently breaks the moment the insert splits across batches.
 */
export async function supersede(tx: Tx): Promise<void> {
  await tx`
    update knowledge_entries e
    set superseded_by = (
      select n.id from knowledge_entries n
      where n.product_id is not distinct from e.product_id
        and n.id <> e.id
        and n.status = 'approved'
      order by n.created_at desc
      limit 1
    )
    where e.status in ('deprecated', 'archived')
      and e.superseded_by is null
      and right(e.id::text, 1) = '0'
  `;
  await tx`
    update reference_docs d
    set superseded_by = (
      select n.id from reference_docs n
      where n.product_id is not distinct from d.product_id
        and n.id <> d.id
        and n.status = 'approved'
      order by n.created_at desc
      limit 1
    )
    where d.status = 'archived'
      and d.superseded_by is null
      and right(d.id::text, 1) = '0'
  `;
}

/**
 * product_area is derived from the component hierarchy at write time by
 * saveKnowledgeEntry (via getComponentPath). Same walk, one statement.
 */
export async function deriveProductAreas(tx: Tx): Promise<void> {
  const PATHS = `
    with recursive up as (
      select id as leaf, id, parent_id, name, 0 as depth from components
      union all
      select u.leaf, c.id, c.parent_id, c.name, u.depth + 1
      from components c join up u on c.id = u.parent_id
    ),
    path as (
      select leaf, string_agg(name, ' / ' order by depth desc) as p
      from up group by leaf
    )`;
  await tx.unsafe(
    `${PATHS} update knowledge_entries e set product_area = path.p
     from path where path.leaf = e.component_id`,
  );
  await tx.unsafe(
    `${PATHS} update reference_docs d set product_area = path.p
     from path where path.leaf = d.component_id`,
  );
}
