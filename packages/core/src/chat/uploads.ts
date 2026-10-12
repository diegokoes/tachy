import {
  DEFAULT_UPLOAD_LIMITS,
  parseUploadRef,
  uploadRef,
  type FileContentType,
  type UploadLimits,
} from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput } from "../infra/errors";

export const uploadTtlMs = () =>
  (Number(process.env.TACHY_UPLOAD_TTL_HOURS) || 24) * 60 * 60_000;

const megabytesFrom = (variable: string, fallbackBytes: number) => {
  const megabytes = Number(process.env[variable]);
  return megabytes > 0 ? megabytes * 1024 * 1024 : fallbackBytes;
};

/** This host's upload limits: the contract's defaults unless it sets its own. */
export const uploadLimits = (): UploadLimits => ({
  imageBytes: megabytesFrom(
    "TACHY_UPLOAD_IMAGE_MAX_MB",
    DEFAULT_UPLOAD_LIMITS.imageBytes,
  ),
  fileBytes: megabytesFrom(
    "TACHY_UPLOAD_MAX_MB",
    DEFAULT_UPLOAD_LIMITS.fileBytes,
  ),
});

export async function saveUpload(input: {
  userId: string | null;
  filename: string;
  contentType: FileContentType;
  bytes: Uint8Array;
}): Promise<{ id: string; ref: string }> {
  const [row] = await sql`
    insert into chat_uploads
      (user_id, filename, content_type, byte_size, bytes, expires_at)
    values (${input.userId}, ${input.filename}, ${input.contentType},
            ${input.bytes.byteLength}, ${input.bytes},
            now() + ${uploadTtlMs()} * interval '1 millisecond')
    returning id
  `;
  return {
    id: row.id as string,
    ref: uploadRef(row.id as string, input.filename),
  };
}

/**
 * What a turn with no user behind it passes as its owner. It reads the uploads
 * nobody owns, which are the ones such a turn can have made.
 */
export const ANONYMOUS_UPLOADS = "_anonymous";

/**
 * The bytes behind a reference. With an owner, only that user's uploads
 * resolve: a turn's MCP child cannot read another person's attachment even
 * with its reference. A null `contentType` is a row stored unchecked.
 */
export async function readUpload(
  ref: string,
  owner: string | undefined,
): Promise<{
  filename: string;
  contentType: FileContentType | null;
  bytes: Buffer;
}> {
  const parsed = parseUploadRef(ref);
  if (!parsed)
    throw badInput(
      `'${ref}' is not an uploaded file; only chat attachments can be read`,
    );
  const anonymous = owner === ANONYMOUS_UPLOADS;
  const [row] = await sql`
    select filename, content_type, bytes from chat_uploads
    where id = ${parsed.id} and expires_at > now()
      and (${owner === undefined}
           or user_id is not distinct from ${anonymous ? null : (owner ?? null)}::uuid)
  `;
  if (!row)
    throw badInput(
      `'${ref}' is not an uploaded file; only chat attachments can be read`,
    );
  return {
    filename: row.filename as string,
    contentType: row.content_type as FileContentType | null,
    bytes: Buffer.from(row.bytes),
  };
}

export async function sweepUploads(): Promise<number> {
  const rows =
    await sql`delete from chat_uploads where expires_at <= now() returning id`;
  return rows.length;
}
