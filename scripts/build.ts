import { cp, mkdir, writeFile } from "node:fs/promises";
import { build } from "bun";
import { BLOG_LANGS, loadPosts } from "../src/blog/content";
import {
  blogPath,
  blogUrls,
  renderIndex,
  renderPost,
} from "../src/blog/render";
import { LANGS } from "../src/cv/content";
import { CV_PATHS, renderCv } from "../src/cv/render";

const ORIGIN = "https://balkhaev.com";

async function page(path: string, content: string) {
  const folder = `dist${path}`;
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}index.html`, content);
}

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

const pages = new Map<string, string>();
for (const lang of LANGS) {
  pages.set(CV_PATHS[lang], renderCv(lang));
}
const posts = await loadPosts(
  "content/blog",
  process.argv.includes("--drafts")
);
for (const lang of BLOG_LANGS) {
  pages.set(blogPath(lang), renderIndex(lang, posts));
}
for (const post of posts) {
  pages.set(blogPath(post.lang, post.slug), renderPost(post, posts));
}
await Promise.all([...pages].map(([path, content]) => page(path, content)));

const urls = ["/", ...Object.values(CV_PATHS), ...blogUrls(posts)];
await writeFile(
  "dist/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${ORIGIN}${url}</loc></url>`).join("")}</urlset>
`
);
