import { defineConfig } from "vitest/config";
import { MAX_WORKERS } from "./test/parallel";

export default defineConfig({
  test: {
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
  },
});
