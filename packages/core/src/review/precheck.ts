import type {
  PrecheckFinding,
  ProposalAdvice,
  ProposalKind,
} from "@tachy/contract";
import { jsonb, sql } from "../infra/db";
import type { Db } from "../infra/db";
import { notFound } from "../infra/errors";
import { currentVector } from "../search/backfill";
import { DUPLICATE_FLOOR } from "../search/relevance";

const MAX_NEAR_COPIES = 3;
const ADVICE_BATCH = 20;

/** The entry as the proposal would leave it, in the fields the checks read. */
interface Proposed {
  kind: ProposalKind;
  patch: Record<string, unknown> | null;
  entry_id: string;
  title: string;
  issue_summary: string | null;
  root_cause: string | null;
  resolution: string | null;
  investigation: string | null;
  symptoms: string[];
  confidence: string | null;
  component_id: string | null;
  work_item_id: string | null;
  related_links: string[];
  submitted_by: string | null;
}

/** A patch is keyed as the API takes it; the row it lands on is not. */
const PATCHED_COLUMNS = {
  title: "title",
  issueSummary: "issue_summary",
  rootCause: "root_cause",
  resolution: "resolution",
  investigation: "investigation",
  symptoms: "symptoms",
  confidence: "confidence",
} as const;

async function proposedEntry(db: Db, proposalId: string): Promise<Proposed> {
  const [row] = await db<Proposed[]>`
    select p.kind, p.patch, p.submitted_by, e.id as entry_id, e.title,
           e.issue_summary, e.root_cause, e.resolution, e.investigation,
           e.symptoms, e.confidence, e.component_id,
           coalesce(p.work_item_id, e.work_item_id) as work_item_id,
           e.related_links
    from library_proposals p
    join knowledge_entries e on e.id = p.knowledge_entry_id
    where p.id = ${proposalId}
  `;
  if (!row) throw notFound(`proposal '${proposalId}' not found`);
  const merged: Record<string, unknown> = { ...row };
  for (const [field, column] of Object.entries(PATCHED_COLUMNS))
    if (row.patch && field in row.patch) merged[column] = row.patch[field];
  return merged as unknown as Proposed;
}

async function nearCopies(
  db: Db,
  entryId: string,
): Promise<NonNullable<PrecheckFinding["copies"]>> {
  if (DUPLICATE_FLOOR === undefined) return [];
  const rows = await db<{ id: string; title: string; similarity: number }[]>`
    select other.id, other.title,
           1 - (other.embedding <=> e.embedding) as similarity
    from knowledge_entries e
    join knowledge_entries other on other.id <> e.id
    where e.id = ${entryId}
      and other.status in ('approved', 'deprecated')
      and (other.product_id is null
           or other.product_id is not distinct from e.product_id)
      and other.embedding is not null and ${currentVector("other")}
      and 1 - (other.embedding <=> e.embedding) >= ${DUPLICATE_FLOOR}
    order by other.embedding <=> e.embedding
    limit ${MAX_NEAR_COPIES}
  `;
  return rows.map((row) => ({
    ...row,
    similarity: Number(Number(row.similarity).toFixed(3)),
  }));
}

/**
 * What can be said of a proposal without a model. A new entry is checked
 * whole; an edit only in the fields it changes, so it is not blamed for gaps
 * the entry already had.
 */
async function findProblems(
  db: Db,
  proposed: Proposed,
): Promise<PrecheckFinding[]> {
  const isNew = proposed.kind === "new";
  const changes = (field: string) =>
    isNew || (proposed.patch !== null && field in proposed.patch);
  const findings: PrecheckFinding[] = [];

  if (isNew) {
    const copies = await nearCopies(db, proposed.entry_id);
    if (copies.length) findings.push({ code: "near_copy", copies });
  }
  if (
    (changes("rootCause") || changes("confidence")) &&
    !proposed.root_cause?.trim() &&
    proposed.confidence !== "low"
  )
    findings.push({ code: "no_root_cause" });
  if (changes("resolution") && !proposed.resolution?.trim())
    findings.push({ code: "no_resolution" });
  if (isNew && !proposed.component_id) findings.push({ code: "no_component" });
  if (isNew && !proposed.work_item_id && !proposed.related_links.length)
    findings.push({ code: "no_source" });
  return findings;
}

/**
 * Checks a proposal as it stands and stores what was found. Run again when
 * the proposal changes: the earlier remarks of the model no longer describe it.
 */
export async function runProposalChecks(
  db: Db,
  proposalId: string,
): Promise<void> {
  const checks = await findProblems(db, await proposedEntry(db, proposalId));
  await db`
    update library_proposals set precheck = ${jsonb({ checks })}
    where id = ${proposalId}
  `;
}

/** What a reviewer of the text needs, and whose credential pays for reading it. */
export interface AdviceSubject {
  kind: ProposalKind;
  submittedBy: string | null;
  title: string;
  issueSummary: string | null;
  rootCause: string | null;
  resolution: string | null;
  investigation: string | null;
  symptoms: string[];
  confidence: string | null;
}

export async function getAdviceSubject(
  proposalId: string,
): Promise<AdviceSubject> {
  const proposed = await proposedEntry(sql, proposalId);
  return {
    kind: proposed.kind,
    submittedBy: proposed.submitted_by,
    title: proposed.title,
    issueSummary: proposed.issue_summary,
    rootCause: proposed.root_cause,
    resolution: proposed.resolution,
    investigation: proposed.investigation,
    symptoms: proposed.symptoms,
    confidence: proposed.confidence,
  };
}

export async function setProposalAdvice(
  proposalId: string,
  advice: ProposalAdvice,
): Promise<void> {
  await sql`
    update library_proposals
    set precheck = coalesce(precheck, '{"checks":[]}'::jsonb)
                   || ${jsonb({ advice })}
    where id = ${proposalId}
  `;
}

/** Open proposals the model has not read yet, oldest first. */
export async function listUnadvisedProposals(): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id from library_proposals
    where status = 'open' and (precheck is null or not precheck ? 'advice')
    order by created_at
    limit ${ADVICE_BATCH}
  `;
  return rows.map((row) => row.id);
}
