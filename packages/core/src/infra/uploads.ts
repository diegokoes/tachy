import { sql } from "./db";
import { badInput } from "./errors";

export const uploadTtlMs = () =>
  (Number(process.env.TACHY_UPLOAD_TTL_HOURS) || 24) * 60 * 60_000;

/**
 * How an upload is named to the agent and its tools: a reference, not a file
 * path, so it resolves the same on every replica and can never name a file on
 * the host.
 */
export const uploadRef = (id: string, filename: string) =>
  `upload:${id}/${filename}`;

const REF_RE = /^upload:([0-9a-f-]{36})(?:\/(.*))?$/;

export function parseUploadRef(
  ref: string,
): { id: string; filename: string } | null {
  const m = REF_RE.exec(ref.trim());
  return m ? { id: m[1], filename: m[2] ?? "" } : null;
}

export async function saveUpload(i: {
  userId: string | null;
  filename: string;
  bytes: Uint8Array;
}): Promise<{ id: string; ref: string }> {
  const [row] = await sql`
    insert into chat_uploads (user_id, filename, byte_size, bytes, expires_at)
    values (${i.userId}, ${i.filename}, ${i.bytes.byteLength}, ${i.bytes},
            now() + ${uploadTtlMs()} * interval '1 millisecond')
    returning id
  `;
  return { id: row.id as string, ref: uploadRef(row.id as string, i.filename) };
}

/**
 * The bytes behind a reference. With an owner, only that user's uploads
 * resolve: a turn's MCP child cannot read another person's attachment even
 * with its reference.
 */
export async function readUpload(
  ref: string,
  owner: string | undefined,
): Promise<{ filename: string; bytes: Buffer }> {
  const parsed = parseUploadRef(ref);
  if (!parsed)
    throw badInput(
      `'${ref}' is not an uploaded file; only chat attachments can be read`,
    );
  const [row] = await sql`
    select filename, bytes from chat_uploads
    where id = ${parsed.id} and expires_at > now()
      and (${owner ?? null}::uuid is null or user_id = ${owner ?? null})
  `;
  if (!row)
    throw badInput(
      `'${ref}' is not an uploaded file; only chat attachments can be read`,
    );
  return { filename: row.filename as string, bytes: Buffer.from(row.bytes) };
}

export async function sweepUploads(): Promise<number> {
  const rows =
    await sql`delete from chat_uploads where expires_at <= now() returning id`;
  return rows.length;
}
