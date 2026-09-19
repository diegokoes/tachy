import { MAIN_PAGE_SLUG, WIKI_GAP_KINDS } from "@tachy/contract";
import type { WikiGapKind } from "@tachy/contract";
import { sql, jsonb } from "../infra/db";
import type { Db } from "../infra/db";
import { notFound } from "../infra/errors";
import { log } from "../infra/log";

/** Fewer lessons than this under one part of the product is not a topic yet. */
export const GAP_THRESHOLD = 3;

/** How much evidence one gap row carries for the page to show. */
const EVIDENCE_ITEMS = 10;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WikiGapItem {
  kind: "entry" | "doc";
  id: string;
  title: string;
}

export interface WikiGapFinding {
  kind: WikiGapKind;
  key: string;
  subject: string;
  score: number;
  evidence: Record<string, unknown>;
}

export interface WikiGapRow extends WikiGapFinding {
  id: string;
  product_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  dismissed_at: string | null;
  dismissed_score: number | null;
}

/**
 * Open and not dismissed — or dismissed, but grown well past what it was
 * dismissed at. Written against the alias `g` so the wiki index can count with
 * the same rule it lists by.
 */
export const visibleGap = () => sql`
  g.resolved_at is null and (
    g.dismissed_at is null
    or g.score >= greatest(ceil(g.dismissed_score * 1.5), g.dismissed_score + 3)
  )
`;

interface Article {
  id: string;
  slug: string;
  title: string;
  status: string;
  component_id: string | null;
  updated_at: Date;
  filed: boolean;
}

interface Component {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
}

interface Material extends WikiGapItem {
  component_id: string;
  created_at: Date;
}

const item = ({ kind, id, title }: Material): WikiGapItem => ({
  kind,
  id,
  title,
});

/**
 * Where the material under a product's components has not been written up.
 *
 * An article anchored at a component covers that component's whole subtree,
 * and an item any article cites is covered wherever it sits. What is left over
 * is grouped by component and rolled up post-order, so the gap is raised at the
 * most specific part of the product that has enough on its own — a parent is
 * only flagged for what its flagged children did not already account for.
 *
 * Uncited material that arrived after the covering article was last written is
 * the other half: the article exists, but the lessons have moved past it.
 */
async function componentGaps(
  db: Db,
  productId: string,
  articles: Article[],
): Promise<WikiGapFinding[]> {
  const [components, material, cited] = await Promise.all([
    db`
      select id, parent_id, slug, name from components
      where product_id = ${productId}
      order by slug
    ` as unknown as Promise<Component[]>,
    db`
      select 'entry' as kind, e.id,
             coalesce(e.issue_summary, '(no summary)') as title,
             e.component_id, e.created_at
      from knowledge_entries e
      join components c on c.id = e.component_id
      where c.product_id = ${productId} and e.status = 'approved'
      union all
      select 'doc', d.id, d.title, d.component_id, d.created_at
      from reference_docs d
      join components c on c.id = d.component_id
      where c.product_id = ${productId}
        and d.kind = 'reference' and d.status = 'approved'
      order by created_at desc
    ` as unknown as Promise<Material[]>,
    db`
      select distinct coalesce(l.to_entry_id, l.to_doc_id) as id
      from library_links l
      join reference_docs a on a.id = l.from_doc_id
      where a.kind = 'wiki' and a.status <> 'archived'
        and coalesce(l.to_entry_id, l.to_doc_id) is not null
    `,
  ]);

  const citedIds = new Set((cited as any[]).map((r) => r.id as string));
  const children = new Map<string | null, Component[]>();
  const ids = new Set(components.map((c) => c.id));
  for (const c of components) {
    const parent = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), c]);
  }

  const anchored = new Map<string, Article>();
  for (const a of articles) {
    if (!a.component_id) continue;
    const had = anchored.get(a.component_id);
    if (!had || a.updated_at > had.updated_at) anchored.set(a.component_id, a);
  }

  const covering = new Map<string, Article | null>();
  const inherit = (c: Component, above: Article | null) => {
    const here = anchored.get(c.id) ?? above;
    covering.set(c.id, here);
    for (const child of children.get(c.id) ?? []) inherit(child, here);
  };
  for (const root of children.get(null) ?? []) inherit(root, null);

  const loose = new Map<string, Material[]>();
  const since = new Map<string, Material[]>();
  for (const m of material) {
    if (citedIds.has(m.id)) continue;
    const article = covering.get(m.component_id) ?? null;
    if (!article)
      loose.set(m.component_id, [...(loose.get(m.component_id) ?? []), m]);
    else if (m.created_at > article.updated_at)
      since.set(article.id, [...(since.get(article.id) ?? []), m]);
  }

  const found: WikiGapFinding[] = [];
  const tally = (pool: Material[]) => ({
    entries: pool.filter((m) => m.kind === "entry").length,
    docs: pool.filter((m) => m.kind === "doc").length,
    items: pool.slice(0, EVIDENCE_ITEMS).map(item),
  });

  const roll = (c: Component): Material[] => {
    const pool = [...(loose.get(c.id) ?? [])];
    for (const child of children.get(c.id) ?? []) pool.push(...roll(child));
    if (pool.length < GAP_THRESHOLD) return pool;
    pool.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    found.push({
      kind: "unwritten",
      key: c.id,
      subject: c.name,
      score: pool.length,
      evidence: { component: c.slug, ...tally(pool) },
    });
    return [];
  };
  for (const root of children.get(null) ?? []) roll(root);

  const bySlug = new Map(components.map((c) => [c.id, c.slug]));
  for (const a of articles) {
    const pool = since.get(a.id) ?? [];
    if (pool.length < GAP_THRESHOLD) continue;
    found.push({
      kind: "outgrown",
      key: a.id,
      subject: a.title,
      score: pool.length,
      evidence: {
        slug: a.slug,
        component: a.component_id ? bySlug.get(a.component_id) : null,
        since: a.updated_at,
        ...tally(pool),
      },
    });
  }
  return found;
}

/** Every gap one wiki has right now. `productId` null is the org-wide wiki. */
export async function findWikiGaps(
  db: Db,
  productId: string | null,
): Promise<WikiGapFinding[]> {
  const [articles, stale, wanted] = await Promise.all([
    db`
      select d.id, d.slug, d.title, d.status, d.component_id, d.updated_at,
             exists (select 1 from wiki_article_categories ac
                     where ac.doc_id = d.id) as filed
      from reference_docs d
      where d.kind = 'wiki' and d.status <> 'archived'
        and d.product_id is not distinct from ${productId}
      order by d.title
    ` as unknown as Promise<Article[]>,
    db`
      select l.from_doc_id as id, count(*)::int as changed,
             (array_agg(coalesce(e.issue_summary, d.title)
                        order by coalesce(e.updated_at, d.updated_at) desc)
             )[1:${EVIDENCE_ITEMS}::int] as titles
      from library_links l
      join reference_docs page on page.id = l.from_doc_id
      left join knowledge_entries e on e.id = l.to_entry_id
      left join reference_docs d    on d.id = l.to_doc_id
      where l.kind = 'composed_from'
        and page.kind = 'wiki' and page.status <> 'archived'
        and page.product_id is not distinct from ${productId}
        and coalesce(e.updated_at, d.updated_at) > page.updated_at
      group by l.from_doc_id
    `,
    // An entry or doc link that fails to resolve points at an id, and there is
    // nothing to write at an id — only a missing slug is a page someone wants.
    db`
      select l.target, count(distinct l.from_doc_id)::int as pages,
             (array_agg(distinct src.title))[1:${EVIDENCE_ITEMS}::int] as titles
      from library_links l
      join reference_docs src on src.id = l.from_doc_id
      where l.kind = 'mentions'
        and l.to_doc_id is null and l.to_entry_id is null
        and src.kind = 'wiki' and src.status <> 'archived'
        and src.product_id is not distinct from ${productId}
        and l.target not like 'entry:%' and l.target not like 'doc:%'
      group by l.target
    `,
  ]);

  const found = productId ? await componentGaps(db, productId, articles) : [];
  const byId = new Map(articles.map((a) => [a.id, a]));

  for (const s of stale as any[]) {
    const a = byId.get(s.id);
    if (!a) continue;
    found.push({
      kind: "stale",
      key: a.id,
      subject: a.title,
      score: s.changed,
      evidence: { slug: a.slug, titles: s.titles },
    });
  }
  for (const w of wanted as any[])
    found.push({
      kind: "wanted",
      key: w.target,
      subject: w.target,
      score: w.pages,
      evidence: { pages: w.pages, titles: w.titles },
    });
  for (const a of articles) {
    if (a.status === "draft")
      found.push({
        kind: "draft",
        key: a.id,
        subject: a.title,
        score: 1,
        evidence: { slug: a.slug, updated_at: a.updated_at },
      });
    // The main page is where a reader lands, not something filed under a topic.
    if (!a.filed && a.slug !== MAIN_PAGE_SLUG)
      found.push({
        kind: "uncategorised",
        key: a.id,
        subject: a.title,
        score: 1,
        evidence: { slug: a.slug },
      });
  }
  return found;
}

/**
 * Upsert one wiki's findings. A gap seen again keeps its first_seen_at; one
 * that had been resolved is reopened as new, and a dismissal made about the
 * earlier occurrence does not carry over to it. Anything not found this time
 * is resolved.
 */
async function record(
  db: Db,
  productId: string | null,
  found: WikiGapFinding[],
): Promise<void> {
  for (const g of found)
    await db`
      insert into wiki_gaps (product_id, kind, key, subject, evidence, score)
      values (${productId}, ${g.kind}, ${g.key}, ${g.subject},
              ${jsonb(g.evidence)}, ${g.score})
      on conflict (product_id, kind, key) do update set
        subject         = excluded.subject,
        evidence        = excluded.evidence,
        score           = excluded.score,
        last_seen_at    = now(),
        first_seen_at   = case when wiki_gaps.resolved_at is null
                               then wiki_gaps.first_seen_at else now() end,
        dismissed_by    = case when wiki_gaps.resolved_at is null
                               then wiki_gaps.dismissed_by end,
        dismissed_at    = case when wiki_gaps.resolved_at is null
                               then wiki_gaps.dismissed_at end,
        dismissed_score = case when wiki_gaps.resolved_at is null
                               then wiki_gaps.dismissed_score end,
        resolved_at     = null
    `;
  const keys = found.map((g) => `${g.kind}:${g.key}`);
  await db`
    update wiki_gaps set resolved_at = now()
    where product_id is not distinct from ${productId}
      and resolved_at is null
      and not (kind || ':' || key = any(${keys}::text[]))
  `;
}

/** Namespace for the sweep's advisory locks; the second key is the wiki. */
const LOCK_NS = 0x7769;

export interface SweepResult {
  /** Wikis swept. */
  wikis: number;
  /** Wikis another sweep was already in the middle of. */
  skipped: number;
  /** Wikis whose sweep failed; logged, and retried on the next run. */
  failed: number;
  /** Gaps found across the wikis swept. */
  gaps: number;
}

/**
 * Re-find every wiki's gaps, or one wiki's when `productId` is given (null for
 * the org-wide one). One transaction per wiki under a transaction-scoped
 * advisory lock, so two API processes — or an hourly run and a rescan after an
 * edit — never write the same wiki at once; whoever loses skips it rather than
 * waiting, since the winner is computing the same answer.
 *
 * `wait` queues behind a sweep already running instead, for a curator who asked
 * for the answer as of now.
 *
 * The lock key carries the schema, because advisory locks are database-wide
 * and the org-wide wiki has no id of its own to tell deployments apart by.
 */
export async function sweepWikiGaps(
  opts: { productId?: string | null; wait?: boolean } = {},
): Promise<SweepResult> {
  const scopes: (string | null)[] =
    opts.productId !== undefined
      ? [opts.productId]
      : [
          ...(await sql`select id from products order by slug`).map(
            (r) => r.id as string,
          ),
          null,
        ];

  const result: SweepResult = { wikis: 0, skipped: 0, failed: 0, gaps: 0 };
  for (const productId of scopes) {
    // One wiki failing — a product deleted mid-sweep, say — must not cost the
    // rest of them their run.
    try {
      const n = await sql.begin(async (tx) => {
        const key = sql`
          ${LOCK_NS}::int,
          hashtext(current_schema() || ':' || ${productId ?? "general"})
        `;
        if (opts.wait) await tx`select pg_advisory_xact_lock(${key})`;
        else {
          const [{ locked }] = await tx`
            select pg_try_advisory_xact_lock(${key}) as locked
          `;
          if (!locked) return null;
        }
        const found = await findWikiGaps(tx, productId);
        await record(tx, productId, found);
        return found.length;
      });
      if (n === null) result.skipped++;
      else {
        result.wikis++;
        result.gaps += n;
      }
    } catch (err) {
      result.failed++;
      log("error", "wiki_gap_sweep", { productId, error: String(err) });
    }
  }
  return result;
}

/** One wiki's open gaps, in the order a curator should work through them. */
export async function listWikiGaps(
  productId: string | null,
): Promise<WikiGapRow[]> {
  return sql`
    select g.id, g.product_id, g.kind, g.key, g.subject, g.evidence, g.score,
           g.first_seen_at, g.last_seen_at, g.dismissed_at, g.dismissed_score
    from wiki_gaps g
    where g.product_id is not distinct from ${productId} and ${visibleGap()}
    order by array_position(${[...WIKI_GAP_KINDS]}::text[], g.kind),
             g.score desc, g.first_seen_at
  ` as unknown as Promise<WikiGapRow[]>;
}

/** "Not worth writing up" — until the evidence grows; see `visibleGap`. */
export async function dismissWikiGap(
  productId: string | null,
  id: string,
  userId: string | null,
): Promise<{ dismissed: string }> {
  const missing = () => notFound(`No open gap '${id}' in this wiki`);
  if (!UUID_RE.test(id)) throw missing();
  const [row] = await sql`
    update wiki_gaps
    set dismissed_at = now(), dismissed_by = ${userId}, dismissed_score = score
    where id = ${id} and product_id is not distinct from ${productId}
      and resolved_at is null
    returning id
  `;
  if (!row) throw missing();
  return { dismissed: row.id as string };
}
