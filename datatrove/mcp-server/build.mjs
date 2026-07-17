import { build } from "esbuild";
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/index.js",
  banner: { js: "// Datatrove MCP server — bundled artifact. Edit src/ then run `npm run build`." },
});
console.log("built dist/index.js");
