import { safeFilename } from "@tachy/contract";
import { sql } from "../infra/db";
import { notFound } from "../infra/errors";

export { safeFilename };

export interface OutputMeta {
  id: string;
  user_id: string | null;
  artifact_id: string | null;
  utility: string;
  filename: string;
  mime: string;
  byte_size: number;
  meta: Record<string, unknown>;
  created_at: string;
  expires_at: string;
}

export interface OutputRow extends OutputMeta {
  bytes: Buffer;
}

const DEFAULT_TTL_HOURS = 24;

function ttlHours(): number {
  const raw = Number(process.env.TACHY_OUTPUT_TTL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_HOURS;
}

const META_COLUMNS = sql`
  id, user_id, artifact_id, utility, filename, mime, byte_size, meta, created_at, expires_at
`;

/** Unowned rows exist only where no user account resolves at all, so any caller may read them. */
const ownedBy = (userId: string) =>
  sql`(user_id = ${userId} or user_id is null)`;

export async function createOutput(i: {
  userId?: string | null;
  artifactId?: string | null;
  utility: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
  meta?: Record<string, unknown>;
}): Promise<OutputMeta> {
  const [row] = await sql`
    insert into generated_outputs
      (user_id, artifact_id, utility, filename, mime, bytes, byte_size, meta, expires_at)
    values (
      ${i.userId ?? null}, ${i.artifactId ?? null}, ${i.utility},
      ${safeFilename(i.filename)}, ${i.mime}, ${Buffer.from(i.bytes)},
      ${i.bytes.byteLength}, ${sql.json((i.meta ?? {}) as never)},
      now() + ${`${ttlHours()} hours`}::interval
    )
    returning ${META_COLUMNS}
  `;
  return row as unknown as OutputMeta;
}

export async function getOutput(
  id: string,
  userId: string,
): Promise<OutputRow> {
  const [row] = await sql`
    select ${META_COLUMNS}, bytes
    from generated_outputs
    where id = ${id} and ${ownedBy(userId)} and expires_at > now()
  `;
  if (!row) throw notFound(`Output '${id}' not found or expired`);
  return row as unknown as OutputRow;
}

export async function listOutputs(userId: string): Promise<OutputMeta[]> {
  const rows = await sql`
    select ${META_COLUMNS}
    from generated_outputs
    where ${ownedBy(userId)} and expires_at > now()
    order by created_at desc
  `;
  return rows as unknown as OutputMeta[];
}

export async function deleteOutput(
  id: string,
  userId: string,
): Promise<boolean> {
  const rows = await sql`
    delete from generated_outputs
    where id = ${id} and ${ownedBy(userId)}
    returning id
  `;
  return rows.length > 0;
}

export async function sweepExpiredOutputs(): Promise<number> {
  const rows = await sql`
    delete from generated_outputs where expires_at <= now() returning id
  `;
  return rows.length;
}
