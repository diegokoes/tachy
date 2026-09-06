import { REPO_INDEX_STATUSES } from "@tachy/core";
import { insertRows, insertWindowed, type Tx } from "./batches";
import { intBetween, pastDate, pick, rngFor, uuidFor } from "./deterministic";
import {
  CODE_AREAS,
  CODE_LANGS,
  CODE_NOUNS,
  CODE_TEMPLATES,
  CODE_VERBS,
  namesFor,
} from "./corpus";
import { embedColumn, type Embedder } from "./embed";
import type { SeededProduct } from "./org";
import type { SeededComponent, SeededCustomer } from "./catalog";
import type { SeededProject } from "./sources";
import type { Volumes } from "./scale";

/**
 * The identity of one generated file. Chunks read it rather than each drawing
 * their own, so a file's chunks name the same module and the same symbols —
 * which is what makes a trigram hit on an identifier land somewhere specific.
 */
function fileIdentity(i: number) {
  const rng = rngFor("file", i);
  const area = pick(rng, CODE_AREAS);
  const noun = pick(rng, CODE_NOUNS);
  const verb = pick(rng, CODE_VERBS);
  const [lang, ext] = pick(rng, CODE_LANGS);
  return {
    rng,
    lang,
    // The index is part of the name, so the path is unique across every repo
    // and a chunk that quotes it is unique too.
    path: `src/${area}/${verb}-${noun}-${i}.${ext}`,
    names: namesFor(area, noun, verb),
  };
}

export async function seedCode(
  tx: Tx,
  v: Volumes,
  products: SeededProduct[],
  components: SeededComponent[],
  customers: SeededCustomer[],
  projects: SeededProject[],
  connections: { id: string; slug: string }[],
  embed: Embedder,
): Promise<void> {
  const repos = Array.from({ length: v.repos }, (_, i) => ({
    id: uuidFor("repo", i),
    slug: `seed-repo-${i}`,
  }));

  await insertRows(
    tx,
    "repos",
    [
      "id",
      "slug",
      "url",
      "product_id",
      // source_slug references source_connections(slug) -- a text key, not a uuid.
      "source_slug",
      "source_project_id",
      "component_id",
      "customer_id",
      "default_branch",
      "index_status",
      "indexed_commit",
      "file_count",
      "chunk_count",
      "last_indexed_at",
    ],
    repos.map((r, i) => {
      const rng = rngFor("repo", i);
      const product = products[i % products.length];
      return {
        id: r.id,
        slug: r.slug,
        url: `https://github.com/seed/${r.slug}.git`,
        product_id: product.id,
        source_slug: connections[i % connections.length].slug,
        source_project_id: projects[i % projects.length].id,
        component_id: components[i % components.length].id,
        customer_id: i % 5 === 0 ? customers[i % customers.length].id : null,
        default_branch: "main",
        index_status: REPO_INDEX_STATUSES[3],
        indexed_commit: uuidFor("commit", i).replace(/-/g, "").slice(0, 40),
        file_count: 0,
        chunk_count: 0,
        last_indexed_at: pastDate(rng, 30),
      };
    }),
  );

  const perRepo = Math.max(
    1,
    Math.floor(v.repoFiles / Math.max(1, repos.length)),
  );
  const fileCount = repos.length * perRepo;

  await insertWindowed(
    tx,
    "repo_files",
    ["id", "repo_id", "path", "lang", "blob_sha", "size_bytes"],
    fileCount,
    (i) => {
      const { lang, path, rng } = fileIdentity(i);
      return {
        id: uuidFor("repo_file", i),
        repo_id: repos[Math.floor(i / perRepo)].id,
        path,
        lang,
        blob_sha: uuidFor("blob", i).replace(/-/g, "").slice(0, 40),
        size_bytes: intBetween(rng, 400, 24_000),
      };
    },
  );

  const perFile = Math.max(
    1,
    Math.floor(v.codeChunks / Math.max(1, fileCount)),
  );

  await insertWindowed(
    tx,
    "code_chunks",
    [
      "id",
      "repo_id",
      "file_id",
      "ordinal",
      "start_line",
      "end_line",
      "chunk_text",
      "embedding",
    ],
    fileCount * perFile,
    (i) => {
      const f = Math.floor(i / perFile);
      const k = i % perFile;
      const start = 1 + k * 40;
      /*
       * Every chunk used to hold one shared snippet constant: 60k identical
       * rows at --scale=large, and under --embed 60k identical vectors, which
       * makes the HNSW graph degenerate and the trigram index useless. The
       * template is drawn per chunk and interpolates the file's own names.
       */
      const { names, path } = fileIdentity(f);
      const template =
        CODE_TEMPLATES[
          (f + k * 7) % CODE_TEMPLATES.length // co-prime stride: a file's chunks differ
        ];
      // Path first, the shape `backfillCodeEmbeddings` embeds, so a seeded
      // vector and a re-embedded one are built from the same text.
      const chunkText = `// ${path}:${start}-${start + 39}\n${template(names)}`;
      return {
        id: uuidFor("code_chunk", i),
        repo_id: repos[Math.floor(f / perRepo)].id,
        file_id: uuidFor("repo_file", f),
        // (file_id, ordinal) unique by construction.
        ordinal: k,
        start_line: start,
        end_line: start + 39,
        chunk_text: chunkText,
        embedding: chunkText,
      };
    },
    { fill: embedColumn(embed, "code_chunk") },
  );

  // Keep the denormalised counters honest, the way the indexer leaves them.
  await tx`
    update repos r set
      file_count = (select count(*) from repo_files f where f.repo_id = r.id),
      chunk_count = (select count(*) from code_chunks c where c.repo_id = r.id)
  `;
}
