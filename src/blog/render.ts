import { BLOG_LANGS, type BlogLang, type Post } from "./content";

const ORIGIN = "https://balkhaev.com";

const LABELS: Record<
  BlogLang,
  {
    blog: string;
    contents: string;
    description: string;
    empty: string;
    minutes: (count: number) => string;
    switcher: string;
  }
> = {
  en: {
    blog: "Blog",
    contents: "Contents",
    description: "Notes on machine learning by Mikhail Balkhaev.",
    empty: "No posts yet.",
    minutes: (count) => `${count} min read`,
    switcher: "Language",
  },
  ru: {
    blog: "Блог",
    contents: "Содержание",
    description: "Заметки о машинном обучении. Михаил Балхаев.",
    empty: "Постов пока нет.",
    minutes: (count) => `${count} мин чтения`,
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

const meta = (post: Post) =>
  `<p class="meta"><time datetime="${post.date}">${formatDate(post.date, post.lang)}</time><span>${LABELS[post.lang].minutes(post.minutes)}</span>${post.tags.map((tag) => `<span class="tag">${html(tag)}</span>`).join("")}</p>`;

/** The list of posts in one language, newest first. */
export function renderIndex(lang: BlogLang, posts: Post[]) {
  const own = posts.filter((post) => post.lang === lang);
  const items = own.length
    ? `<ol class="posts">${own
        .map(
          (post) => `
        <li>
          <h2><a href="${blogPath(lang, post.slug)}">${html(post.title)}</a></h2>
          <p>${html(post.description)}</p>
          ${meta(post)}
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
export function renderPost(post: Post, posts: Post[]) {
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
          ${meta(post)}
        </header>
        ${contents(post)}
        <div class="prose">
${post.html}
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
export const blogUrls = (posts: Post[]) => [
  ...BLOG_LANGS.map((lang) => blogPath(lang)),
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
