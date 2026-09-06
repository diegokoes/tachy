import { LIBRARY_ACTORS } from "@tachy/core";
import { insertRows, type Tx } from "./batches";
import {
  chance,
  intBetween,
  pastDate,
  pick,
  rngFor,
  uuidFor,
} from "./deterministic";
import type { SeededUser } from "./org";
import type { Knowledge } from "./knowledge";
import type { Volumes } from "./scale";

/**
 * Edit history and read counts for the seeded library. Both are what the
 * history panel and the "most read" sort have to render against, so a dev
 * database without them cannot show either working.
 *
 * saveKnowledgeEntry seeds version 1 for entries created through core, but the
 * seeder inserts rows directly for speed — so version 1 is written here too,
 * and later versions are stacked on top of it.
 */
export async function seedLibrary(
  tx: Tx,
  v: Volumes,
  knowledge: Knowledge,
  users: SeededUser[],
): Promise<void> {
  if (!users.length) return;

  const revisions: Record<string, unknown>[] = [];
  const addRevisions = (
    kind: "entry" | "doc",
    ids: string[],
    column: "knowledge_entry_id" | "reference_doc_id",
  ) => {
    ids.forEach((id, i) => {
      const rng = rngFor(`${kind}_revisions`, i);
      // Most things are written once and left alone; a few get worked over.
      const versions = chance(rng, 0.35) ? intBetween(rng, 2, 5) : 1;
      for (let version = 1; version <= versions; version++) {
        const actor = version === 1 ? "web" : pick(rng, LIBRARY_ACTORS);
        revisions.push({
          id: uuidFor(`${kind}_revision`, i * 10 + version),
          knowledge_entry_id: column === "knowledge_entry_id" ? id : null,
          reference_doc_id: column === "reference_doc_id" ? id : null,
          version,
          user_id: users[(i + version) % users.length].id,
          actor,
          turn_id: actor === "agent" ? uuidFor("turn", i * 10 + version) : null,
          changed_fields:
            version === 1
              ? []
              : pick(rng, [
                  ["resolution"],
                  ["status"],
                  ["root_cause", "resolution"],
                  ["tags"],
                ]),
          // The live row is the current version; a snapshot of it is what a
          // revision holds. Seeded ones only need to be shaped like one.
          snapshot: JSON.stringify({ seeded: true, version }),
          created_at: pastDate(rng, 90),
        });
      }
    });
  };

  addRevisions("entry", knowledge.entries, "knowledge_entry_id");
  addRevisions("doc", knowledge.docs, "reference_doc_id");

  await insertRows(
    tx,
    "library_revisions",
    [
      "id",
      "knowledge_entry_id",
      "reference_doc_id",
      "version",
      "user_id",
      "actor",
      "turn_id",
      "changed_fields",
      "snapshot",
      "created_at",
    ],
    revisions,
  );

  // One bucket per (item, reader, day). Only a slice of the library is read at
  // all, which is the shape the "worth consolidating" signal depends on.
  const views: Record<string, unknown>[] = [];
  const addViews = (
    kind: "entry" | "doc",
    ids: string[],
    column: "knowledge_entry_id" | "reference_doc_id",
  ) => {
    ids.forEach((id, i) => {
      const rng = rngFor(`${kind}_views`, i);
      if (!chance(rng, 0.6)) return;
      const readers = intBetween(rng, 1, Math.min(4, users.length));
      for (let r = 0; r < readers; r++) {
        const days = intBetween(rng, 1, 3);
        for (let d = 0; d < days; d++) {
          const when = pastDate(rng, 60);
          views.push({
            id: uuidFor(`${kind}_view`, i * 100 + r * 10 + d),
            knowledge_entry_id: column === "knowledge_entry_id" ? id : null,
            reference_doc_id: column === "reference_doc_id" ? id : null,
            user_id: users[(i + r) % users.length].id,
            day: when.toISOString().slice(0, 10),
            views: intBetween(rng, 1, 6),
            last_viewed_at: when,
          });
        }
      }
    });
  };

  addViews("entry", knowledge.entries, "knowledge_entry_id");
  addViews("doc", knowledge.docs, "reference_doc_id");

  // The (item, reader, day) unique index is the point of the table; a seeded
  // collision is a duplicate day, not a reason to fail the seed.
  const seen = new Set<string>();
  const unique = views.filter((row) => {
    const key = `${row.knowledge_entry_id}|${row.reference_doc_id}|${row.user_id}|${row.day}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await insertRows(
    tx,
    "library_views",
    [
      "id",
      "knowledge_entry_id",
      "reference_doc_id",
      "user_id",
      "day",
      "views",
      "last_viewed_at",
    ],
    unique,
  );
}
