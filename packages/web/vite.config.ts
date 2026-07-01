import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// The SPA is built to dist/ and served by the Hono API in production (one origin).
// In dev, Vite runs on :5173 and proxies /api and /auth to the API on :8787, so
// the browser sees a single origin here too (no CORS).
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
