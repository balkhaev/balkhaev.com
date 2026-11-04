import { expect, test } from "bun:test";
import type { Issue } from "./content";
import { latestBody, latestStories } from "./latest";

const story = (url: string, title = url) => ({
  source: "Lab",
  text: "",
  title,
  url,
});
const issues: Issue[] = [
  {
    date: "2026-11-04",
    post: null,
    stories: [story("https://a"), story("https://b")],
  },
  {
    date: "2026-11-06",
    post: 2,
    stories: [story("https://c"), story("https://a"), story("http://insecure")],
  },
];

test("newest editions first, each link once, only https", () => {
  expect(latestStories(issues, 5).map(({ story: item }) => item.url)).toEqual([
    "https://c",
    "https://a",
    "https://b",
  ]);
  expect(latestStories(issues, 2)).toHaveLength(2);
});

test("the sidebar escapes titles and links out", () => {
  const html = latestBody([
    { date: "2026-11-04", post: null, stories: [story("https://x", "<b>&")] },
  ]);
  expect(html).toContain("&lt;b&gt;&amp;");
  expect(html).toContain('<time datetime="2026-11-04">04.11</time>');
  expect(html).toContain('target="_blank"');
});
