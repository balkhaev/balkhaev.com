import { cp, mkdir } from "node:fs/promises";
import { build } from "bun";

await mkdir("dist", { recursive: true });
const result = await build({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  entrypoints: ["src/main.ts"],
  minify: true,
  naming: "app.js",
  outdir: "dist",
  target: "browser",
});
if (!result.success) {
  throw new AggregateError(result.logs, "Browser build failed");
}
await cp("public", "dist", { recursive: true });
await cp("index.html", "dist/index.html");
