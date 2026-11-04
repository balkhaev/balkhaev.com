import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "bun";
import {
  BLOG_LANGS,
  checkSeries,
  loadPosts,
  loadSeries,
} from "../src/blog/content";
import {
  blogPath,
  blogUrls,
  feedPath,
  KATEX_PATH,
  renderFeed,
  renderIndex,
  renderPost,
  renderSeries,
  seriesPath,
} from "../src/blog/render";
import { LANGS } from "../src/cv/content";
import { CV_PATHS, renderCv } from "../src/cv/render";
import { renderHome } from "../src/home/render";
import { renderNews } from "../src/news/render";

const ORIGIN = "https://balkhaev.com";
const LEGACY_FONT = /\.(?:ttf|woff)$/;

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

const pages = new Map<string, string>();
pages.set("/news/", renderNews());
for (const lang of LANGS) {
  pages.set(CV_PATHS[lang], renderCv(lang));
}
const posts = await loadPosts(
  "content/blog",
  process.argv.includes("--drafts")
);
const series = await loadSeries("content/series");
checkSeries(posts, series);
for (const lang of BLOG_LANGS) {
  pages.set(blogPath(lang), renderIndex(lang, posts, series));
}
for (const item of series) {
  pages.set(seriesPath(item.lang, item.id), renderSeries(item, posts, series));
}
for (const post of posts) {
  pages.set(blogPath(post.lang, post.slug), renderPost(post, posts, series));
}
pages.set("/", renderHome(await readFile("index.html", "utf8"), posts));
await Promise.all([...pages].map(([path, content]) => page(path, content)));
await Promise.all(
  BLOG_LANGS.map((lang) =>
    writeFile(`dist${feedPath(lang)}`, renderFeed(lang, posts))
  )
);

// KaTeX: the stylesheet and woff2 fonts only; every browser we serve has woff2.
const katex = `dist${KATEX_PATH}`;
await mkdir(`${katex}fonts`, { recursive: true });
await cp("node_modules/katex/dist/katex.min.css", `${katex}katex.min.css`);
await cp("node_modules/katex/dist/fonts", `${katex}fonts`, {
  filter: (source) => !LEGACY_FONT.test(source),
  recursive: true,
});

const urls = [
  "/",
  "/news/",
  ...Object.values(CV_PATHS),
  ...blogUrls(posts, series),
];
await writeFile(
  "dist/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${ORIGIN}${url}</loc></url>`).join("")}</urlset>
`
);
