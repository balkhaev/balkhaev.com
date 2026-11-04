import { expect, test } from "bun:test";
import { renderMarkdown } from "../blog/markdown";
import { ARCHIVE, FIRST_ISSUE, type Issue } from "./content";
import { mergeIssues, nearDate } from "./feed";
import { pickStories } from "./topics";
import { parseTopics, renderWidget } from "./widget";

const story = (title: string, text = "") => ({
  source: "S",
  text,
  title,
  url: `https://example.com/${encodeURIComponent(title)}`,
});

const issues: Issue[] = [
  {
    date: "2026-11-08",
    post: 2,
    stories: [
      story("Новый видеогенератор"),
      story("Агенты учатся ходить в MCP"),
    ],
  },
  {
    date: "2026-11-06",
    post: 1,
    stories: [story("MCP-серверы для баз"), story("Цены на GPU")],
  },
];

test("picks stories on the topic, newest edition first", () => {
  const picked = pickStories(issues, ["mcp"], 3);
  expect(picked.matched).toBe(true);
  expect(picked.stories.map((item) => item.story.title)).toEqual([
    "Агенты учатся ходить в MCP",
    "MCP-серверы для баз",
  ]);
});

test("matches Russian stems only at the start of a word", () => {
  const titles = pickStories(issues, ["agents"], 3).stories.map(
    (item) => item.story.title
  );
  expect(titles).toContain("Агенты учатся ходить в MCP");
  expect(titles).not.toContain("Новый видеогенератор");
  const off = [{ ...issues[1], stories: [story("Переагентство")] }] as Issue[];
  expect(pickStories(off, ["agents"], 3).matched).toBe(false);
});

test("falls back to the newest stories when nothing matches", () => {
  const picked = pickStories(issues, ["security"], 2);
  expect(picked.matched).toBe(false);
  expect(picked.stories.map((item) => item.date)).toEqual([
    "2026-11-08",
    "2026-11-08",
  ]);
});

test("rejects unknown topics", () => {
  expect(() => parseTopics("agents nope")).toThrow("nope");
});

test("renders an escaped widget in the post language", () => {
  const html = renderWidget(["open-models"], 2, "en", undefined, [
    { ...issues[0], stories: [story("<b>open</b> weights")] } as Issue,
  ]);
  expect(html).toContain('data-topics="open-models"');
  expect(html).toContain("&lt;b&gt;open&lt;/b&gt; weights");
  expect(html).toContain("News on the topic");
  expect(html).toContain("The digest is in Russian");
});

test("::news in Markdown becomes the widget and flags the post", async () => {
  const out = await renderMarkdown(
    'Text.\n\n::news{topic="agents" limit=2}\n',
    "ru"
  );
  expect(out.news).toBe(true);
  expect(out.html).toContain('class="news-widget"');
  expect(out.html).toContain("Новости по теме");
  expect((await renderMarkdown("Plain.")).news).toBe(false);
  await expect(renderMarkdown('::news{topic="nope"}')).rejects.toThrow();
  await expect(renderMarkdown('::news{topic="mcp" limit=9}')).rejects.toThrow();
});

test("the feed keeps one valid edition per date and the launch edition", () => {
  const bad = {
    date: "2026-11-10",
    post: 3,
    stories: [{ ...story("x"), url: "javascript:x" }],
  };
  const merged = mergeIssues([
    issues[0],
    { ...issues[0], post: 9 },
    bad,
  ] as Issue[]);
  expect(merged.map((issue) => issue.date).slice(0, 2)).toEqual([
    "2026-11-08",
    FIRST_ISSUE.date,
  ]);
  expect(merged).toHaveLength(2 + ARCHIVE.length);
  expect(merged[0]?.post).toBe(2);
});

test("prefers matches near the post's date, then the rest", () => {
  const picked = pickStories(issues, ["mcp"], 2, "2026-09-01");
  expect(picked.stories.map((item) => item.date)).toEqual([
    "2026-11-08",
    "2026-11-06",
  ]);
  const old = [
    { date: "2026-01-10", post: null, stories: [story("MCP старый")] },
    ...issues,
  ] as Issue[];
  const near = pickStories(old, ["mcp"], 2, "2026-01-20");
  expect(near.stories[0]?.story.title).toBe("MCP старый");
});

test("the archive is real-looking data: https links, one edition per date", () => {
  const dates = ARCHIVE.map((issue) => issue.date);
  expect(new Set(dates).size).toBe(dates.length);
  expect(ARCHIVE.length).toBeGreaterThan(40);
  for (const issue of ARCHIVE) {
    for (const item of issue.stories) {
      expect(item.url.startsWith("https://")).toBe(true);
      expect(item.title.length).toBeGreaterThan(5);
    }
  }
  expect(nearDate("2024-05-01")).toBeUndefined();
  expect(nearDate("2026-03-01")).toBe("2026-03-01");
});
