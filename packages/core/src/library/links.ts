import { LINK_KINDS, parseWikilinks } from "@tachy/contract";
import type { LinkKind, Wikilink } from "@tachy/contract";
import { sql } from "../infra/db";
import type { Db } from "../infra/db";

export { LINK_KINDS, parseWikilinks };
export type { LinkKind };

/** Which item a link runs from; exactly one is set. */
export type LinkSource =
  | { docId: string; entryId?: undefined }
  | { entryId: string; docId?: undefined };

export interface ResolvedLink extends Wikilink {
  kind_: LinkKind;
  toDocId: string | null;
  toEntryId: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Point a link at a row. An article resolves within its own wiki first, then
 * the org-wide one — the same includeUnscoped idea search already uses, so a
 * product article can cite a shared page without qualifying it.
 *
 * A link that resolves to nothing is not an error: it is stored unresolved so a
 * rename shows up as a broken link the author can see and fix.
 */
async function resolveTarget(
  link: Wikilink,
  productId: string | null,
): Promise<{ toDocId: string | null; toEntryId: string | null }> {
  const none = { toDocId: null, toEntryId: null };

  if (link.kind === "entry") {
    if (!UUID_RE.test(link.ref)) return none;
    const [row] =
      await sql`select id from knowledge_entries where id = ${link.ref}`;
    return row ? { toDocId: null, toEntryId: row.id as string } : none;
  }

  if (link.kind === "doc") {
    if (!UUID_RE.test(link.ref)) return none;
    const [row] =
      await sql`select id from reference_docs where id = ${link.ref}`;
    return row ? { toDocId: row.id as string, toEntryId: null } : none;
  }

  const [row] = await sql`
    select id from reference_docs
    where kind = 'wiki' and status <> 'archived' and slug = ${link.ref}
      and (product_id is not distinct from ${productId} or product_id is null)
    order by case when product_id is not distinct from ${productId} then 0 else 1 end
    limit 1
  `;
  return row ? { toDocId: row.id as string, toEntryId: null } : none;
}

/**
 * Replace a body's outbound links. Whole-set on every save: edges are derived
 * from the text, so recomputing is the only way they cannot drift from it.
 *
 * Only edges leaving this item are touched. Edges pointing AT it belong to
 * whoever wrote them, and deleting those here would silently unlink other
 * people's articles — the obvious bug, and the reason this is a narrow delete.
 */
export async function syncLinks(
  db: Db,
  source: LinkSource,
  body: string,
  productId: string | null,
): Promise<number> {
  const links = parseWikilinks(body);

  await db`
    delete from library_links
    where kind = 'mentions'
      and ${
        source.docId
          ? sql`from_doc_id = ${source.docId}`
          : sql`from_entry_id = ${source.entryId ?? null}`
      }
  `;
  if (!links.length) return 0;

  // Same target twice in one body is one edge; the body still renders both.
  const seen = new Set<string>();
  const rows: {
    target: string;
    label: string;
    toDocId: string | null;
    toEntryId: string | null;
  }[] = [];
  for (const link of links) {
    if (seen.has(link.target)) continue;
    seen.add(link.target);
    const to = await resolveTarget(link, productId);
    rows.push({ target: link.target, label: link.label, ...to });
  }

  for (const r of rows)
    await db`
      insert into library_links
        (from_doc_id, from_entry_id, to_doc_id, to_entry_id, kind, target, label)
      values
        (${source.docId ?? null}, ${source.entryId ?? null},
         ${r.toDocId}, ${r.toEntryId}, 'mentions', ${r.target}, ${r.label})
    `;
  return rows.length;
}

export interface OutboundLink {
  id: string;
  target: string;
  label: string | null;
  to_doc_id: string | null;
  to_entry_id: string | null;
  /** Null when nothing resolved — a broken link, shown as such. */
  to_title: string | null;
  to_slug: string | null;
  to_kind: string | null;
  /** Which wiki the target lives in; null is the org-wide one. */
  to_product_id: string | null;
}

export async function outboundLinks(
  source: LinkSource,
): Promise<OutboundLink[]> {
  return sql`
    select l.id, l.target, l.label, l.to_doc_id, l.to_entry_id,
           coalesce(d.title, e.issue_summary) as to_title,
           d.slug as to_slug, d.product_id as to_product_id,
           case when d.id is not null then d.kind
                when e.id is not null then 'entry' end as to_kind
    from library_links l
    left join reference_docs d on d.id = l.to_doc_id
    left join knowledge_entries e on e.id = l.to_entry_id
    where l.kind = 'mentions'
      and ${
        source.docId
          ? sql`l.from_doc_id = ${source.docId}`
          : sql`l.from_entry_id = ${source.entryId ?? null}`
      }
    order by l.target
  ` as Promise<OutboundLink[]>;
}

export interface Backlink {
  id: string;
  kind: LinkKind;
  label: string | null;
  from_doc_id: string | null;
  from_entry_id: string | null;
  from_title: string | null;
  from_slug: string | null;
  from_product_id: string | null;
  /** 'wiki' | 'reference' | 'entry' — what the linking item is. */
  from_kind: string | null;
}

/** What points at this item. The `to_*` columns are indexed for exactly this. */
export async function backlinks(target: {
  docId?: string;
  entryId?: string;
}): Promise<Backlink[]> {
  return sql`
    select l.id, l.kind, l.label, l.from_doc_id, l.from_entry_id,
           coalesce(d.title, e.issue_summary) as from_title,
           d.slug as from_slug,
           coalesce(d.product_id, e.product_id) as from_product_id,
           case when d.id is not null then d.kind
                when e.id is not null then 'entry' end as from_kind
    from library_links l
    left join reference_docs d on d.id = l.from_doc_id
    left join knowledge_entries e on e.id = l.from_entry_id
    where ${
      target.docId
        ? sql`l.to_doc_id = ${target.docId}`
        : sql`l.to_entry_id = ${target.entryId ?? null}`
    }
    order by from_title
  ` as Promise<Backlink[]>;
}

/**
 * Re-point links that were written against a slug which now resolves. Called
 * after an article is created or renamed, so links authored before the target
 * existed stop being broken without anyone editing them again.
 */
export async function relinkBySlug(
  db: Db,
  slug: string,
  docId: string,
  productId: string | null,
): Promise<number> {
  const rows = await db`
    update library_links l
    set to_doc_id = ${docId}
    from reference_docs src
    where l.to_doc_id is null and l.to_entry_id is null
      and l.kind = 'mentions'
      and l.target = ${slug}
      and src.id = l.from_doc_id
      and src.product_id is not distinct from ${productId}
    returning l.id
  `;
  return rows.length;
}

export interface ComposedSource {
  entryId?: string;
  docId?: string;
}

/**
 * Record what an article was composed from. Whole-set like the mentions above,
 * and a separate `kind` so a citation the author wrote and a source the article
 * consolidates are not confused: the first is prose, the second is provenance.
 */
export async function setComposedFrom(
  db: Db,
  pageId: string,
  sources: ComposedSource[],
): Promise<number> {
  await db`
    delete from library_links
    where kind = 'composed_from' and from_doc_id = ${pageId}
  `;
  const seen = new Set<string>();
  let n = 0;
  for (const s of sources) {
    const key = s.entryId ?? s.docId ?? "";
    if (!key || seen.has(key) || s.docId === pageId) continue;
    seen.add(key);
    await db`
      insert into library_links
        (from_doc_id, from_entry_id, to_doc_id, to_entry_id, kind, target, label)
      values
        (${pageId}, null, ${s.docId ?? null}, ${s.entryId ?? null},
         'composed_from', ${key}, null)
    `;
    n++;
  }
  return n;
}

export interface Staleness {
  sources: number;
  entries: number;
  docs: number;
  /** Sources edited since the article was last written. */
  changed: number;
  changedTitles: string[];
}

/**
 * How much of what an article was built from has moved since. This is what
 * stops a curated page rotting quietly: the answer is visible on the page
 * rather than discovered when someone follows outdated advice.
 */
export async function articleStaleness(pageId: string): Promise<Staleness> {
  const rows = await sql`
    select
      coalesce(e.issue_summary, d.title) as title,
      (l.to_entry_id is not null) as is_entry,
      coalesce(e.updated_at, d.updated_at) > page.updated_at as changed
    from library_links l
    join reference_docs page on page.id = l.from_doc_id
    left join knowledge_entries e on e.id = l.to_entry_id
    left join reference_docs d    on d.id = l.to_doc_id
    where l.kind = 'composed_from' and l.from_doc_id = ${pageId}
  `;
  const all = rows as any[];
  const changed = all.filter((r) => r.changed);
  return {
    sources: all.length,
    entries: all.filter((r) => r.is_entry).length,
    docs: all.filter((r) => !r.is_entry).length,
    changed: changed.length,
    changedTitles: changed
      .map((r) => r.title)
      .filter(Boolean)
      .slice(0, 10),
  };
}
