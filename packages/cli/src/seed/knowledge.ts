import {
  CONFIDENCES,
  FEEDBACK_KINDS,
  KNOWLEDGE_STATUSES,
  REFERENCE_STATUSES,
  RESOLUTION_CLARITIES,
} from "@tachy/core";
import { insertRows, type Tx } from "./batches";
import {
  chance,
  intBetween,
  pastDate,
  pick,
  pickMany,
  rngFor,
  unitVector,
  uuidFor,
  vectorLiteral,
} from "./deterministic";
import {
  CLOUDS,
  DOC_TITLES,
  RESOLUTIONS,
  ROOT_CAUSES,
  SYMPTOMS,
  TAGS,
} from "./corpus";
import type { SeededProduct, SeededUser } from "./org";
import type { SeededComponent, SeededCustomer } from "./catalog";
import type { SeededProject, SeededWorkItem } from "./sources";
import type { Volumes } from "./scale";

export interface Knowledge {
  entries: string[];
  docs: string[];
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
  embed: (kind: string, i: number, text: string) => Promise<string>,
): Promise<Knowledge> {
  const entries: string[] = [];
  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < v.knowledgeEntries; i++) {
    const rng = rngFor("knowledge", i);
    const id = uuidFor("knowledge_entry", i);
    entries.push(id);
    const product = products[i % products.length];
    const mine = components.filter((c) => c.productId === product.id);
    const component = mine.length ? mine[i % mine.length] : undefined;
    const symptom = SYMPTOMS[i % SYMPTOMS.length];
    const cause = ROOT_CAUSES[i % ROOT_CAUSES.length];
    const fix = RESOLUTIONS[i % RESOLUTIONS.length];
    const created = pastDate(rng, 500);

    rows.push({
      id,
      work_item_id: workItems.length
        ? workItems[i % workItems.length].id
        : null,
      product_id: product.id,
      team_id: product.teamId,
      customer_id: chance(rng, 0.5) ? customers[i % customers.length].id : null,
      created_by: users[i % users.length].id,
      status: pick(rng, KNOWLEDGE_STATUSES),
      // superseded_by is a second pass: see supersede() below.
      superseded_by: null,
      issue_summary: `${symptom} on ${product.slug}`,
      symptoms: pickMany(rng, SYMPTOMS, intBetween(rng, 1, 3)),
      root_cause: cause,
      resolution: fix,
      resolution_pattern: patterns.length ? pick(rng, patterns) : null,
      signals: [`error code E${intBetween(rng, 100, 999)}`],
      tags: pickMany(rng, TAGS, intBetween(rng, 1, 4)),
      component_id: component ? component.id : null,
      // product_area is DERIVED from the component hierarchy: filled by the
      // recursive-CTE pass in index.ts, exactly as saveKnowledgeEntry does.
      product_area: null,
      confidence: pick(rng, CONFIDENCES),
      cloud: pick(rng, CLOUDS),
      resolution_clarity: pick(rng, RESOLUTION_CLARITIES),
      hidden_fix: chance(rng, 0.15),
      affected_version: `${intBetween(rng, 3, 9)}.${intBetween(rng, 0, 12)}`,
      fixed_version: chance(rng, 0.6)
        ? `${intBetween(rng, 9, 11)}.${intBetween(rng, 0, 6)}`
        : null,
      structured: JSON.stringify({ seeded: true }),
      embedding: await embed(
        "knowledge_entry",
        i,
        `${symptom} ${cause} ${fix}`,
      ),
      created_at: created,
      updated_at: created,
    });
  }

  await insertRows(
    tx,
    "knowledge_entries",
    [
      "id",
      "work_item_id",
      "product_id",
      "team_id",
      "customer_id",
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
    rows,
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
  embed: (kind: string, i: number, text: string) => Promise<string>,
): Promise<string[]> {
  const docs: string[] = [];
  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < v.referenceDocs; i++) {
    const rng = rngFor("reference", i);
    const id = uuidFor("reference_doc", i);
    docs.push(id);
    const product = products[i % products.length];
    const mine = components.filter((c) => c.productId === product.id);
    const component = mine.length ? mine[i % mine.length] : undefined;
    const title = DOC_TITLES[i % DOC_TITLES.length];
    const project = projects[i % projects.length];

    rows.push({
      id,
      product_id: product.id,
      team_id: product.teamId,
      created_by: users[i % users.length].id,
      source: "seed",
      source_project_id: chance(rng, 0.4) ? project.id : null,
      external_key: chance(rng, 0.4) ? `wiki/page-${i}` : null,
      component_id: component ? component.id : null,
      product_area: null,
      customer_id: null,
      title: i >= DOC_TITLES.length ? `${title} (${i})` : title,
      body: `${title}. ${ROOT_CAUSES[i % ROOT_CAUSES.length]}. ${RESOLUTIONS[i % RESOLUTIONS.length]}.`,
      tags: pickMany(rng, TAGS, intBetween(rng, 1, 3)),
      structured: JSON.stringify({ seeded: true }),
      status: pick(rng, REFERENCE_STATUSES),
      doc_version: `${intBetween(rng, 1, 9)}.0`,
      superseded_by: null,
      version: 1,
    });
  }

  await insertRows(
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
    rows,
  );

  const chunkRows: Record<string, unknown>[] = [];
  const per = Math.max(
    1,
    Math.floor(v.referenceChunks / Math.max(1, docs.length)),
  );
  for (let d = 0; d < docs.length; d++)
    for (let k = 0; k < per; k++) {
      const i = chunkRows.length;
      chunkRows.push({
        id: uuidFor("reference_doc_chunk", i),
        doc_id: docs[d],
        // (doc_id, ordinal) unique by construction.
        ordinal: k,
        chunk_text: `${DOC_TITLES[d % DOC_TITLES.length]} — section ${k}. ${ROOT_CAUSES[i % ROOT_CAUSES.length]}`,
        embedding: await embed("reference_doc_chunk", i, `section ${k}`),
      });
    }
  await insertRows(
    tx,
    "reference_doc_chunks",
    ["id", "doc_id", "ordinal", "chunk_text", "embedding"],
    chunkRows,
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

export const syntheticVector = async (
  kind: string,
  i: number,
): Promise<string> => vectorLiteral(unitVector(kind, i));
