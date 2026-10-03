# Upgrades

## Postgres or pgvector

The image is pinned (`pgvector/pgvector:<pgvector>-pg<major>`) in
`docker-compose.yml`, `test/global-setup.ts`, `load/turns.compose.yml` and
`TACHY_PG_IMAGE` for the restore test.

- **pgvector minor** (same Postgres major): bump the tag everywhere in a
  release and deploy; `tachy-deploy` runs `alter extension vector update`
  before planning, because the schema plan cannot validate against an
  extension version the new image no longer ships. Then run a restore test.
- **Postgres major:** dump and restore. Take `tachy-backup db --restore-test`,
  stop the stack, move the old volume aside, bump the tag, start Postgres on an
  empty volume (it applies `schema.sql`, roles and the stamp), and restore the
  data as in [schema-change.md](schema-change.md). Keep the old volume until a
  week of green restore tests.

## The embedding model or vector dimension

Vectors from two models share no space. The design and its trade-offs are in
DEPLOYMENT-ARCHITECTURE.md §5.15.

**The release** changes, together:

- `TACHY_EMBED_MODEL`, and its entry in `EMBEDDING_MODELS`;
- `SEM_FLOOR` and `SEM_CEIL`, re-derived with `scripts/eval-embeddings.ts`;
- if the dimension changes, the `vector(N)` columns and `EMBEDDING_DIM`.

**The window:**

```sh
cd /opt/tachy
C="docker compose -f docker-compose.yml -f deploy/compose.prod.yml"
```

1. `sudo tachy-backup db --restore-test`.
2. Switch maintenance on (the Maintenance row in the admin runtime panel).
3. **Only if the dimension changes**, null the vectors. pgvector refuses to
   alter a populated `vector(768)` column (`expected N dimensions, not 768`).
   `code_chunks` is the superseded code index, read only by
   `adoptSupersededIndex` at api boot. It holds vectors too.

   ```sh
   $C exec -T postgres psql -v ON_ERROR_STOP=1 -U tachy -d tachy \
     -c 'update knowledge_entries set embedding = null' \
     -c 'update reference_doc_chunks set embedding = null' \
     -c 'update code_blob_chunks set embedding = null' \
     -c 'update bucket_doc_chunks set embedding = null' \
     -c 'update code_chunks set embedding = null'
   ```

4. `tachy-deploy <commit>`. Read the plan as in
   [schema-change.md](schema-change.md). The restart clears the maintenance
   switch; switch it on again.
5. Drop the HNSW indexes, so the reembed doesn't update them row by row, then
   reembed:

   ```sh
   $C exec -T postgres psql -v ON_ERROR_STOP=1 -U tachy -d tachy \
     -c 'drop index knowledge_embedding_idx, reference_doc_chunks_embedding_idx,
                    code_blob_chunks_embedding_idx, bucket_doc_chunks_embedding_idx'
   $C run --rm cli npm run sync reembed
   ```

6. Recreate the four indexes. Copy their `create index … using hnsw`
   statements from `db/schema.sql` and run them with `psql` as above. Then
   try a plan as in [schema-change.md](schema-change.md): it must come back
   empty. The admin page compares schema hashes, so it can't show a missing
   index.
7. Switch maintenance off.

From step 4 until step 6 ends, search is wrong, not just slow. Library search
stays up through the window. To keep it from serving mixed results, stop the
api through steps 5 and 6 ([maintenance.md](maintenance.md)).
