import { BLOG_LANGS, type BlogLang, type Post, type Series } from "./content";

const ORIGIN = "https://balkhaev.com";

const LABELS: Record<
  BlogLang,
  {
    blog: string;
    contents: string;
    description: string;
    empty: string;
    minutes: (count: number) => string;
    next: string;
    part: (part: number, total: number) => string;
    parts: string;
    prev: string;
    published: (count: number, total: number) => string;
    series: string;
    seriesOne: string;
    soon: string;
    switcher: string;
  }
> = {
  en: {
    blog: "Blog",
    contents: "Contents",
    description: "Notes on machine learning by Mikhail Balkhaev.",
    empty: "No posts yet.",
    minutes: (count) => `${count} min read`,
    next: "Next",
    part: (part, total) => `part ${part} of ${total}`,
    parts: "All parts",
    prev: "Previous",
    published: (count, total) => `${count} of ${total} parts out`,
    series: "Series",
    seriesOne: "Series",
    soon: "coming soon",
    switcher: "Language",
  },
  ru: {
    blog: "Блог",
    contents: "Содержание",
    description: "Заметки о машинном обучении. Михаил Балхаев.",
    empty: "Постов пока нет.",
    minutes: (count) => `${count} мин чтения`,
    next: "Дальше",
    part: (part, total) => `часть ${part} из ${total}`,
    parts: "Все части",
    prev: "Назад",
    published: (count, total) => `вышло ${count} из ${total} частей`,
    series: "Серии",
    seriesOne: "Серия",
    soon: "скоро",
    switcher: "Язык",
  },
};

const ENTITIES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
const html = (text: string) =>
  text.replace(/[&<>"]/g, (char) => ENTITIES[char] ?? char);

export const blogPath = (lang: BlogLang, slug?: string) =>
  `/blog/${lang === "en" ? "" : `${lang}/`}${slug ? `${slug}/` : ""}`;

export const seriesPath = (lang: BlogLang, id: string) =>
  blogPath(lang, `series/${id}`);

export const feedPath = (lang: BlogLang) => `${blogPath(lang)}atom.xml`;

/** Folder the build copies KaTeX's stylesheet and fonts into. */
export const KATEX_PATH = "/blog/katex/";

const formatDate = (date: string, lang: BlogLang) =>
  new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`)
  );

interface Page {
  body: string;
  description: string;
  lang: BlogLang;
  math?: boolean;
  /** Path of this page in every language it exists in. */
  paths: Partial<Record<BlogLang, string>>;
  title: string;
  type: "article" | "website";
}

function layout({ body, description, lang, math, paths, title, type }: Page) {
  const path = paths[lang] ?? blogPath(lang);
  const alternates = BLOG_LANGS.flatMap((code) => {
    const href = paths[code];
    return href
      ? [`<link href="${ORIGIN}${href}" hreflang="${code}" rel="alternate">`]
      : [];
  }).join("\n    ");
  const switcher = BLOG_LANGS.map((code) => {
    const href = paths[code] ?? blogPath(code);
    return code === lang
      ? `<a aria-current="page" href="${href}">${code.toUpperCase()}</a>`
      : `<a href="${href}" hreflang="${code}" lang="${code}">${code.toUpperCase()}</a>`;
  }).join("");
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8">
    <meta content="width=device-width, initial-scale=1" name="viewport">
    <meta content="${html(description)}" name="description">
    <meta content="${html(title)}" property="og:title">
    <meta content="${html(description)}" property="og:description">
    <meta content="${ORIGIN}${path}" property="og:url">
    <meta content="${type}" property="og:type">
    <link href="${ORIGIN}${path}" rel="canonical">
    ${alternates}
    <link href="/icon.svg" rel="icon" type="image/svg+xml">
    <link href="${feedPath(lang)}" rel="alternate" title="${LABELS[lang].blog} · balkhaev" type="application/atom+xml">
    <link href="/blog/blog.css" rel="stylesheet">${math ? `\n    <link href="${KATEX_PATH}katex.min.css" rel="stylesheet">` : ""}
    <title>${html(title)}</title>
  </head>
  <body>
    <nav class="bar">
      <a class="home" href="/">balkhaev<span aria-hidden="true">.</span></a>
      <a href="${blogPath(lang)}">${LABELS[lang].blog}</a>
      <span aria-label="${LABELS[lang].switcher}" class="langs" role="group">${switcher}</span>
    </nav>
    <main>
${body}
    </main>
  </body>
</html>
`;
}

const seriesOf = (post: Post, series: Series[]) =>
  series.find((item) => item.id === post.series && item.lang === post.lang);

const meta = (post: Post, series: Series[] = []) => {
  const own = seriesOf(post, series);
  const badge = own
    ? `<a class="series-tag" href="${seriesPath(post.lang, own.id)}">${html(own.title)} · ${LABELS[post.lang].part(post.part ?? 0, own.plan.length)}</a>`
    : "";
  return `<p class="meta"><time datetime="${post.date}">${formatDate(post.date, post.lang)}</time><span>${LABELS[post.lang].minutes(post.minutes)}</span>${badge}${post.tags.map((tag) => `<span class="tag">${html(tag)}</span>`).join("")}</p>`;
};

/** Published posts of a series in one language, by part. */
const partsOf = (series: Series, posts: Post[]) =>
  posts
    .filter((post) => post.series === series.id && post.lang === series.lang)
    .sort((a, b) => (a.part ?? 0) - (b.part ?? 0));

/** The whole plan of a series: published parts link, the rest say so. */
function partList(series: Series, posts: Post[], current?: Post) {
  const published = partsOf(series, posts);
  const items = series.plan.map((title, index) => {
    const post = published.find((item) => item.part === index + 1);
    if (!post) {
      return `<li class="soon"><span>${html(title)}</span> <em>${LABELS[series.lang].soon}</em></li>`;
    }
    return post === current
      ? `<li><a aria-current="page" href="${blogPath(post.lang, post.slug)}">${html(post.title)}</a></li>`
      : `<li><a href="${blogPath(post.lang, post.slug)}">${html(post.title)}</a></li>`;
  });
  return `<ol class="parts">${items.join("")}</ol>`;
}

function seriesBox(post: Post, series: Series[], posts: Post[]) {
  const own = seriesOf(post, series);
  if (!own) {
    return "";
  }
  const label = LABELS[post.lang];
  return `<nav aria-label="${html(own.title)}" class="series-box">
          <p><a href="${seriesPath(post.lang, own.id)}">${html(own.title)}</a>, ${label.part(post.part ?? 0, own.plan.length)}</p>
          <details>
            <summary class="series-toggle">${label.parts}</summary>
            ${partList(own, posts, post)}
          </details>
        </nav>`;
}

function pager(post: Post, series: Series[], posts: Post[]) {
  const own = seriesOf(post, series);
  if (!own) {
    return "";
  }
  const published = partsOf(own, posts);
  const at = published.indexOf(post);
  const prev = published[at - 1];
  const next = published[at + 1];
  if (!(prev || next)) {
    return "";
  }
  const label = LABELS[post.lang];
  const link = (item: Post | undefined, rel: "next" | "prev") =>
    item
      ? `<a class="pager-link ${rel}" href="${blogPath(item.lang, item.slug)}" rel="${rel}"><span class="pager-label">${label[rel]}</span>${html(item.title)}</a>`
      : "<span></span>";
  return `<nav class="pager">${link(prev, "prev")}${link(next, "next")}</nav>`;
}

/** A series page: introduction and the whole plan. */
export function renderSeries(series: Series, posts: Post[], all: Series[]) {
  const paths: Partial<Record<BlogLang, string>> = {};
  for (const other of all) {
    if (other.id === series.id) {
      paths[other.lang] = seriesPath(other.lang, other.id);
    }
  }
  const count = partsOf(series, posts).length;
  return layout({
    body: `      <article>
        <header>
          <h1>${html(series.title)}</h1>
          <p class="meta"><span>${LABELS[series.lang].published(count, series.plan.length)}</span></p>
        </header>
        <div class="prose">
${series.html}
        </div>
        ${partList(series, posts)}
      </article>`,
    description: series.description,
    lang: series.lang,
    paths,
    title: `${series.title} · balkhaev`,
    type: "website",
  });
}

/** The list of posts in one language, newest first. */
export function renderIndex(
  lang: BlogLang,
  posts: Post[],
  series: Series[] = []
) {
  const own = posts.filter((post) => post.lang === lang);
  const cycles = series.filter((item) => item.lang === lang);
  const shelf = cycles.length
    ? `<section class="shelf" aria-label="${LABELS[lang].series}">${cycles
        .map(
          (item) => `
        <a class="cycle" href="${seriesPath(lang, item.id)}">
          <span class="cycle-label">${LABELS[lang].seriesOne}</span>
          <strong>${html(item.title)}</strong>
          <span>${html(item.description)}</span>
          <span class="cycle-count">${LABELS[lang].published(partsOf(item, posts).length, item.plan.length)}</span>
        </a>`
        )
        .join("")}
      </section>`
    : "";
  const items = own.length
    ? `<ol class="posts">${own
        .map(
          (post) => `
        <li>
          <h2><a href="${blogPath(lang, post.slug)}">${html(post.title)}</a></h2>
          <p>${html(post.description)}</p>
          ${meta(post, series)}
        </li>`
        )
        .join("")}
      </ol>`
    : `<p>${LABELS[lang].empty}</p>`;
  return layout({
    body: `      <header class="intro">
        <h1>${LABELS[lang].blog}</h1>
        <p>${LABELS[lang].description}</p>
      </header>
      ${shelf}
      ${items}`,
    description: LABELS[lang].description,
    lang,
    paths: Object.fromEntries(BLOG_LANGS.map((code) => [code, blogPath(code)])),
    title: `${LABELS[lang].blog} · balkhaev`,
    type: "website",
  });
}

const MIN_TOC = 3;

const contents = (post: Post) =>
  post.toc.length < MIN_TOC
    ? ""
    : `<nav aria-label="${LABELS[post.lang].contents}" class="toc">
          <p>${LABELS[post.lang].contents}</p>
          <ol>${post.toc.map(({ depth, id, text }) => `<li class="toc-item d${depth}"><a class="toc-link" href="#${html(id)}">${html(text)}</a></li>`).join("")}</ol>
        </nav>`;

/** One post; `posts` is used to link the same slug in the other language. */
export function renderPost(post: Post, posts: Post[], series: Series[] = []) {
  const paths: Partial<Record<BlogLang, string>> = {};
  for (const other of posts) {
    if (other.slug === post.slug) {
      paths[other.lang] = blogPath(other.lang, other.slug);
    }
  }
  return layout({
    body: `      <article>
        <header>
          <h1>${html(post.title)}</h1>
          ${meta(post, series)}
        </header>
        ${seriesBox(post, series, posts)}
        ${contents(post)}
        <div class="prose">
${post.html}
        </div>
        ${pager(post, series, posts)}
      </article>`,
    description: post.description,
    lang: post.lang,
    math: post.math,
    paths,
    title: `${post.title} · balkhaev`,
    type: "article",
  });
}

/** Every blog URL, for the sitemap. */
export const blogUrls = (posts: Post[], series: Series[] = []) => [
  ...BLOG_LANGS.map((lang) => blogPath(lang)),
  ...series.map((item) => seriesPath(item.lang, item.id)),
  ...posts.map((post) => blogPath(post.lang, post.slug)),
];

const xml = html;
const FEED_SIZE = 20;

/** Atom feed of the newest posts in one language, with full content. */
export function renderFeed(lang: BlogLang, posts: Post[]) {
  const own = posts.filter((post) => post.lang === lang).slice(0, FEED_SIZE);
  const updated = own[0]?.date ?? "2026-11-04";
  const entries = own
    .map((post) => {
      const url = `${ORIGIN}${blogPath(lang, post.slug)}`;
      return `
  <entry>
    <title>${xml(post.title)}</title>
    <link href="${url}"/>
    <id>${url}</id>
    <published>${post.date}T00:00:00Z</published>
    <updated>${post.date}T00:00:00Z</updated>
    <summary>${xml(post.description)}</summary>
    <content type="html">${xml(post.html)}</content>
${post.tags.map((tag) => `    <category term="${xml(tag)}"/>`).join("\n")}
  </entry>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xml:lang="${lang}" xmlns="http://www.w3.org/2005/Atom">
  <title>${LABELS[lang].blog} · balkhaev</title>
  <subtitle>${xml(LABELS[lang].description)}</subtitle>
  <link href="${ORIGIN}${blogPath(lang)}"/>
  <link href="${ORIGIN}${feedPath(lang)}" rel="self"/>
  <id>${ORIGIN}${blogPath(lang)}</id>
  <updated>${updated}T00:00:00Z</updated>
  <author><name>Mikhail Balkhaev</name></author>${entries}
</feed>
`;
}
