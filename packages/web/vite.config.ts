import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// DEV:
//   npm run api      (API on :8787)
//   npm run web:dev  (Vite on :5173))
//
// PROD:
//   npm run web:build  (builds packages/web/dist)
//   npm run api         (API on :8787, serves dist/ directly)
export default defineConfig({
  plugins: [svelte()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
      "/health": "http://localhost:8787",
    },
  },
});
