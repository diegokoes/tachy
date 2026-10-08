import { sql, jsonb } from "../infra/db";
import { notFound } from "../infra/errors";
import type {
  ReportDirection,
  ReportReview,
  ReportRow,
  ReportMessageRow,
  ReportStatus,
  ReportType,
} from "@tachy/contract";

export interface CreateReportInput {
  reporterId?: string | null;
  type: ReportType;
  title?: string | null;
  body: string;
  context?: Record<string, unknown>;
  aiReview?: ReportReview | null;
}

const REPORT_COLS = sql`
  r.id, r.reporter_id,
  coalesce(u.display_name, u.email) as reporter_name,
  r.type, r.status, r.title, r.body_text, r.context, r.ai_review,
  r.created_at, r.updated_at
`;

export async function createReport(
  input: CreateReportInput,
): Promise<ReportRow> {
  const [row] = await sql<ReportRow[]>`
    insert into reports (reporter_id, type, title, body_text, context, ai_review)
    values
      (${input.reporterId ?? null}, ${input.type}, ${input.title ?? null}, ${input.body},
       ${jsonb(input.context ?? {})}, ${input.aiReview ? jsonb(input.aiReview) : null})
    returning id, reporter_id, type, status, title, body_text, context,
              ai_review, created_at, updated_at
  `;
  return row;
}

export async function listMyReports(userId: string): Promise<ReportRow[]> {
  return sql<ReportRow[]>`
    select ${REPORT_COLS}
    from reports r
    left join users u on u.id = r.reporter_id
    where r.reporter_id = ${userId}
    order by r.created_at desc
  `;
}

export async function listReports(
  opts: { status?: ReportStatus } = {},
): Promise<ReportRow[]> {
  return sql<ReportRow[]>`
    select ${REPORT_COLS}
    from reports r
    left join users u on u.id = r.reporter_id
    ${opts.status ? sql`where r.status = ${opts.status}` : sql``}
    order by r.created_at desc
  `;
}

export async function getReport(id: string): Promise<ReportRow> {
  const [row] = await sql<ReportRow[]>`
    select ${REPORT_COLS}
    from reports r
    left join users u on u.id = r.reporter_id
    where r.id = ${id}
  `;
  if (!row) throw notFound(`report ${id} not found`);
  const messages = await sql<ReportMessageRow[]>`
    select m.id, m.report_id, m.author_id,
           coalesce(u.display_name, u.email) as author_name,
           m.direction, m.body_text, m.created_at
    from report_messages m
    left join users u on u.id = m.author_id
    where m.report_id = ${id}
    order by m.created_at asc
  `;
  return { ...row, messages };
}

export async function addReportMessage(input: {
  reportId: string;
  authorId?: string | null;
  direction: ReportDirection;
  body: string;
}): Promise<ReportMessageRow> {
  const [row] = await sql<ReportMessageRow[]>`
    insert into report_messages (report_id, author_id, direction, body_text)
    values (${input.reportId}, ${input.authorId ?? null}, ${input.direction}, ${input.body})
    returning id, report_id, author_id, direction, body_text, created_at
  `;
  await sql`update reports set updated_at = now() where id = ${input.reportId}`;
  return row;
}

export async function setReportStatus(
  id: string,
  status: ReportStatus,
): Promise<ReportRow> {
  const [row] = await sql<ReportRow[]>`
    update reports set status = ${status}, updated_at = now()
    where id = ${id}
    returning id, reporter_id, type, status, title, body_text, context,
              ai_review, created_at, updated_at
  `;
  if (!row) throw notFound(`report ${id} not found`);
  return row;
}
