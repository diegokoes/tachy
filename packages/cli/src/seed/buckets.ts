import { createHash } from "node:crypto";
import { bucketChunks } from "@tachy/core";
import { insertRows, type Tx } from "./batches";
import { uuidFor } from "./deterministic";
import { embedColumn, type Embedder } from "./embed";
import type { SeededTeam, SeededUser } from "./org";

const DOCS: { title: string; path: string[]; text: string }[] = [
  {
    title: "Installing the scanner driver",
    path: ["Hardware", "Scanners"],
    text: "Download the driver package for your model from the portal. Unplug the scanner before running the installer, then reconnect it when the installer asks. A reboot is required on Windows.",
  },
  {
    title: "Scanner reads codes intermittently",
    path: ["Hardware", "Scanners", "Troubleshooting"],
    text: "Clean the scan window and check the label contrast. Codes printed below 0.3 mm module width are read unreliably at more than 20 cm. Raise the exposure in the scanner profile before replacing hardware.",
  },
  {
    title: "Printing aggregation labels",
    path: ["Production", "Aggregation"],
    text: "Aggregation labels are printed when a case is closed. The printer queue must be assigned to the line in the station settings, or the close operation waits for a printer that never answers.",
  },
  {
    title: "Recalling a dispatch message",
    path: ["Messages"],
    text: "A dispatch message can be recalled within 24 hours of sending. Open the message log, select the message and choose Recall. The repository answers with a recall acknowledgement that appears in the same log.",
  },
  {
    title: "Who registers economic operator IDs",
    path: ["Registration"],
    text: "Economic operator identifiers are issued by the ID issuer of the member state where the operator is established. Facility identifiers are requested from the issuer of the state where the facility is located.",
  },
  {
    title: "Mobile app: quick scan",
    path: ["Mobile App"],
    text: " [video: Performing a Quick Scan] ",
  },
];

/** One bucket, as a Document360 sync would have filled it, readable by the first team. */
export async function seedBuckets(
  tx: Tx,
  teams: SeededTeam[],
  users: SeededUser[],
  embed: Embedder,
): Promise<void> {
  const admin = users.find((u) => u.role === "admin") ?? users[0];
  const team = teams[0];
  if (!admin || !team) return;
  const bucketId = uuidFor("bucket", 0);
  const syncId = "2026-09-30T10:55:38Z";
  // Nobody holds this token: rotate it in the admin panel to push for real.
  const hash = createHash("sha256").update(uuidFor("bucket-token", 0)).digest();

  await insertRows(
    tx,
    "buckets",
    [
      "id",
      "slug",
      "name",
      "description",
      "source",
      "ingest_token_hash",
      "ingest_token_hint",
      "last_batch_at",
      "last_sync_id",
      "created_by",
    ],
    [
      {
        id: bucketId,
        slug: "vendor-kb",
        name: "Vendor knowledge base",
        description:
          "The hardware and portal vendor's public knowledge base, synced from Document360.",
        source: "document360",
        ingest_token_hash: hash,
        ingest_token_hint: "seed",
        last_batch_at: new Date(Date.now() - 6 * 3_600_000),
        last_sync_id: syncId,
        created_by: admin.id,
      },
    ],
  );
  await insertRows(
    tx,
    "bucket_teams",
    ["bucket_id", "team_id"],
    [{ bucket_id: bucketId, team_id: team.id }],
  );

  const docs = DOCS.map((d, i) => ({
    id: uuidFor("bucket-doc", i),
    bucket_id: bucketId,
    external_key: `article|${uuidFor("d360-article", i)}|en`,
    title: d.title,
    url: `https://docs.example.com/vendor/docs/en/${d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    path: d.path,
    version: "1",
    modified_at: new Date(Date.now() - (i + 2) * 86_400_000),
    body: d.text.trim(),
    body_sha: createHash("sha256").update(d.text).digest("hex"),
    metadata: tx.json({ type: "article", lang: "en" }),
    last_sync_id: syncId,
  }));
  await insertRows(
    tx,
    "bucket_docs",
    [
      "id",
      "bucket_id",
      "external_key",
      "title",
      "url",
      "path",
      "version",
      "modified_at",
      "body",
      "body_sha",
      "metadata",
      "last_sync_id",
    ],
    docs,
  );

  const chunks = DOCS.flatMap((d, i) =>
    bucketChunks(d).map((text, ordinal) => ({
      doc_id: docs[i].id,
      ordinal,
      chunk_text: text,
      embedding: text,
    })),
  );
  await embedColumn(embed, "bucket_doc_chunk")(chunks, 0);
  await insertRows(
    tx,
    "bucket_doc_chunks",
    ["doc_id", "ordinal", "chunk_text", "embedding"],
    chunks,
  );
}
