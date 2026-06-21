# pgvector/pgvector:pg16 only installs the bare postgresql-16 apt package --
# not postgresql-contrib-16, which is what actually ships pg_trgm and
# pgcrypto. Without this, schema.sql's `create extension if not exists
# pg_trgm;` fails on first container start.
FROM pgvector/pgvector:pg16
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-contrib-16 \
 && rm -rf /var/lib/apt/lists/*
