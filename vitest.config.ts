import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { MAX_WORKERS } from "./test/parallel";

export default defineConfig({
  /**
   * Compiles the `.svelte.ts` rune modules and touches nothing else, so one
   * project holds both halves of the suite. Two projects cannot: vitest hands
   * out VITEST_POOL_ID per pool and worker-setup.ts turns it into a schema
   * name, so a second pool puts two files on one schema. A test that needs a
   * DOM asks for one with `@vitest-environment jsdom`.
   */
  plugins: [svelte({ hot: false })],

  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: "./test/global-setup.ts",
    setupFiles: ["./test/worker-setup.ts"],

    env: {
      DOTENV_CONFIG_PATH: "./test/test.env",
      DOTENV_CONFIG_QUIET: "true",
    },

    pool: "forks",
    fileParallelism: true,
    maxWorkers: MAX_WORKERS,
    testTimeout: 120_000,
    hookTimeout: 120_000,

    coverage: {
      provider: "v8",
      // `text` is the per-file table a failed threshold is read against;
      // `json` is the line-level data scripts/coverage-diff.ts needs.
      reporter: ["text", "text-summary", "html", "json-summary", "json"],
      skipFull: true,
      include: ["packages/*/src/**", "packages/sources/*/src/**"],
      exclude: [
        // Components are held by svelte-check and the browser, not by vitest.
        "**/*.svelte",
        "packages/web/src/main.ts",
        "**/dist/**",
      ],
      // A ratchet, set under what the suite reaches. Raise it when coverage
      // rises; never lower it to make a red build green.
      thresholds: {
        lines: 75,
        statements: 73,
        functions: 72,
        branches: 65,

        // The same ratchet per package. One total lets a well-covered package
        // slide while a thin one hides behind it. Files under a glob still
        // count toward the four totals.
        "packages/core/src/**": {
          lines: 89,
          statements: 87,
          functions: 88,
          branches: 77,
        },
        "packages/contract/src/**": {
          lines: 90,
          statements: 87,
          functions: 83,
          branches: 81,
        },
        "packages/sources/*/src/**": {
          lines: 87,
          statements: 84,
          functions: 87,
          branches: 70,
        },
        "packages/cli/src/**": {
          lines: 85,
          statements: 84,
          functions: 90,
          branches: 69,
        },
        "packages/api/src/**": {
          lines: 74,
          statements: 72,
          functions: 67,
          branches: 61,
        },
        "packages/agent/src/**": {
          lines: 56,
          statements: 57,
          functions: 55,
          branches: 47,
        },
        "packages/web/src/**": {
          lines: 51,
          statements: 50,
          functions: 48,
          branches: 43,
        },
        "packages/mcp/src/**": {
          lines: 69,
          statements: 66,
          functions: 63,
          branches: 53,
        },
      },
    },
  },
});
