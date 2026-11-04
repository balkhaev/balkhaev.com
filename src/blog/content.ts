import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { YAML } from "bun";
import { parseStoryboard, timeline } from "../video/storyboard";
import { type Heading, renderMarkdown } from "./markdown";

export const BLOG_LANGS = ["en", "ru"] as const;
export type BlogLang = (typeof BLOG_LANGS)[number];

export interface Post {
  date: string;
  description: string;
  draft: boolean;
  html: string;
  lang: BlogLang;
  /** The post has formulas and needs the KaTeX stylesheet. */
  math: boolean;
  /** Rough reading time in minutes. */
  minutes: number;
  /** The post has a news widget and needs its script. */
  news: boolean;
  /** Position in the series, from 1. Set together with `series`. */
  part?: number;
  /** Id of the series this post belongs to (a folder in content/series). */
  series?: string;
  slug: string;
  tags: string[];
  title: string;
  toc: Heading[];
  /** Day the post was last revised, when later than `date`. */
  updated?: string;
  /** Length in seconds of the post's video, when it has a storyboard. */
  video?: number;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Folder names that would collide with blog routes. */
const RESERVED = new Set(["ru", "series"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WORDS_PER_MINUTE = 200;
const WHITESPACE = /\s+/;

function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`);
}

function text(file: string, data: Record<string, unknown>, key: string) {
  const value = data[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail(file, `"${key}" must be a non-empty string`);
  }
  return value.trim();
}

/** `series` and `part` go together; returns both or neither. */
function seriesFields(file: string, fields: Record<string, unknown>) {
  const { part, series } = fields;
  if (series === undefined && part === undefined) {
    return {};
  }
  if (!(typeof series === "string" && SLUG.test(series))) {
    fail(file, `"series" must be a series folder name`);
  }
  if (!(typeof part === "number" && Number.isInteger(part) && part >= 1)) {
    fail(file, `"part" must be a whole number from 1 when "series" is set`);
  }
  return { part, series };
}

/**
 * Parses one post file: YAML frontmatter between `---` lines, then Markdown.
 * Throws with the file name on any missing or malformed field.
 */
export async function parsePost(
  file: string,
  source: string,
  slug: string,
  lang: BlogLang
): Promise<Post> {
  if (!(SLUG.test(slug) && !RESERVED.has(slug))) {
    fail(file, `folder name "${slug}" is not a valid slug`);
  }
  const match = FRONTMATTER.exec(source);
  if (!match) {
    fail(file, "missing --- frontmatter ---");
  }
  const data = YAML.parse(match[1] ?? "");
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail(file, "frontmatter must be a mapping");
  }
  const fields = data as Record<string, unknown>;
  const date = text(file, fields, "date");
  if (!(DATE.test(date) && !Number.isNaN(Date.parse(date)))) {
    fail(file, `"date" must look like 2026-11-04, got "${date}"`);
  }
  const updated =
    fields.updated === undefined ? undefined : text(file, fields, "updated");
  if (
    updated !== undefined &&
    !(
      DATE.test(updated) &&
      !Number.isNaN(Date.parse(updated)) &&
      updated >= date
    )
  ) {
    fail(file, `"updated" must look like 2026-11-04 and not be before "date"`);
  }
  const tags = fields.tags ?? [];
  if (!(Array.isArray(tags) && tags.every((tag) => typeof tag === "string"))) {
    fail(file, `"tags" must be a list of strings`);
  }
  const draft = fields.draft ?? false;
  if (typeof draft !== "boolean") {
    fail(file, `"draft" must be true or false`);
  }
  const body = match[2] ?? "";
  const words = body.split(WHITESPACE).filter(Boolean).length;
  const { html, math, news, toc } = await renderMarkdown(
    body,
    lang,
    date,
    slug
  );
  return {
    date,
    description: text(file, fields, "description"),
    draft,
    html,
    lang,
    math,
    minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    news,
    ...seriesFields(file, fields),
    slug,
    tags,
    title: text(file, fields, "title"),
    toc,
    ...(updated && updated !== date ? { updated } : {}),
  };
}

/**
 * Length of the video rendered from `video.<lang>.yml` next to the post, or
 * undefined without one. Parsing here also fails the build on a broken
 * storyboard.
 */
async function videoLength(folder: string, lang: BlogLang) {
  const file = join(folder, `video.${lang}.yml`);
  const source = await readFile(file, "utf8").catch(() => undefined);
  if (source === undefined) {
    return;
  }
  const last = timeline(parseStoryboard(file, source)).at(-1);
  return last ? Math.round(last.start + last.duration) : undefined;
}

/**
 * Reads every `content/blog/<slug>/<lang>.md`, newest first. A post can exist
 * in one language or both; drafts are left out unless `drafts` is set.
 */
export async function loadPosts(root: string, drafts = false) {
  const posts: Post[] = [];
  const folders = await readdir(root, { withFileTypes: true });
  for (const folder of folders) {
    if (!folder.isDirectory()) {
      continue;
    }
    for (const lang of BLOG_LANGS) {
      const file = join(root, folder.name, `${lang}.md`);
      // biome-ignore lint/performance/noAwaitInLoops: a handful of small files
      const source = await readFile(file, "utf8").catch(() => undefined);
      if (source !== undefined) {
        const post = await parsePost(file, source, folder.name, lang);
        const video = await videoLength(join(root, folder.name), lang);
        posts.push(video ? { ...post, video } : post);
      }
    }
  }
  return posts
    .filter((post) => drafts || !post.draft)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.part ?? 0) - (a.part ?? 0) ||
        a.slug.localeCompare(b.slug)
    );
}

export interface Series {
  description: string;
  html: string;
  id: string;
  lang: BlogLang;
  /** Titles of every planned part, in order; part N is `plan[N - 1]`. */
  plan: string[];
  title: string;
}

/**
 * Parses `content/series/<id>/<lang>.md`: title, description and the list of
 * planned parts in frontmatter, an introduction in Markdown.
 */
export async function parseSeries(
  file: string,
  source: string,
  id: string,
  lang: BlogLang
): Promise<Series> {
  if (!SLUG.test(id)) {
    fail(file, `folder name "${id}" is not a valid series id`);
  }
  const match = FRONTMATTER.exec(source);
  if (!match) {
    fail(file, "missing --- frontmatter ---");
  }
  const data = YAML.parse(match[1] ?? "");
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail(file, "frontmatter must be a mapping");
  }
  const fields = data as Record<string, unknown>;
  const { plan } = fields;
  if (
    !(
      Array.isArray(plan) &&
      plan.length > 0 &&
      plan.every((title) => typeof title === "string" && title.trim())
    )
  ) {
    fail(file, `"plan" must be a list of part titles`);
  }
  const { html } = await renderMarkdown(match[2] ?? "", lang);
  return {
    description: text(file, fields, "description"),
    html,
    id,
    lang,
    plan: plan.map((title: string) => title.trim()),
    title: text(file, fields, "title"),
  };
}

/** Reads every `content/series/<id>/<lang>.md`. */
export async function loadSeries(root: string) {
  const all: Series[] = [];
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const folder of folders) {
    if (!folder.isDirectory()) {
      continue;
    }
    for (const lang of BLOG_LANGS) {
      const file = join(root, folder.name, `${lang}.md`);
      // biome-ignore lint/performance/noAwaitInLoops: a handful of small files
      const source = await readFile(file, "utf8").catch(() => undefined);
      if (source !== undefined) {
        all.push(await parseSeries(file, source, folder.name, lang));
      }
    }
  }
  return all;
}

/** Throws if a post names a series or part that does not exist. */
export function checkSeries(posts: Post[], series: Series[]) {
  for (const post of posts) {
    if (post.series === undefined) {
      continue;
    }
    const own = series.find(
      (item) => item.id === post.series && item.lang === post.lang
    );
    const where = `${post.lang}/${post.slug}`;
    if (!own) {
      throw new Error(`${where}: no ${post.lang} series "${post.series}"`);
    }
    if ((post.part ?? 0) > own.plan.length) {
      throw new Error(
        `${where}: part ${post.part} is past the plan of "${post.series}"`
      );
    }
    const twin = posts.find(
      (other) =>
        other !== post &&
        other.lang === post.lang &&
        other.series === post.series &&
        other.part === post.part
    );
    if (twin) {
      throw new Error(`${where}: part ${post.part} is also ${twin.slug}`);
    }
  }
}
