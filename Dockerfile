FROM node:24.21.0-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS base

# postgresql-client-16: needed by `npm run sync backup`/`restore`
# (pg_dump/pg_restore). Debian bookworm's own repo only has client v15, and
# pg_dump refuses to talk to a newer server, so pull the matching v16 client
# from the PGDG apt repo instead.
# git: spawned by the code-consultation indexer (clone/fetch/ls-tree/show).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates postgresql-common git \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# node:24-slim ships npm 11.x. Pin the version explicitly so the image does not
# drift with the base image, and so it matches what the lockfile is maintained
# with locally.
RUN npm i -g npm@12.0.2

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
# Ahead of `COPY . .` and given only the two files it reads, so an ordinary
# source change reuses the download instead of refetching it from HuggingFace.
ENV TACHY_MODEL_CACHE=/app/.model-cache
COPY packages/core/src/search/model.ts packages/core/src/search/model.ts
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

COPY --from=build /app/.model-cache /app/.model-cache
COPY --from=build /app/dist /app/dist
COPY --from=build /app/packages/web/dist /app/packages/web/dist
COPY packages/agent/prompt.md packages/agent/prompt.md
COPY db db

# `npm run api` / `npm run sync …` keep working inside the image, against the
# bundles; a source checkout keeps its tsx scripts.
RUN npm pkg set scripts.api="node dist/api.js" scripts.sync="node dist/cli.js" scripts.mcp="node dist/mcp.js" scripts.worker="node dist/worker.js"

ENV TACHY_MODEL_CACHE=/app/.model-cache
ENV TACHY_MCP_ARGS=dist/mcp.js

# Linked-repo clones for code search live here — mount a volume to keep them
# across redeploys (otherwise the first reindex re-clones, which is fine too).
ENV TACHY_REPO_DIR=/app/data/repos
# Chat uploads, one subdirectory per user, swept after TACHY_UPLOAD_TTL_HOURS.
# On the data volume so a redeploy does not lose a file a chat just attached.
ENV TACHY_UPLOAD_DIR=/app/data/uploads
ENV TACHY_AGENT_HOME=/home/node/.claude

# node:24-slim already carries an unprivileged `node` (uid 1000). Everything the
# server writes at runtime is created and handed over here, because Docker only
# chowns a named volume it creates itself — an existing one keeps the ownership
# it was populated with. See README > Operations for the one-time chown an
# already-running deployment needs.
RUN mkdir -p /app/data/repos /app/data/uploads /app/backups /home/node/.claude \
 && chown -R node:node /app/data /app/backups /home/node/.claude

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:8787/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ARG TACHY_COMMIT
ENV TACHY_COMMIT=$TACHY_COMMIT

# node directly, not `npm run api`: SIGTERM has to reach the server's drain.
CMD ["node", "dist/api.js"]
