import { expect, test } from "bun:test";
import type { Post } from "../blog/content";
import {
  HOME_PROJECTS,
  latestPosts,
  renderHome,
  summary,
  years,
} from "./render";

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

test("lists the chosen projects with summaries", () => {
  expect(HOME_PROJECTS.map((project) => project.url)).toEqual([
    "https://adorely.co/",
    "https://sinly.io/",
    "https://luv.club/",
    "https://ggpick.club/",
    "https://алтайземля.рф/",
  ]);
  for (const project of HOME_PROJECTS) {
    expect(project.text.length).toBeGreaterThan(10);
  }
});

test("fills both placeholders", () => {
  const page = renderHome(
    "<!-- home:posts --><!-- home:projects --><!-- home:experience -->",
    [post("a", "ru", "2026-11-03")]
  );
  expect(page).toContain('href="/blog/ru/a/"');
  expect(page).toContain("project-row");
  expect(page).toContain("job-row");
  expect(page).not.toContain("home:");
});

test("shortens job periods to years", () => {
  expect(years("Март 2026 – сейчас")).toBe("2026 — н. в.");
  expect(years("Октябрь 2022 – август 2024")).toBe("2022 — 2024");
  expect(years("2013")).toBe("2013");
});

test("summarises a project by its first clause", () => {
  expect(summary("Производство AI-фильмов: агент-продюсер")).toBe(
    "Производство AI-фильмов"
  );
});
