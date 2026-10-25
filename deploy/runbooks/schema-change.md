# Schema changes

`db/schema.sql` is the only schema source. There are no migration files:
`tachy-deploy` diffs the live database against the new release's `schema.sql`
with pg-schema-diff and applies the difference after the pre-deploy backup.

**Reading the plan.** The deploy prints every statement with its hazards before
anything runs. Lock and index-build hazards apply without asking. A plan with
`DELETES_DATA`, `INDEX_DROPPED`, `CORRECTNESS` or the other hazards in
`deploy/postgres/schema-hazards.sh` is refused; read it, then:

```sh
tachy-deploy <commit> --allow-destructive
```

**Trying a plan without deploying:**

```sh
docker run --rm --network tachy --entrypoint sh -e PGPASSWORD=<owner password> <image> -c \
  'mkdir /tmp/t && cp /app/db/schema.sql /tmp/t && pg-schema-diff plan \
   --from-dsn "postgres://tachy@postgres:5432/tachy?sslmode=disable" --to-dir /tmp/t --output-format pretty'
```

## A generated column's expression changed

pg-schema-diff does not compare generation expressions, and Postgres 16 cannot
alter one, so the plan stays empty and an existing database keeps computing the
old value. The schema-plan job warns and names the columns. After the deploy,
rebuild each one in one transaction, exactly as `db/schema.sql` now defines it.
Dropping a column drops its indexes, so they are created again in the same
transaction:

```sh
cd /opt/tachy
C="docker compose -f docker-compose.yml -f deploy/compose.prod.yml"
$C exec -T postgres psql -v ON_ERROR_STOP=1 -U tachy -d tachy -f - <<'SQL'
begin;
alter table <table> drop column <column>;
alter table <table> add column <column> <type>
    generated always as (<the expression in db/schema.sql>) stored;
create index <each index db/schema.sql puts on the column>;
commit;
SQL
```

It has converged when each rebuilt expression names the new field and the
dry-run plan above is empty; a missing index would show there:

```sh
$C exec -T postgres psql -U tachy -d tachy -At -c "select table_name || '.' || column_name || ': ' || generation_expression
  from information_schema.columns where table_schema = 'public' and is_generated = 'ALWAYS' order by 1"
```

## If the diff tool cannot do it: dump, recreate, restore

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
- **Postgres 16 cannot alter a generated column's expression**, and the diff
  does not notice one changed: rebuild it on each existing database as above.
- **Every release must run against the previous schema too** if it is to be
  rolled back without a restore.
