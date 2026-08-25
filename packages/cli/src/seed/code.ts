import { REPO_INDEX_STATUSES } from "@tachy/core";
import { insertRows, type Tx } from "./batches";
import { intBetween, pastDate, rngFor, uuidFor } from "./deterministic";
import { CODE_SNIPPET } from "./corpus";
import type { SeededProduct } from "./org";
import type { SeededComponent, SeededCustomer } from "./catalog";
import type { SeededProject } from "./sources";
import type { Volumes } from "./scale";

export async function seedCode(
  tx: Tx,
  v: Volumes,
  products: SeededProduct[],
  components: SeededComponent[],
  customers: SeededCustomer[],
  projects: SeededProject[],
  connections: { id: string; slug: string }[],
  embed: (kind: string, i: number, text: string) => Promise<string>,
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

  const files: { id: string; repoId: string }[] = [];
  const fileRows: Record<string, unknown>[] = [];
  const perRepo = Math.max(
    1,
    Math.floor(v.repoFiles / Math.max(1, repos.length)),
  );
  for (const repo of repos)
    for (let k = 0; k < perRepo; k++) {
      const i = fileRows.length;
      const id = uuidFor("repo_file", i);
      files.push({ id, repoId: repo.id });
      fileRows.push({
        id,
        repo_id: repo.id,
        // The counter is the path, so (repo_id, path) is unique.
        path: `src/module${k % 12}/file${k}.ts`,
        lang: "typescript",
        blob_sha: uuidFor("blob", i).replace(/-/g, "").slice(0, 40),
        size_bytes: intBetween(rngFor("file", i), 400, 24_000),
      });
    }
  await insertRows(
    tx,
    "repo_files",
    ["id", "repo_id", "path", "lang", "blob_sha", "size_bytes"],
    fileRows,
  );

  const chunkRows: Record<string, unknown>[] = [];
  const perFile = Math.max(
    1,
    Math.floor(v.codeChunks / Math.max(1, files.length)),
  );
  for (const file of files)
    for (let k = 0; k < perFile; k++) {
      const i = chunkRows.length;
      const start = 1 + k * 40;
      chunkRows.push({
        id: uuidFor("code_chunk", i),
        repo_id: file.repoId,
        file_id: file.id,
        // (file_id, ordinal) unique by construction.
        ordinal: k,
        start_line: start,
        end_line: start + 39,
        chunk_text: CODE_SNIPPET,
        embedding: await embed("code_chunk", i, CODE_SNIPPET),
      });
    }
  await insertRows(
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
    chunkRows,
  );

  // Keep the denormalised counters honest, the way the indexer leaves them.
  await tx`
    update repos r set
      file_count = (select count(*) from repo_files f where f.repo_id = r.id),
      chunk_count = (select count(*) from code_chunks c where c.repo_id = r.id)
  `;
}
