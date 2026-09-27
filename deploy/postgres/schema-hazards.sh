# shellcheck shell=bash
# pg-schema-diff hazard types (v1.0.9), split by what they risk here. Shared by
# scripts/schema-plan.sh (CI) and tachy-deploy (the host).

# Cost time, CPU or a short lock; acceptable on a database this size. Grant
# changes are safe too: the target includes db/roles.sql, so a privilege change
# in a plan is one that roles.sql asks for.
SCHEMA_SAFE_HAZARDS=INDEX_BUILD,IMPACTS_DATABASE_PERFORMANCE,ACQUIRES_ACCESS_EXCLUSIVE_LOCK,ACQUIRES_SHARE_LOCK,ACQUIRES_SHARE_ROW_EXCLUSIVE_LOCK,AUTHZ_UPDATE

# Can lose data or change behaviour; need an explicit allow.
SCHEMA_DESTRUCTIVE_HAZARDS=DELETES_DATA,INDEX_DROPPED,CORRECTNESS,HAS_UNTRACKABLE_DEPENDENCIES,UPGRADING_EXTENSION_VERSION,IS_USER_GENERATED

export SCHEMA_SAFE_HAZARDS SCHEMA_DESTRUCTIVE_HAZARDS
