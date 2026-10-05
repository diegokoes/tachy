import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { MAX_WORKERS } from "./test/parallel";

export default defineConfig({
  /*
   * The Svelte plugin is here rather than in a project of its own. `.svelte.ts`
   * modules are only valid once the compiler has processed them - a rune in a
   * file Vite does not transform is a reference to a global that is not there -
   * and the plugin touches nothing else, so one project can hold both halves of
   * the suite. Two projects could not: vitest hands out VITEST_POOL_ID per pool,
   * worker-setup.ts turns that id into a schema name, and with a second pool in
   * the run two files ended up on one schema, truncating each other's rows.
   *
   * Tests that need a DOM ask for one per file, with `@vitest-environment jsdom`.
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
      // A ratchet, set just under what the suite reaches today. Raise it when
      // coverage rises; never lower it to make a red build green. Vitest 5
      // started measuring the `.svelte.ts` rune modules, which vitest 4 never
      // reported, so the baseline was reset to include them.
      thresholds: {
        lines: 75,
        statements: 73,
        functions: 72,
        branches: 65,

        // The same ratchet per package. One total lets a well-covered package
        // slide while a thin one hides behind it. Files under a glob still
        // count toward the totals above.
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
