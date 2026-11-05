/** The original file a library doc's text was read out of, kept to open as it was. */
import { createHash } from "node:crypto";
import { LIBRARY_FILE_TYPES, type FileContentType } from "@tachy/contract";
import { sql, type Db } from "../infra/db";

/** Whether a doc keeps the original of a file of this type. */
export const keepsOriginal = (contentType: FileContentType | null) =>
  !!contentType &&
  (LIBRARY_FILE_TYPES as readonly string[]).includes(contentType);

/** Stores the file once per content and returns its id. */
export async function saveLibraryFile(
  db: Db,
  file: {
    filename: string;
    contentType: FileContentType;
    bytes: Uint8Array;
    createdBy?: string | null;
  },
): Promise<string> {
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const [row] = await db<{ id: string }[]>`
    insert into library_files (sha256, content_type, filename, byte_size, bytes, created_by)
    values (${sha256}, ${file.contentType}, ${file.filename}, ${file.bytes.byteLength},
            ${Buffer.from(file.bytes)}, ${file.createdBy ?? null})
    on conflict (sha256) do update set sha256 = excluded.sha256
    returning id
  `;
  return row.id;
}

export interface DocFile {
  filename: string;
  content_type: string;
  bytes: Uint8Array;
}

/** The original a doc was saved from, or null for a doc written as text. */
export async function getDocFile(docId: string): Promise<DocFile | null> {
  const [row] = await sql<DocFile[]>`
    select f.filename, f.content_type, f.bytes
    from reference_docs d join library_files f on f.id = d.file_id
    where d.id = ${docId}
  `;
  return row ?? null;
}

/** Files no doc points at any more, a week after they were stored. */
export async function sweepOrphanFiles(): Promise<number> {
  const rows = await sql`
    delete from library_files f
    where f.created_at < now() - interval '7 days'
      and not exists (select 1 from reference_docs d where d.file_id = f.id)
    returning f.id
  `;
  return rows.length;
}
