-- Least-privilege roles, applied after schema.sql and again on every deploy.
-- Idempotent, because roles are cluster-wide and outlive any one schema apply.
-- Grants cover the current schema. Passwords are never set here;
-- deploy/postgres/role-passwords.sh sets them from the environment.

do $$ begin
    create role tachy_app nologin;
exception when duplicate_object then null;
end $$;

do $$ begin
    create role tachy_backup nologin;
exception when duplicate_object then null;
end $$;

alter role tachy_app set statement_timeout = '60s';

do $$
declare s text := current_schema();
begin
    execute format('grant usage on schema %I to tachy_app', s);
    execute format('grant select, insert, update, delete on all tables in schema %I to tachy_app', s);
    execute format('grant usage, select, update on all sequences in schema %I to tachy_app', s);
    execute format('grant execute on all functions in schema %I to tachy_app', s);
    execute format('alter default privileges in schema %I grant select, insert, update, delete on tables to tachy_app', s);
    execute format('alter default privileges in schema %I grant usage, select, update on sequences to tachy_app', s);
    execute format('alter default privileges in schema %I grant execute on functions to tachy_app', s);
end $$;

grant pg_read_all_data to tachy_backup;
-- Admin > System counts connections per process from pg_stat_activity.
grant pg_read_all_stats to tachy_app;
