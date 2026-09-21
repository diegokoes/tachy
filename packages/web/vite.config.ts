import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// DEV:
//   npm run api      (API on :8787)
//   npm run web:dev  (Vite on :5173))
//
// PROD:
//   npm run web:build  (builds packages/web/dist)
//   npm run api         (API on :8787, serves dist/ directly)
// TACHY_DEV_API points the proxy at an API other than the default, for working
// against a throwaway instance rather than whatever holds :8787.
const api = process.env.TACHY_DEV_API ?? "http://localhost:8787";

export default defineConfig({
  plugins: [svelte()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": api,
      "/auth": api,
      "/health": api,
    },
  },
});
