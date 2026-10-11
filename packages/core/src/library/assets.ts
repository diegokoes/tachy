import { createHash } from "node:crypto";
import { MAX_ASSET_BYTES, assetPath, sniffImage } from "@tachy/contract";
import type { LibraryAssetType } from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SavedAsset {
  id: string;
  url: string;
  content_type: LibraryAssetType;
  byte_size: number;
}

export async function saveAsset(input: {
  bytes: Uint8Array;
  filename?: string | null;
  productId?: string | null;
  createdById?: string | null;
}): Promise<SavedAsset> {
  if (input.bytes.byteLength > MAX_ASSET_BYTES)
    throw badInput(`image too large (max ${MAX_ASSET_BYTES / 1024 / 1024} MB)`);
  const type = sniffImage(input.bytes);
  if (!type) throw badInput("unsupported image; use PNG, JPEG, GIF or WebP");

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  // The no-op update is what makes RETURNING hand back the existing row on a
  // duplicate; `do nothing` returns nothing at all.
  const [row] = await sql`
    insert into library_assets
      (product_id, created_by, sha256, content_type, byte_size, filename, bytes)
    values
      (${input.productId ?? null}, ${input.createdById ?? null}, ${sha256}, ${type},
       ${input.bytes.byteLength}, ${input.filename ?? null}, ${Buffer.from(input.bytes)})
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
