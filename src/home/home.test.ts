import { expect, test } from "bun:test";
import type { Post } from "../blog/content";
import { featuredProjects, latestPosts, renderHome } from "./render";

const post = (slug: string, lang: "en" | "ru", date: string): Post => ({
  date,
  description: `${slug} ${lang}`,
  draft: false,
  html: "",
  lang,
  math: false,
  minutes: 1,
  slug,
  tags: [],
  title: `${slug} ${lang}`,
  toc: [],
});

test("prefers the Russian version and falls back to English", () => {
  const picked = latestPosts([
    post("a", "en", "2026-11-03"),
    post("a", "ru", "2026-11-03"),
    post("b", "en", "2026-11-05"),
  ]);
  expect(picked.map((p) => `${p.slug}:${p.lang}`)).toEqual(["b:en", "a:ru"]);
});

test("features linked projects except this site", () => {
  const urls = featuredProjects().map((project) => project.url);
  expect(urls.length).toBeGreaterThan(2);
  expect(urls).not.toContain("https://balkhaev.com/");
});

test("fills both placeholders", () => {
  const page = renderHome("<!-- home:posts --><!-- home:projects -->", [
    post("a", "ru", "2026-11-03"),
  ]);
  expect(page).toContain('href="/blog/ru/a/"');
  expect(page).toContain('class="projects"');
  expect(page).not.toContain("home:");
});
