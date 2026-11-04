import { BLOG_LANGS, type BlogLang, type Post, type Series } from "./content";

const ORIGIN = "https://balkhaev.com";

const LABELS: Record<
  BlogLang,
  {
    blog: string;
    contents: string;
    cv: string;
    description: string;
    feed: string;
    kicker: string;
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
    top: string;
    writings: string;
  }
> = {
  en: {
    blog: "Blog",
    contents: "Contents",
    cv: "Resume",
    description:
      "Practical series on AI agents and automations, each taken from the idea to working code in production.",
    empty: "No posts yet.",
    feed: "RSS",
    kicker: "AI agents and automations",
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
    top: "Back to top",
    writings: "All posts",
  },
  ru: {
    blog: "Блог",
    contents: "Содержание",
    cv: "Резюме",
    description:
      "Практические циклы статей про AI-агентов и автоматизации: каждая идея от концепции до рабочего кода в проде.",
    empty: "Постов пока нет.",
    feed: "RSS",
    kicker: "AI-агенты и автоматизации",
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
    top: "Наверх",
    writings: "Все записи",
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

/** "2026-11-04" → "04.11.2026", as on the homepage. */
const shortDate = (date: string) => date.split("-").reverse().join(".");

/** 3 → "03". */
const pad = (count: number) => String(count).padStart(2, "0");

const CV_PATHS: Record<BlogLang, string> = { en: "/cv/", ru: "/cv/ru/" };
const TELEGRAM = "https://t.me/balkhaev";
const NAMES: Record<BlogLang, string> = {
  en: "Mikhail Balkhaev",
  ru: "Михаил Бальхаев",
};

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
  const label = LABELS[lang];
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
    <link href="${feedPath(lang)}" rel="alternate" title="${label.blog} · balkhaev" type="application/atom+xml">
    <meta content="#efece6" name="theme-color">
    <link as="font" crossorigin href="/cv/fonts/plex-cyrillic.woff2" rel="preload" type="font/woff2">
    <link href="/blog/blog.css" rel="stylesheet">${math ? `\n    <link href="${KATEX_PATH}katex.min.css" rel="stylesheet">` : ""}
    <title>${html(title)}</title>
  </head>
  <body id="top">
    <div class="page">
      <header class="topbar">
        <a class="topbar-site" href="/">balkhaev.com</a>
        <a class="topbar-role" href="${blogPath(lang)}">${label.blog} · ${label.kicker}</a>
        <nav aria-label="${label.blog}" class="topbar-nav">
          <a href="${blogPath(lang)}">${label.blog}</a>
          <a href="${CV_PATHS[lang]}">${label.cv}</a>
          <a href="${TELEGRAM}" rel="noopener noreferrer" target="_blank">Telegram</a>
          <span aria-label="${label.switcher}" class="langs" role="group">${switcher}</span>
        </nav>
      </header>
      <main>
${body}
      </main>
      <footer class="site-foot">
        <span>© 2026 ${NAMES[lang]}</span>
        <a href="${feedPath(lang)}">${label.feed}</a>
        <a href="#top">${label.top} <span aria-hidden="true">↑</span></a>
      </footer>
    </div>
  </body>
</html>
`;
}

const seriesOf = (post: Post, series: Series[]) =>
  series.find((item) => item.id === post.series && item.lang === post.lang);

/** Mono line under a title: date, reading time and tags. */
const meta = (post: Post) =>
  `<p class="meta"><time datetime="${post.date}">${formatDate(post.date, post.lang)}</time><span>${LABELS[post.lang].minutes(post.minutes)}</span>${post.tags.map((tag) => `<span class="tag">${html(tag)}</span>`).join("")}</p>`;

/** Published posts of a series in one language, by part. */
const partsOf = (series: Series, posts: Post[]) =>
  posts
    .filter((post) => post.series === series.id && post.lang === series.lang)
    .sort((a, b) => (a.part ?? 0) - (b.part ?? 0));

/** One segment per planned part, filled for the published ones. */
function progress(series: Series, posts: Post[]) {
  const out = new Set(partsOf(series, posts).map((post) => post.part));
  const cells = series.plan
    .map((_, index) => `<i${out.has(index + 1) ? ' class="on"' : ""}></i>`)
    .join("");
  return `<span aria-hidden="true" class="progress">${cells}</span>`;
}

/** The whole plan of a series: published parts link, the rest say so. */
function partList(series: Series, posts: Post[], current?: Post) {
  const published = partsOf(series, posts);
  const items = series.plan.map((title, index) => {
    const number = `<span class="part-no">${pad(index + 1)}</span>`;
    const post = published.find((item) => item.part === index + 1);
    if (!post) {
      return `<li class="soon">${number}<span>${html(title)}</span> <em>${LABELS[series.lang].soon}</em></li>`;
    }
    const current_ = post === current ? ' aria-current="page"' : "";
    return `<li><a${current_} href="${blogPath(post.lang, post.slug)}">${number}<span>${html(post.title)}</span></a></li>`;
  });
  return `<ol class="parts">${items.join("")}</ol>`;
}

const MIN_TOC = 3;

const contents = (post: Post) =>
  post.toc.length < MIN_TOC
    ? ""
    : `<nav aria-label="${LABELS[post.lang].contents}" class="toc side-block">
            <h2 class="label">${LABELS[post.lang].contents}</h2>
            <ol>${post.toc.map(({ depth, id, text }) => `<li class="toc-item d${depth}"><a class="toc-link" href="#${html(id)}">${html(text)}</a></li>`).join("")}</ol>
          </nav>`;

/** The sidebar of a post: its series plan, then its table of contents. */
function sidebar(post: Post, own: Series | undefined, posts: Post[]) {
  const label = LABELS[post.lang];
  const plan = own
    ? `<nav aria-label="${html(own.title)}" class="side-block side-series">
            <h2 class="label"><a href="${seriesPath(post.lang, own.id)}">${label.seriesOne}</a><span>${label.part(post.part ?? 0, own.plan.length)}</span></h2>
            ${partList(own, posts, post)}
          </nav>`
    : "";
  const toc = contents(post);
  return plan || toc ? `<aside class="post-side">${plan}${toc}</aside>` : "";
}

/** On narrow screens the plan folds into one line above the text. */
function seriesBox(post: Post, own: Series | undefined, posts: Post[]) {
  if (!own) {
    return "";
  }
  const label = LABELS[post.lang];
  return `<details class="series-box">
            <summary><span>${html(own.title)}</span><span class="series-box-part">${label.part(post.part ?? 0, own.plan.length)}</span></summary>
            ${partList(own, posts, post)}
          </details>`;
}

function pager(post: Post, own: Series | undefined, posts: Post[]) {
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
      ? `<a class="pager-link ${rel}" href="${blogPath(item.lang, item.slug)}" rel="${rel}"><span class="pager-label">${rel === "prev" ? "← " : ""}${label[rel]}${rel === "next" ? " →" : ""}</span><span class="pager-title">${html(item.title)}</span></a>`
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
  const label = LABELS[series.lang];
  const count = partsOf(series, posts).length;
  return layout({
    body: `        <article class="series-page">
          <header class="post-head">
            <p class="kicker"><a href="${blogPath(series.lang)}">${label.blog}</a><span>${label.seriesOne}</span></p>
            <h1>${html(series.title)}</h1>
            <p class="post-desc">${html(series.description)}</p>
            <p class="meta"><span>${label.published(count, series.plan.length)}</span>${progress(series, posts)}</p>
          </header>
          <div class="post-grid">
            <section class="post-side side-block">
              <h2 class="label"><span>${label.parts}</span><span>${pad(count)} / ${pad(series.plan.length)}</span></h2>
              ${partList(series, posts)}
            </section>
            <div class="post-body prose">
${series.html}
            </div>
          </div>
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
  const label = LABELS[lang];
  const own = posts.filter((post) => post.lang === lang);
  const cycles = series.filter((item) => item.lang === lang);
  const shelf = cycles.length
    ? `<section aria-labelledby="series-title" class="block">
          <h2 class="label" id="series-title"><span>01 ${label.series}</span><span>${pad(cycles.length)}</span></h2>
          <div class="cycles">${cycles
            .map(
              (item, index) => `
            <a class="cycle" href="${seriesPath(lang, item.id)}">
              <span class="cycle-no">${pad(index + 1)}</span>
              <strong>${html(item.title)}</strong>
              <span class="cycle-desc">${html(item.description)}</span>
              <span class="cycle-foot"><span>${label.published(partsOf(item, posts).length, item.plan.length)}</span>${progress(item, posts)}</span>
            </a>`
            )
            .join("")}
          </div>
        </section>`
    : "";
  const items = own.length
    ? `<ol class="rows">${own
        .map((post) => {
          const cycle = seriesOf(post, series);
          const kicker = cycle
            ? `<span class="row-kicker">${html(cycle.title)} · ${label.part(post.part ?? 0, cycle.plan.length)}</span>`
            : "";
          return `
            <li>
              <a class="row post-row" href="${blogPath(lang, post.slug)}">
                <span class="row-main">${kicker}<span class="row-title">${html(post.title)}</span><span class="row-sub">${html(post.description)}</span></span>
                <span class="row-meta"><time datetime="${post.date}">${shortDate(post.date)}</time><span>${label.minutes(post.minutes)}</span></span>
              </a>
            </li>`;
        })
        .join("")}
          </ol>`
    : `<p class="empty">${label.empty}</p>`;
  return layout({
    body: `        <section class="masthead">
          <h1>${label.blog}<span aria-hidden="true" class="stop"></span></h1>
        </section>
        <section class="lead">
          <p>${label.description}</p>
          <p class="lead-actions"><a class="pill" href="${feedPath(lang)}">${label.feed} <span aria-hidden="true">↗</span></a></p>
        </section>
        ${shelf}
        <section aria-labelledby="posts-title" class="block">
          <h2 class="label" id="posts-title"><span>${cycles.length ? "02" : "01"} ${label.writings}</span><span>${pad(own.length)}</span></h2>
          ${items}
        </section>`,
    description: label.description,
    lang,
    paths: Object.fromEntries(BLOG_LANGS.map((code) => [code, blogPath(code)])),
    title: `${label.blog} · balkhaev`,
    type: "website",
  });
}

/** One post; `posts` is used to link the same slug in the other language. */
export function renderPost(post: Post, posts: Post[], series: Series[] = []) {
  const paths: Partial<Record<BlogLang, string>> = {};
  for (const other of posts) {
    if (other.slug === post.slug) {
      paths[other.lang] = blogPath(other.lang, other.slug);
    }
  }
  const label = LABELS[post.lang];
  const own = seriesOf(post, series);
  const kicker = own
    ? `<a href="${seriesPath(post.lang, own.id)}">${html(own.title)}</a><span>${label.part(post.part ?? 0, own.plan.length)}</span>`
    : `<a href="${blogPath(post.lang)}">${label.blog}</a>`;
  return layout({
    body: `        <article>
          <header class="post-head">
            <p class="kicker">${kicker}</p>
            <h1>${html(post.title)}</h1>
            <p class="post-desc">${html(post.description)}</p>
            ${meta(post)}
          </header>
          <div class="post-grid">
            ${sidebar(post, own, posts)}
            <div class="post-body">
              ${seriesBox(post, own, posts)}
              <div class="prose">
${post.html}
              </div>
              ${pager(post, own, posts)}
            </div>
          </div>
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
