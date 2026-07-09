import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./test/global-setup.ts",
    
    
    
    
    pool: "forks",
    fileParallelism: false,
    testTimeout: 120_000, 
    hookTimeout: 120_000, 
  },
});
