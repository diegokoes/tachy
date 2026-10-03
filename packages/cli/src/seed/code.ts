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
    ],
    repos.map((r, i) => {
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
    Math.floor(v.repoFiles / Math.max(1, repos.length)),
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
    Math.floor(v.codeChunks / Math.max(1, fileCount)),
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
      const f = Math.floor(i / perFile);
      const k = i % perFile;
      const start = 1 + k * 40;
      // The template is drawn per chunk and interpolates the file's own
      // names. A shared snippet gives 60k identical rows at --scale=large, and
      // under --embed 60k identical vectors, which degenerates the HNSW graph
      // and makes the trigram index useless.
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
        blob_sha: blobOf(f),
        // (repo_id, blob_sha, ordinal) unique by construction.
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
    update repo_lines l set
      file_count = (select count(*) from repo_line_files f where f.line_id = l.id),
      chunk_count = (select count(*) from code_blob_chunks c where c.repo_id = l.repo_id)
  `;
}
