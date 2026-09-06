import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { MAX_WORKERS } from "./test/parallel";

export default defineConfig({
  /*
   * The Svelte plugin is here rather than in a project of its own. `.svelte.ts`
   * modules are only valid once the compiler has processed them — a rune in a
   * file Vite does not transform is a reference to a global that is not there —
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
      reporter: ["text-summary", "html", "json-summary"],
      include: ["packages/*/src/**", "packages/sources/*/src/**"],
      exclude: [
        // Components are held by svelte-check and the browser, not by vitest.
        "**/*.svelte",
        "packages/web/src/main.ts",
        "**/dist/**",
      ],
      // A ratchet, set just under what the suite reaches today. Raise it when
      // coverage rises; never lower it to make a red build green.
      thresholds: {
        lines: 76,
        statements: 74,
        functions: 74,
        branches: 63,
      },
    },
  },
});
