# Schema changes

`db/schema.sql` is the only schema source. There are no migration files, and
until a schema diff tool is adopted, `tachy-deploy` refuses any release whose
`schema.sql` differs from the live database's stamp.

## Applying a changed schema (dump, recreate, restore)

Plan a window; drain first ([maintenance.md](maintenance.md)).

```sh
cd /opt/tachy
C="docker compose -f docker-compose.yml -f deploy/compose.prod.yml"
sudo tachy-backup db --restore-test              # a fresh, tested backup
$C stop api caddy
$C exec -T postgres pg_dump -Fc -U tachy -d tachy --data-only \
  --exclude-table-data=generated_outputs > /srv/tachy/backups/pre-schema.dump
git fetch && git checkout --detach <new commit>
$C exec -T postgres psql -U tachy -d postgres -c 'drop database tachy with (force)' \
  -c 'create database tachy'
$C exec -T postgres psql -v ON_ERROR_STOP=1 -U tachy -d tachy -f - < db/schema.sql
$C exec -T postgres pg_restore --data-only --disable-triggers -U tachy -d tachy \
  < /srv/tachy/backups/pre-schema.dump
$C exec -T postgres psql -U tachy -d tachy -f - < db/roles.sql
tachy-deploy stamp
tachy-deploy <new commit>
```

A new NOT NULL column without a default makes the restore fail: give it a
default in `schema.sql`, or ship it in two releases. If the embedding model or
vector dimension changed, run
`$C run --rm cli npm run sync reembed` before reopening.

## Writing a schema change

- **Renames are expand and contract:** add the new column, backfill, move the
  code, drop the old column in a later release. A diff tool sees a rename as a
  drop plus an add.
- **Postgres 16 cannot alter a generated column's expression**; drop and re-add
  it.
- **Every release must run against the previous schema too** if it is to be
  rolled back without a restore.
