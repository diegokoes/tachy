// Bundles every server entry point to plain JavaScript in dist/, so the image
// runs node without tsx or devDependencies: the api, the CLI, the job worker, the MCP server
// each chat turn spawns, and the embedding worker thread the api starts.
// Workspace packages are bundled because they ship as TypeScript; everything
// from npm stays external and resolves from node_modules as usual.
import { build } from "esbuild";

await build({
  entryPoints: {
    api: "packages/api/src/index.ts",
    cli: "packages/cli/src/index.ts",
    worker: "packages/worker/src/index.ts",
    mcp: "packages/mcp/src/index.ts",
    embedder: "packages/api/src/embedder.ts",
    "embed-thread": "packages/core/src/search/embed-thread.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  logLevel: "warning",
  plugins: [
    {
      name: "external-npm",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith("@tachy/")
            ? undefined
            : { path: args.path, external: true },
        );
      },
    },
  ],
});
