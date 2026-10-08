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
 * their own, so a file's chunks name the same module and the same symbols -
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
  volumes: Volumes,
  products: SeededProduct[],
  components: SeededComponent[],
  customers: SeededCustomer[],
  projects: SeededProject[],
  connections: { id: string; slug: string }[],
  embed: Embedder,
): Promise<void> {
  const repos = Array.from({ length: volumes.repos }, (_, i) => ({
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
      // source_slug references source_connections(slug): a text key, not a
      // uuid.
      "source_slug",
      "source_project_id",
      "component_id",
      "customer_id",
      "default_branch",
    ],
    repos.map((repo, i) => {
      const product = products[i % products.length];
      return {
        id: repo.id,
        slug: repo.slug,
        url: `https://github.com/seed/${repo.slug}.git`,
        product_id: product.id,
        source_slug: connections[i % connections.length].slug,
        source_project_id: projects[i % projects.length].id,
        component_id: components[i % components.length].id,
        customer_id: i % 5 === 0 ? customers[i % customers.length].id : null,
        default_branch: "main",
      };
    }),
  );

  await insertRows(
    tx,
    "repo_lines",
    [
      "id",
      "repo_id",
      "ref",
      "index_status",
      "indexed_commit",
      "last_indexed_at",
    ],
    repos.map((r, i) => ({
      id: uuidFor("repo_line", i),
      repo_id: r.id,
      ref: "main",
      index_status: REPO_INDEX_STATUSES[3],
      indexed_commit: uuidFor("commit", i).replace(/-/g, "").slice(0, 40),
      last_indexed_at: pastDate(rngFor("repo", i), 30),
    })),
  );

  const perRepo = Math.max(
    1,
    Math.floor(volumes.repoFiles / Math.max(1, repos.length)),
  );
  const fileCount = repos.length * perRepo;

  const blobOf = (f: number) =>
    uuidFor("blob", f).replace(/-/g, "").slice(0, 40);

  await insertWindowed(
    tx,
    "repo_line_files",
    ["id", "line_id", "repo_id", "path", "lang", "blob_sha", "size_bytes"],
    fileCount,
    (i) => {
      const { lang, path, rng } = fileIdentity(i);
      const repo = Math.floor(i / perRepo);
      return {
        id: uuidFor("repo_file", i),
        line_id: uuidFor("repo_line", repo),
        repo_id: repos[repo].id,
        path,
        lang,
        blob_sha: blobOf(i),
        size_bytes: intBetween(rng, 400, 24_000),
      };
    },
  );

  const perFile = Math.max(
    1,
    Math.floor(volumes.codeChunks / Math.max(1, fileCount)),
  );

  await insertWindowed(
    tx,
    "code_blob_chunks",
    [
      "id",
      "repo_id",
      "blob_sha",
      "ordinal",
      "start_line",
      "end_line",
      "chunk_text",
      "embedding",
    ],
    fileCount * perFile,
    (i) => {
      const file = Math.floor(i / perFile);
      const chunk = i % perFile;
      const start = 1 + chunk * 40;
      // Drawn per chunk and filled with the file's own names. A shared snippet
      // gives identical rows and, under --embed, identical vectors: a
      // degenerate HNSW graph and a useless trigram index.
      const { names, path } = fileIdentity(file);
      const template =
        CODE_TEMPLATES[
          (file + chunk * 7) % CODE_TEMPLATES.length // co-prime stride: a file's chunks differ
        ];
      // Path first, the shape `backfillCodeEmbeddings` embeds, so a seeded
      // vector and a re-embedded one are built from the same text.
      const chunkText = `// ${path}:${start}-${start + 39}\n${template(names)}`;
      return {
        id: uuidFor("code_chunk", i),
        repo_id: repos[Math.floor(file / perRepo)].id,
        blob_sha: blobOf(file),
        // (repo_id, blob_sha, ordinal) unique by construction.
        ordinal: chunk,
        start_line: start,
        end_line: start + 39,
        chunk_text: chunkText,
        embedding: chunkText,
      };
    },
    { fill: embedColumn(embed, "code_chunk") },
  );

  // Sets the denormalised counters the way the indexer leaves them.
  await tx`
    update repo_lines l set
      file_count = (select count(*) from repo_line_files f where f.line_id = l.id),
      chunk_count = (select count(*) from code_blob_chunks c where c.repo_id = l.repo_id)
  `;
}
