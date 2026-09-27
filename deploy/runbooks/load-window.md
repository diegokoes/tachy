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
4. `docker compose -f load/turns.compose.yml down -v`.
5. Write the numbers in DEPLOYMENT-ARCHITECTURE.md §3 with the date and commit.
   If a Claude turn stays under 0.45 GB at p95, raise `agent_slot_cap` to 18.
