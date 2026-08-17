// Runs in each fork before the test file is imported, so that db.ts picks up
// TEST_SCHEMA when @tachy/core first opens its connection.
import { MAX_WORKERS, schemaFor } from "./parallel";

const poolId = Number(process.env.VITEST_POOL_ID);
if (!Number.isInteger(poolId) || poolId < 1 || poolId > MAX_WORKERS)
  throw new Error(
    `expected VITEST_POOL_ID in 1..${MAX_WORKERS} to pick a test schema, got ${process.env.VITEST_POOL_ID}`,
  );

process.env.TEST_SCHEMA = schemaFor(poolId);
