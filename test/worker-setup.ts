// Runs in each fork before the test file is imported, so that db.ts picks up
// TEST_SCHEMA when @tachy/core first opens its connection.
import { afterAll } from "vitest";
import { MAX_WORKERS, schemaFor } from "./parallel";

const poolId = Number(process.env.VITEST_POOL_ID);
if (!Number.isInteger(poolId) || poolId < 1 || poolId > MAX_WORKERS)
  throw new Error(
    `expected VITEST_POOL_ID in 1..${MAX_WORKERS} to pick a test schema, got ${process.env.VITEST_POOL_ID}`,
  );

process.env.TEST_SCHEMA = schemaFor(poolId);

// ScrollTrigger polls requestAnimationFrame every 250 ms, past jsdom's teardown
// that removes it. Only a registered ScrollTrigger may be disabled, and gsap's
// registry holds the one the test file loaded.
if ("window" in globalThis)
  afterAll(async () => {
    const { gsap } = await import("gsap");
    const registered = (
      gsap.core as unknown as { globals(): Record<string, unknown> }
    ).globals();
    (registered.ScrollTrigger as { disable(): void } | undefined)?.disable();
  });
