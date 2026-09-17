// Bundles the MCP server to plain JavaScript. Every turn spawns one, and under
// tsx each child paid for transpiling @tachy/core at start: twice the memory and
// twice the start time (DEPLOYMENT-ARCHITECTURE.md §3.1). Workspace packages are
// bundled because they ship as TypeScript; everything from npm stays external
// and resolves from node_modules as usual.
import { build } from "esbuild";

await build({
  entryPoints: ["packages/mcp/src/index.ts"],
  outfile: "packages/mcp/dist/mcp.js",
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
