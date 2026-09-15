import { createHash } from "node:crypto";
import { MAX_ASSET_BYTES, assetPath } from "@tachy/contract";
import type { LibraryAssetType } from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const starts = (bytes: Uint8Array, at: number, sig: number[]) =>
  sig.every((b, i) => bytes[at + i] === b);

/**
 * What the bytes are, read from their first few. The upload's own content type
 * is the browser's guess from a file extension, and trusting it is how a page
 * of HTML gets stored and served back as an "image".
 */
export function sniffImage(bytes: Uint8Array): LibraryAssetType | null {
  if (starts(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (starts(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(bytes, 0, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (
    starts(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    starts(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  )
    return "image/webp";
  return null;
}

export interface SavedAsset {
  id: string;
  url: string;
  content_type: LibraryAssetType;
  byte_size: number;
}

export async function saveAsset(i: {
  bytes: Uint8Array;
  filename?: string | null;
  productId?: string | null;
  createdById?: string | null;
}): Promise<SavedAsset> {
  if (i.bytes.byteLength > MAX_ASSET_BYTES)
    throw badInput(`image too large (max ${MAX_ASSET_BYTES / 1024 / 1024} MB)`);
  const type = sniffImage(i.bytes);
  if (!type)
    throw badInput("not an image the wiki accepts — PNG, JPEG, GIF or WebP");

  const sha256 = createHash("sha256").update(i.bytes).digest("hex");
  // The no-op update is what makes RETURNING hand back the existing row on a
  // duplicate; `do nothing` returns nothing at all.
  const [row] = await sql`
    insert into library_assets
      (product_id, created_by, sha256, content_type, byte_size, filename, bytes)
    values
      (${i.productId ?? null}, ${i.createdById ?? null}, ${sha256}, ${type},
       ${i.bytes.byteLength}, ${i.filename ?? null}, ${Buffer.from(i.bytes)})
    on conflict (sha256) do update set sha256 = excluded.sha256
    returning id, content_type, byte_size
  `;
  return {
    id: row.id as string,
    url: assetPath(row.id as string),
    content_type: row.content_type as LibraryAssetType,
    byte_size: row.byte_size as number,
  };
}

export async function getAsset(
  id: string,
): Promise<{ contentType: LibraryAssetType; bytes: Buffer }> {
  if (!UUID_RE.test(id)) throw notFound(`No image '${id}'`);
  const [row] = await sql`
    select content_type, bytes from library_assets where id = ${id}
  `;
  if (!row) throw notFound(`No image '${id}'`);
  return {
    contentType: row.content_type as LibraryAssetType,
    bytes: row.bytes as Buffer,
  };
}
