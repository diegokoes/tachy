# A load window

Laptop numbers (per-turn memory, the slot cap, search latency) can only be
measured on the laptop, and never while people use it: weekdays 19:00–07:00 or
weekends.

1. Restore the newest dump into the load stack's Postgres:
   ```sh
   cd /opt/tachy
   docker compose -f load/turns.compose.yml up -d pg-load mock-llm
   age -d -i team.key /srv/tachy/backup-export/<newest db>.age |
     docker compose -f load/turns.compose.yml exec -T pg-load pg_restore --no-owner -U tachy -d tachy --clean --if-exists
   TACHY_IMAGE=<the running digest> docker compose -f load/turns.compose.yml up -d api-load
   ```
2. Turns: `docker compose -f load/turns.compose.yml exec api-load node load/turns.mjs`
   (`LEVELS=1,5,10,15`). It reports memory per turn from api-load's cgroup.
3. Search: run `smoke.js` and `search.js` against `http://api-load:8787` on the
   `tachy-load` network with k6.
4. The embedding model. The load stack has no embedder, so this times the
   production one, which nobody uses in the window. The runtime image has no
   tsx, so the script runs from the image's build stage, at the running
   commit, on the stack's network:
   ```sh
   C="docker compose -f docker-compose.yml -f deploy/compose.prod.yml"
   docker build --target build -t tachy-bench .
   SECRET=$(grep '^TACHY_INTERNAL_SECRET=' .env | cut -d= -f2-)
   bench() {
     docker run --rm --network tachy -e TACHY_INTERNAL_SECRET="$SECRET" \
       -e TACHY_EMBED_URL=http://embedder:8790/internal/embed \
       tachy-bench npx tsx scripts/bench-embedder.ts "$@"
   }
   bench
   bench --heaviest
   $C exec -T embedder cat /sys/fs/cgroup/memory.peak
   $C restart embedder
   ```
   A host that sets `TACHY_EMBED_MODEL` passes it to `bench` too. The peak plus
   800 MiB is what `TACHY_EMBEDDER_MEM_LIMIT` needs (§3.2). The restart drops
   the arena the heaviest round grew.
5. `docker compose -f load/turns.compose.yml down -v`.
6. Write the numbers in DEPLOYMENT-ARCHITECTURE.md §3 with the date and commit.
   If a Claude turn stays under 0.35 GB at p95, raise `agent_slot_cap` to 15
   (§3.2).
