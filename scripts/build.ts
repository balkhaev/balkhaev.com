import { cp, mkdir, writeFile } from "node:fs/promises";
import { build } from "bun";
import { LANGS } from "../src/cv/content";
import { CV_PATHS, renderCv } from "../src/cv/render";
import { renderNews } from "../src/news/render";

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
await writeFile("dist/news/index.html", renderNews());
for (const lang of LANGS) {
  const folder = `dist${CV_PATHS[lang]}`;
  // biome-ignore lint/performance/noAwaitInLoops: two small pages
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}index.html`, renderCv(lang));
}
