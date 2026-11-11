import {
  LIBRARY_SIGNAL_KINDS,
  type LibrarySignalKind,
  type SignalEvidence,
  type SignalRow,
} from "@tachy/contract";
import { jsonb, sql } from "../infra/db";
import type { Db } from "../infra/db";
import { notFound } from "../infra/errors";
import { log } from "../infra/log";
import { currentVector } from "../search/backfill";
import { EMBEDDING_MODEL } from "../search/model";
import { withSearchSession } from "../search/rank";
import { DUPLICATE_FLOOR, STRONG_COSINE } from "../search/relevance";
import { curatedBy, type ReviewerTeams } from "./scope";

/** Unlinked matching tickets since an entry's last edit that flag it by number alone. */
export const RECURRENCE_FLAG_COUNT = 3;
/** Entries a ticket is held against: its nearest few, whatever the product holds. */
const NEAREST_ENTRIES = 3;
const AGED_AFTER_DAYS = 365;
const READ_WINDOW_DAYS = 90;
const LOW_RATING = 2;
const MIN_RATINGS = 2;
const EVIDENCE_ITEMS = 10;
const LIST_LIMIT = 200;

interface SignalFinding {
  entryId: string;
  kind: LibrarySignalKind;
  score: number;
  flagged: boolean;
  evidence: SignalEvidence;
}

/** Written against the alias `e`: live entries of one product, or of none. */
const inScope = (productId: string | null) => sql`
  e.status = 'approved' and e.product_id is not distinct from ${productId}
`;

/** Written against the aliases `wi` and `sc`. */
const TICKET_JSON = sql`
  jsonb_build_object(
    'work_item_id', wi.id, 'source', sc.slug, 'external_id', wi.external_id,
    'title', wi.title, 'url', wi.external_url
  )
`;
const TICKET_AT = sql`coalesce(wi.source_created_at, wi.ingested_at)`;

interface RecurrenceRow {
  id: string;
  fixed_version: string | null;
  confidence: string | null;
  resolution_clarity: string | null;
  tickets: number;
  since_edit: number;
  last_at: Date;
  items: NonNullable<SignalEvidence["tickets"]>;
}

function recurrenceReason(row: RecurrenceRow): SignalEvidence["reason"] {
  if (row.fixed_version) return "fixed";
  if (row.confidence === "low" || row.resolution_clarity === "unclear")
    return "doubtful";
  if (row.since_edit >= RECURRENCE_FLAG_COUNT) return "volume";
  return undefined;
}

/**
 * Tickets that read like an entry and are not among its tickets. Only a ticket
 * opened through the agent has stored vectors, so this counts what people
 * looked at, not every ticket the source holds. Every match is counted; one is
 * flagged only with a reason: `recurrenceReason`.
 */
async function recurring(
  db: Db,
  productId: string | null,
): Promise<SignalFinding[]> {
  const rows = await db<RecurrenceRow[]>`
    with matched as (
      select distinct near.entry_id, v.work_item_id
      from work_item_query_vectors v
      join work_items wi on wi.id = v.work_item_id
      cross join lateral (
        select e.id as entry_id, e.embedding <=> v.embedding as distance
        from knowledge_entries e
        where ${inScope(productId)}
          and e.embedding is not null and ${currentVector("e")}
          and e.work_item_id is distinct from wi.id
          and e.created_at < ${TICKET_AT}
        order by e.embedding <=> v.embedding
        limit ${NEAREST_ENTRIES}
      ) near
      where v.embedding_model = ${EMBEDDING_MODEL}
        and wi.product_id is not distinct from ${productId}
        and 1 - near.distance >= ${STRONG_COSINE}
        and not exists (
          select 1 from knowledge_entry_work_items drawn
          where drawn.knowledge_entry_id = near.entry_id
            and drawn.work_item_id = wi.id
        )
    )
    select e.id, e.fixed_version, e.confidence, e.resolution_clarity,
           count(*)::int as tickets,
           count(*) filter (where ${TICKET_AT} > e.updated_at)::int as since_edit,
           max(${TICKET_AT}) as last_at,
           (array_agg(${TICKET_JSON} order by ${TICKET_AT} desc)
           )[1:${EVIDENCE_ITEMS}::int] as items
    from matched m
    join knowledge_entries e on e.id = m.entry_id
    join work_items wi on wi.id = m.work_item_id
    join source_connections sc on sc.id = wi.source_connection_id
    group by e.id
  `;
  return rows.map((row) => {
    const reason = recurrenceReason(row);
    return {
      entryId: row.id,
      kind: "recurring",
      score: row.tickets,
      flagged: reason !== undefined,
      evidence: {
        tickets: row.items,
        since_edit: row.since_edit,
        last_at: row.last_at.toISOString(),
        reason,
      },
    };
  });
}

/** Someone wrote that the entry is wrong or outdated, after its last edit. */
async function corrected(
  db: Db,
  productId: string | null,
): Promise<SignalFinding[]> {
  const rows = await db<
    { id: string; n: number; notes: NonNullable<SignalEvidence["notes"]> }[]
  >`
    select e.id, count(*)::int as n,
           (array_agg(jsonb_build_object('kind', f.kind, 'comment', f.comment)
                      order by f.created_at desc)
           )[1:${EVIDENCE_ITEMS}::int] as notes
    from knowledge_entries e
    join knowledge_feedback f on f.knowledge_entry_id = e.id
    where ${inScope(productId)}
      and f.kind in ('correction', 'deprecation')
      and f.created_at > e.updated_at
    group by e.id
  `;
  return rows.map((row) => ({
    entryId: row.id,
    kind: "corrected",
    score: row.n,
    flagged: true,
    evidence: { notes: row.notes },
  }));
}

/** Ratings given since the last edit; older ones judged a text that has changed. */
async function ratedLow(
  db: Db,
  productId: string | null,
): Promise<SignalFinding[]> {
  const rows = await db<{ id: string; ratings: number; rating: number }[]>`
    select e.id, count(*)::int as ratings, avg(f.rating)::float8 as rating
    from knowledge_entries e
    join knowledge_feedback f on f.knowledge_entry_id = e.id
    where ${inScope(productId)}
      and f.kind = 'rating' and f.rating is not null
      and f.created_at > e.updated_at
    group by e.id
    having count(*) >= ${MIN_RATINGS} and avg(f.rating) <= ${LOW_RATING}
  `;
  return rows.map((row) => ({
    entryId: row.id,
    kind: "rated_low",
    score: row.ratings,
    flagged: true,
    evidence: { rating: Number(row.rating.toFixed(1)), ratings: row.ratings },
  }));
}

/**
 * An entry that nearly repeats an older one in its product, raised on the
 * newer of the two. Nothing for a model whose duplicate floor is not measured.
 */
async function duplicates(
  db: Db,
  productId: string | null,
): Promise<SignalFinding[]> {
  if (DUPLICATE_FLOOR === undefined) return [];
  const rows = await db<
    { id: string; twin_id: string; twin_title: string; similarity: number }[]
  >`
    select e.id, twin.id as twin_id, twin.title as twin_title,
           1 - twin.distance as similarity
    from knowledge_entries e
    cross join lateral (
      select older.id, older.title, older.embedding <=> e.embedding as distance
      from knowledge_entries older
      where older.status = 'approved'
        and older.product_id is not distinct from ${productId}
        and older.embedding is not null and ${currentVector("older")}
        and (older.created_at, older.id) < (e.created_at, e.id)
      order by older.embedding <=> e.embedding
      limit 1
    ) twin
    where ${inScope(productId)}
      and e.embedding is not null and ${currentVector("e")}
      and 1 - twin.distance >= ${DUPLICATE_FLOOR}
  `;
  return rows.map((row) => ({
    entryId: row.id,
    kind: "duplicate",
    score: Math.round(row.similarity * 100),
    flagged: true,
    evidence: {
      twin: {
        id: row.twin_id,
        title: row.twin_title,
        similarity: Number(Number(row.similarity).toFixed(3)),
      },
    },
  }));
}

/** The ticket an entry was written from got messages after the entry's last edit. */
async function sourceChanged(
  db: Db,
  productId: string | null,
): Promise<SignalFinding[]> {
  const rows = await db<
    { id: string; messages: number; ticket: SignalEvidence["ticket"] }[]
  >`
    select e.id, count(*)::int as messages, ${TICKET_JSON} as ticket
    from knowledge_entries e
    join work_items wi on wi.id = e.work_item_id
    join source_connections sc on sc.id = wi.source_connection_id
    join work_item_messages m on m.work_item_id = wi.id
    where ${inScope(productId)}
      and not m.automated and m.created_at > e.updated_at
    group by e.id, wi.id, sc.slug
  `;
  return rows.map((row) => ({
    entryId: row.id,
    kind: "source_changed",
    score: row.messages,
    flagged: true,
    evidence: { messages: row.messages, ticket: row.ticket },
  }));
}

/** Long untouched and still read: old advice people rely on. */
async function aged(
  db: Db,
  productId: string | null,
): Promise<SignalFinding[]> {
  const rows = await db<{ id: string; reads: number; updated_at: Date }[]>`
    select e.id, sum(v.views)::int as reads, e.updated_at
    from knowledge_entries e
    join library_views v on v.knowledge_entry_id = e.id
     and v.day > current_date - ${READ_WINDOW_DAYS}::int
    where ${inScope(productId)}
      and e.updated_at < now() - make_interval(days => ${AGED_AFTER_DAYS})
    group by e.id
  `;
  return rows.map((row) => ({
    entryId: row.id,
    kind: "aged",
    score: row.reads,
    flagged: true,
    evidence: { reads: row.reads, updated_at: row.updated_at.toISOString() },
  }));
}

/** Every signal on one product's entries; `productId` null is the entries with none. */
async function computeEntrySignals(
  db: Db,
  productId: string | null,
): Promise<SignalFinding[]> {
  const found = await Promise.all([
    recurring(db, productId),
    corrected(db, productId),
    ratedLow(db, productId),
    duplicates(db, productId),
    sourceChanged(db, productId),
    aged(db, productId),
  ]);
  return found.flat();
}

/**
 * Upserts one scope's findings. A signal seen again keeps its first_seen_at
 * and its dismissal; one that had been resolved reopens as new. Whatever the
 * scope held and was not found this time is resolved. `muted` is never reset.
 */
async function record(
  db: Db,
  productId: string | null,
  found: SignalFinding[],
): Promise<void> {
  for (const signal of found)
    await db`
      insert into library_signals (knowledge_entry_id, kind, score, evidence, flagged)
      values (${signal.entryId}, ${signal.kind}, ${signal.score},
              ${jsonb(signal.evidence)}, ${signal.flagged})
      on conflict (knowledge_entry_id, kind) where knowledge_entry_id is not null
      do update set
        score           = excluded.score,
        evidence        = excluded.evidence,
        flagged         = excluded.flagged,
        last_seen_at    = now(),
        first_seen_at   = case when library_signals.resolved_at is null
                               then library_signals.first_seen_at else now() end,
        dismissed_by    = case when library_signals.resolved_at is null
                               then library_signals.dismissed_by end,
        dismissed_at    = case when library_signals.resolved_at is null
                               then library_signals.dismissed_at end,
        dismissed_score = case when library_signals.resolved_at is null
                               then library_signals.dismissed_score end,
        resolved_at     = null
    `;
  const keys = found.map((signal) => `${signal.entryId}:${signal.kind}`);
  await db`
    update library_signals s set resolved_at = now()
    from knowledge_entries e
    where e.id = s.knowledge_entry_id
      and e.product_id is not distinct from ${productId}
      and s.resolved_at is null
      and not (s.knowledge_entry_id::text || ':' || s.kind = any(${keys}::text[]))
  `;
}

/** Namespace for the sweep's advisory locks; the second key is the scope. */
const LOCK_NS = 0x7273;

export interface SignalSweep {
  /** Products swept, the entries with no product counting as one. */
  scopes: number;
  /** Scopes another sweep was in the middle of. */
  skipped: number;
  /** Scopes whose sweep failed; logged, and retried on the next run. */
  failed: number;
  signals: number;
  flagged: number;
}

/**
 * Re-finds the signals of every product's entries, or of one product's when
 * `productId` is given (null for the entries with none). One transaction per
 * scope under an advisory lock, so two sweeps never write the same scope.
 */
export async function sweepSignals(
  opts: { productId?: string | null } = {},
): Promise<SignalSweep> {
  const scopes: (string | null)[] =
    opts.productId !== undefined
      ? [opts.productId]
      : [
          ...(await sql`select id from products order by slug`).map(
            (row) => row.id as string,
          ),
          null,
        ];

  const sweep: SignalSweep = {
    scopes: 0,
    skipped: 0,
    failed: 0,
    signals: 0,
    flagged: 0,
  };
  for (const productId of scopes) {
    // One scope failing must not cost the rest their run.
    try {
      const found = await withSearchSession(async (tx) => {
        const [{ locked }] = await tx`
          select pg_try_advisory_xact_lock(
            ${LOCK_NS}::int,
            hashtext(current_schema() || ':' || ${productId ?? "none"})
          ) as locked
        `;
        if (!locked) return null;
        const findings = await computeEntrySignals(tx, productId);
        await record(tx, productId, findings);
        return findings;
      });
      if (found === null) {
        sweep.skipped++;
        continue;
      }
      sweep.scopes++;
      sweep.signals += found.length;
      sweep.flagged += found.filter((signal) => signal.flagged).length;
    } catch (err) {
      sweep.failed++;
      log("error", "review_signal_sweep", { productId, error: String(err) });
    }
  }
  return sweep;
}

const SIGNAL_COLUMNS = sql`
  s.id, s.kind, s.knowledge_entry_id, e.title as entry_title,
  e.product_id, e.team_id, s.score, s.evidence, s.flagged,
  s.first_seen_at, s.last_seen_at, s.dismissed_at, s.dismissed_score
`;

/**
 * Open, flagged and neither muted nor dismissed, or dismissed and grown well
 * past what it was dismissed at. Written against the alias `s`.
 */
export const listedSignal = () => sql`
  s.resolved_at is null and s.flagged and not s.muted and (
    s.dismissed_at is null
    or s.score >= greatest(ceil(s.dismissed_score * 1.5), s.dismissed_score + 3)
  )
`;

/** The flagged entries of a reviewer's teams, in the order they are worked. */
export async function listSignals(
  teamIds: ReviewerTeams,
): Promise<SignalRow[]> {
  return sql<SignalRow[]>`
    select ${SIGNAL_COLUMNS}
    from library_signals s
    join knowledge_entries e on e.id = s.knowledge_entry_id
    where ${listedSignal()} and ${curatedBy(teamIds)}
    order by array_position(${[...LIBRARY_SIGNAL_KINDS]}::text[], s.kind),
             s.score desc, s.first_seen_at
    limit ${LIST_LIMIT}
  `;
}

/** What the sweep holds on one entry, the counts that are not flagged included. */
export async function entrySignals(entryId: string): Promise<SignalRow[]> {
  return sql<SignalRow[]>`
    select ${SIGNAL_COLUMNS}
    from library_signals s
    join knowledge_entries e on e.id = s.knowledge_entry_id
    where s.knowledge_entry_id = ${entryId}
      and s.resolved_at is null and not s.muted
    order by array_position(${[...LIBRARY_SIGNAL_KINDS]}::text[], s.kind)
  `;
}

export async function getSignal(id: string): Promise<SignalRow> {
  const [row] = await sql<SignalRow[]>`
    select ${SIGNAL_COLUMNS}
    from library_signals s
    join knowledge_entries e on e.id = s.knowledge_entry_id
    where s.id = ${id} and s.resolved_at is null
  `;
  if (!row) throw notFound(`no open signal '${id}'`);
  return row;
}

/** "Not worth acting on" until the evidence grows; see `listedSignal`. */
export async function dismissSignal(
  id: string,
  userId: string | null,
): Promise<void> {
  await sql`
    update library_signals
    set dismissed_at = now(), dismissed_by = ${userId}, dismissed_score = score
    where id = ${id} and resolved_at is null
  `;
}

/** Known and accepted: the signal keeps counting and is never listed again. */
export async function muteSignal(
  id: string,
  userId: string | null,
): Promise<void> {
  await sql`
    update library_signals
    set muted = true, dismissed_at = now(), dismissed_by = ${userId}
    where id = ${id} and resolved_at is null
  `;
}
