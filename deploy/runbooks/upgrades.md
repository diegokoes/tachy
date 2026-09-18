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

Vectors from two models share no space. In one release: change
`TACHY_EMBED_MODEL` (and the `vector(N)` columns plus `EMBEDDING_DIM` if the
dimension changes), then apply the schema as in
[schema-change.md](schema-change.md) and run
`docker compose run --rm cli npm run sync reembed` before reopening. Search is
wrong, not just slow, until it finishes.
