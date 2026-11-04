import { expect, test } from "bun:test";
import { renderMarkdown } from "../blog/markdown";
import { FIRST_ISSUE, type Issue } from "./content";
import { mergeIssues } from "./feed";
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
  const html = renderWidget(["open-models"], 2, "en", [
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
  expect(merged.map((issue) => issue.date)).toEqual([
    "2026-11-08",
    FIRST_ISSUE.date,
  ]);
  expect(merged[0]?.post).toBe(2);
});
