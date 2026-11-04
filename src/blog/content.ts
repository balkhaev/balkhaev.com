import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { YAML } from "bun";
import { renderMarkdown } from "./markdown";

export const BLOG_LANGS = ["en", "ru"] as const;
export type BlogLang = (typeof BLOG_LANGS)[number];

export interface Post {
  date: string;
  description: string;
  draft: boolean;
  html: string;
  lang: BlogLang;
  /** Rough reading time in minutes. */
  minutes: number;
  slug: string;
  tags: string[];
  title: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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

/**
 * Parses one post file: YAML frontmatter between `---` lines, then Markdown.
 * Throws with the file name on any missing or malformed field.
 */
export function parsePost(
  file: string,
  source: string,
  slug: string,
  lang: BlogLang
): Post {
  if (!(SLUG.test(slug) && slug !== "ru")) {
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
  return {
    date,
    description: text(file, fields, "description"),
    draft,
    html: renderMarkdown(body),
    lang,
    minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    slug,
    tags,
    title: text(file, fields, "title"),
  };
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
        posts.push(parsePost(file, source, folder.name, lang));
      }
    }
  }
  return posts
    .filter((post) => drafts || !post.draft)
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug)
    );
}
