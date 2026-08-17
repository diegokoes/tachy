/**
 * Test files run concurrently, one fork per pool slot, each against its own
 * Postgres schema so that `resetData()` in one file cannot truncate another's
 * rows. Vitest guarantees `VITEST_POOL_ID` is 1..maxWorkers with a single live
 * fork per slot, so the slot id doubles as the schema id.
 */
export const MAX_WORKERS = 8;

export const schemaFor = (poolId: number) => `test_${poolId}`;
