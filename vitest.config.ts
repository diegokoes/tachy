import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./test/global-setup.ts",
    // All suites share the one container DB seeded by globalSetup. Run files
    // sequentially (each isolated in its own fork) so they don't clobber each
    // other's data and so each can close its own pg pool in afterAll. The fork
    // inherits DATABASE_URL that globalSetup set before it was spawned.
    pool: "forks",
    fileParallelism: false,
    testTimeout: 120_000, // first run downloads the ~90MB embedding model
    hookTimeout: 120_000, // first run pulls the postgres image
  },
});
