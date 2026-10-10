# Upgrades

## Postgres or pgvector

The image is pinned (`pgvector/pgvector:<pgvector>-pg<major>`) in
`docker-compose.yml`, `test/global-setup.ts` and `load/turns.compose.yml`. The
restore test reads it from `docker-compose.yml`.

- **pgvector minor** (same Postgres major): bump the tag everywhere in a
  release and deploy; `tachy-deploy` runs `alter extension vector update`
  before planning, because the schema plan cannot validate against an
  extension version the new image no longer ships. Then run a restore test.
- **Postgres major:** dump and restore. Take `tachy-backup db --restore-test`,
  stop the stack, move the old volume aside, bump the tag, start Postgres on an
  empty volume (it applies `schema.sql`, roles and the stamp), and restore the
  data as in [schema-change.md](schema-change.md). Keep the old volume until a
  week of green restore tests.

## The embedding model

Vectors from two models share no space. Every stored vector names the model
that made it, and search reads only the vectors of the model in use, so a model
change needs no window: until a row is embedded again it is found by its words
and not by its meaning. The design is in DEPLOYMENT-ARCHITECTURE.md §5.15.

**The release** changes `TACHY_EMBED_MODEL`, or the default in
`core/src/search/model.ts`. The model needs an entry in `EMBEDDING_MODELS` with
its pooling, its window and the floor and ceiling `scripts/eval-embeddings.ts`
prints for it; `test/search/quality.test.ts` fails until they fit.
`scripts/eval-code-search.ts` measures the same change on code. A model
published without an ONNX file needs an export in a repository the build can
read, named in its entry with the commit to read it at (`source`, `revision`);
§5.15 has how mDenseOn's was made.

**Its memory moves with it.** A model of another size changes what the
embedder holds at its peak: `scripts/bench-embedder.ts --heaviest` against a
running embedder, read from the container's `memory.peak`. Three host
variables follow, together (DEPLOYMENT-ARCHITECTURE.md §3.2):

- `TACHY_EMBEDDER_MEM_LIMIT` is that peak plus 800 MiB;
- `TACHY_API_MEM_LIMIT` gives up what the embedder gained;
- `TACHY_AGENT_SLOT_CAP` is what the api's limit holds at 0.44 GB a turn,
  after 0.3 GB for the api itself.

A host that sets any of them in its `.env` keeps its own value, so check them
before the deploy. A cap saved in Admin › system wins over the variable (its
badge reads `db`): change it there.

**After the deploy:**

1. Admin › system lists "vectors from another embedding model", with a count
   per table.
2. Run `embeddings.backfill` from Admin › workers › jobs. It embeds every row
   whose vector is missing or another model's, and a second run picks up where
   an interrupted one stopped. On the laptop expect about 1 row a second.
3. Optional, for code: run `repos.refresh` with `scope: all` and `full: true`.
   The backfill embeds the chunks as they are; a full reindex also cuts them
   again to the new model's window.
4. The issue clears when no row is left.

Rolling back is the same in reverse: the previous model finds its own vectors
again wherever the backfill had not reached, and the rest wait for a backfill.

## The vector dimension

A model with another dimension changes the `vector(N)` columns and
`EMBEDDING_DIM` in the same release, and pgvector refuses to alter a populated
column (`expected N dimensions, not 768`). So this one needs a window:

```sh
cd /opt/tachy
C="docker compose -f docker-compose.yml -f deploy/compose.prod.yml"
```

1. `sudo tachy-backup db --restore-test`.
2. Switch maintenance on (the Maintenance row in the admin runtime panel).
3. Null the vectors:

   ```sh
   $C exec -T postgres psql -v ON_ERROR_STOP=1 -U tachy -d tachy \
     -c 'update knowledge_entries set embedding = null' \
     -c 'update reference_doc_chunks set embedding = null' \
     -c 'update code_blob_chunks set embedding = null' \
     -c 'update bucket_doc_chunks set embedding = null'
   ```

4. `tachy-deploy <commit>`. Read the plan as in
   [schema-change.md](schema-change.md). The restart clears the maintenance
   switch; switch it on again.
5. Drop the HNSW indexes, so the backfill doesn't update them row by row, then
   embed:

   ```sh
   $C exec -T postgres psql -v ON_ERROR_STOP=1 -U tachy -d tachy \
     -c 'drop index knowledge_embedding_idx, reference_doc_chunks_embedding_idx,
                    code_blob_chunks_embedding_idx, bucket_doc_chunks_embedding_idx'
   $C run --rm cli npm run sync embed-backfill
   ```

6. Recreate the four indexes. Copy their `create index … using hnsw`
   statements from `db/schema.sql` and run them with `psql` as above. Then
   try a plan as in [schema-change.md](schema-change.md): it must come back
   empty. The admin page compares schema hashes, so it can't show a missing
   index.
7. Switch maintenance off.

Until step 5 ends, search runs on its lexical legs alone.
