FROM node:26.10.0-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS base

# postgresql-client-16: `npm run sync backup`/`restore` run pg_dump/pg_restore.
# From the PGDG apt repo, so the client's major matches the server's
# (docker-compose.yml); the base image's own repo carries another.
# git: spawned by the code-consultation indexer (clone/fetch/ls-tree/show).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates postgresql-common git \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pinned so the image's npm does not drift with the base image, and matches
# what the lockfile is maintained with locally.
RUN npm i -g npm@12.0.2

# k6, for the load runs an admin starts from the tests page (§11.3).
FROM grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34 AS k6

# The schema diff tool tachy-deploy runs from the new image (§5.10).
FROM golang:1.27@sha256:e432b43af23a9328d56a7c499be0476810aa344acbcf65fc7c455d4ff5a40602 AS schema-diff
RUN CGO_ENABLED=0 go install github.com/stripe/pg-schema-diff/cmd/pg-schema-diff@v1.0.9

# Build stage: devDependencies, the model download, the SPA and the bundles.
FROM base AS build

# The package.jsons alone first, so `npm ci` is cached unless a dependency changed.
COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/sources/freshdesk/package.json packages/sources/freshdesk/package.json
COPY packages/sources/github/package.json packages/sources/github/package.json
COPY packages/sources/azure-devops/package.json packages/sources/azure-devops/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/worker/package.json packages/worker/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

# Pre-download the embedding model at build time so a freshly pulled container
# doesn't need network access (or a multi-second stall) on its first embed.
# Ahead of `COPY . .` and given only the files it reads, so an ordinary
# source change reuses the download instead of refetching it from HuggingFace.
ENV TACHY_MODEL_CACHE=/app/.model-cache
COPY packages/core/src/search/model.ts packages/core/src/search/threads.ts packages/core/src/search/
COPY scripts/warmup-embeddings.ts scripts/warmup-embeddings.ts
RUN npx tsx scripts/warmup-embeddings.ts

COPY . .

# The environment badge is not baked into the SPA: the API reads
# TACHY_ENV_BADGE at runtime, so the same image serves dev and production.
RUN npm run web:build \
 && npm run build:server

# Runtime stage: production dependencies, the bundles, and the three files the
# server reads from disk. No TypeScript, no tsx, no test tooling.
FROM base AS runtime

COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/sources/freshdesk/package.json packages/sources/freshdesk/package.json
COPY packages/sources/github/package.json packages/sources/github/package.json
COPY packages/sources/azure-devops/package.json packages/sources/azure-devops/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/worker/package.json packages/worker/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci --omit=dev \
 && npm cache clean --force

COPY --from=schema-diff /go/bin/pg-schema-diff /usr/local/bin/pg-schema-diff
COPY --from=k6 /usr/bin/k6 /usr/local/bin/k6
COPY --from=build /app/.model-cache /app/.model-cache
COPY --from=build /app/dist /app/dist
COPY --from=build /app/packages/web/dist /app/packages/web/dist
COPY packages/agent/prompt.md packages/agent/prompt.md
COPY load load
COPY db db

# `npm run api` / `npm run sync …` keep working inside the image, against the
# bundles; a source checkout keeps its tsx scripts.
RUN npm pkg set scripts.api="node dist/api.js" scripts.sync="node dist/cli.js" scripts.mcp="node dist/mcp.js" scripts.worker="node dist/worker.js"

ENV TACHY_MODEL_CACHE=/app/.model-cache
ENV TACHY_MCP_ARGS=dist/mcp.js

# Linked-repo clones for code search live here - mount a volume to keep them
# across redeploys; without one the first reindex re-clones.
ENV TACHY_REPO_DIR=/app/data/repos
ENV TACHY_AGENT_HOME=/home/node/.claude

# The base image already carries an unprivileged `node` (uid 1000). Everything the
# server writes at runtime is created and handed over here, because Docker only
# chowns a named volume it creates itself - an existing one keeps the ownership
# it was populated with.
RUN mkdir -p /app/data/repos /app/backups /home/node/.claude \
 && chown -R node:node /app/data /app/backups /home/node/.claude

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:8787/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ARG TACHY_COMMIT
ENV TACHY_COMMIT=$TACHY_COMMIT

# node directly, not `npm run api`: SIGTERM has to reach the server's drain.
CMD ["node", "dist/api.js"]
