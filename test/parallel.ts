import { availableParallelism } from "node:os";

/**
 * Test files run concurrently, one fork per pool slot, each against its own
 * Postgres schema so that `resetData()` in one file cannot truncate another's
 * rows. Vitest guarantees `VITEST_POOL_ID` is 1..maxWorkers with a single live
 * fork per slot, so the slot id doubles as the schema id.
 *
 * Derived rather than fixed at 8: every fork that touches knowledge or
 * reference loads its own copy of the 417 MB embedding model, so eight of them
 * on a two-core CI runner is memory pressure buying no parallelism. The cap
 * keeps a large workstation from opening more schemas than the load is worth.
 */
export const MAX_WORKERS = Math.max(2, Math.min(8, availableParallelism() - 1));

export const schemaFor = (poolId: number) => `test_${poolId}`;
