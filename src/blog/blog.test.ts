import { expect, test } from "bun:test";
import {
  checkSeries,
  loadPosts,
  loadSeries,
  parsePost,
  parseSeries,
} from "./content";
import { renderMarkdown } from "./markdown";
import {
  blogPath,
  renderFeed,
  renderIndex,
  renderPost,
  renderSeries,
} from "./render";

const post = (frontmatter: string, body = "Hello **world**.") =>
  `---\n${frontmatter}\n---\n${body}\n`;
const VALID = "title: T\ndescription: D\ndate: 2026-11-04\ntags: [ml]";

test("parses frontmatter and renders Markdown", async () => {
  const parsed = await parsePost(
    "x.md",
    post(VALID, "## Head\n\n| a |\n| - |\n| 1 |"),
    "x",
    "en"
  );
  expect(parsed).toMatchObject({
    date: "2026-11-04",
    math: false,
    tags: ["ml"],
    title: "T",
  });
  expect(parsed.html).toContain('<h2 id="head">Head</h2>');
  expect(parsed.html).toContain("<table>");
});

test("drops raw HTML from the source", async () => {
  const { html } = await renderMarkdown("<script>alert(1)</script>");
  expect(html).not.toContain("<script>");
});

test("renders inline and display math at build time", async () => {
  const { html, math } = await renderMarkdown(
    "Energy $E = mc^2$.\n\n$$\n\\sum_{i=1}^n x_i\n$$"
  );
  expect(math).toBe(true);
  expect(html).toContain('class="katex"');
  expect(html).toContain('class="katex-display"');
  expect(html).not.toContain("$E");
});

test("a broken formula fails the build", async () => {
  await expect(renderMarkdown("$\\frac{1}{$")).rejects.toThrow();
});

test("highlights code in both themes and tolerates unknown languages", async () => {
  const { html } = await renderMarkdown(
    "```python\nimport torch\n```\n\n```nonsense\nx\n```"
  );
  expect(html).toContain("--shiki-dark");
  expect(html).toContain("--shiki-light");
  expect(html).toContain("import");
});

test("turns directives into callouts and keeps colons in prose", async () => {
  const { html } = await renderMarkdown(
    ":::warning\nCareful.\n:::\n\n:::proof\nTrivial.\n:::\n\nRatio 3:2 at 10:30, see note:here."
  );
  expect(html).toContain('<aside class="callout warning">');
  expect(html).toContain(
    '<details class="callout proof"><summary>Proof</summary>'
  );
  expect(html).toContain("Ratio 3:2 at 10:30, see note:here.");
});

test("collects h2/h3 for the table of contents", async () => {
  const { toc } = await renderMarkdown(
    "## One\n\n### Sub\n\n#### Deep\n\n## Two[^1]\n\n[^1]: Note."
  );
  expect(toc).toEqual([
    { depth: 2, id: "one", text: "One" },
    { depth: 3, id: "sub", text: "Sub" },
    { depth: 2, id: "two1", text: "Two" },
  ]);
});

test("rejects malformed posts with the file name", async () => {
  await expect(parsePost("a.md", "no frontmatter", "a", "en")).rejects.toThrow(
    "a.md"
  );
  await expect(
    parsePost("a.md", post("title: T\ndate: 2026-11-04"), "a", "en")
  ).rejects.toThrow('"description"');
  await expect(
    parsePost(
      "a.md",
      post(VALID.replace("2026-11-04", "04.11.2026")),
      "a",
      "en"
    )
  ).rejects.toThrow('"date"');
  await expect(parsePost("a.md", post(VALID), "ru", "en")).rejects.toThrow(
    "slug"
  );
  await expect(
    parsePost("a.md", post(VALID), "Bad Slug", "en")
  ).rejects.toThrow("slug");
});

test("English lives at /blog/, Russian at /blog/ru/", () => {
  expect(blogPath("en")).toBe("/blog/");
  expect(blogPath("ru", "hello")).toBe("/blog/ru/hello/");
});

test("posts link their translation, escape titles and load KaTeX only with math", async () => {
  const en = await parsePost(
    "en.md",
    post(VALID.replace("T", "A <b> & C"), "$x$"),
    "x",
    "en"
  );
  const ru = await parsePost("ru.md", post(VALID), "x", "ru");
  const html = renderPost(en, [en, ru]);
  expect(html).toContain('<html lang="en">');
  expect(html).toContain("A &lt;b&gt; &amp; C");
  expect(html).toContain(
    'href="https://balkhaev.com/blog/ru/x/" hreflang="ru"'
  );
  expect(html).toContain("katex.min.css");
  expect(renderPost(ru, [en, ru])).not.toContain("katex.min.css");
  const index = renderIndex("ru", [en, ru]);
  expect(index).toContain('href="/blog/ru/x/"');
  expect(index).not.toContain('href="/blog/x/"');
});

test("an untranslated post does not claim a translation", async () => {
  const ru = await parsePost("ru.md", post(VALID), "only-ru", "ru");
  expect(renderPost(ru, [ru])).not.toContain('hreflang="en" rel="alternate"');
});

test("the feed lists one language with escaped content", async () => {
  const en = await parsePost("en.md", post(VALID, "a < b"), "x", "en");
  const ru = await parsePost("ru.md", post(VALID), "y", "ru");
  const feed = renderFeed("en", [en, ru]);
  expect(feed).toContain("<id>https://balkhaev.com/blog/x/</id>");
  expect(feed).not.toContain("/blog/ru/y/");
  expect(feed).toContain("a &amp;#x3C; b");
  expect(feed).toContain('rel="self"');
});

test("every committed post is valid", async () => {
  const posts = await loadPosts("content/blog", true);
  expect(posts.length).toBeGreaterThan(0);
});

const SERIES = `---
title: Agents
description: A series.
plan: [One, Two, Three]
---
Intro.
`;

test("series link their parts and list the ones still to come", async () => {
  const series = await parseSeries("s.md", SERIES, "agents", "en");
  const one = await parsePost(
    "1.md",
    post(`${VALID}\nseries: agents\npart: 1`),
    "one",
    "en"
  );
  const two = await parsePost(
    "2.md",
    post(`${VALID}\nseries: agents\npart: 2`),
    "two",
    "en"
  );
  checkSeries([one, two], [series]);
  const page = renderPost(one, [one, two], [series]);
  expect(page).toContain("part 1 of 3");
  expect(page).toContain('href="/blog/two/" rel="next"');
  expect(page).toContain("coming soon");
  const overview = renderSeries(series, [one, two], [series]);
  expect(overview).toContain("2 of 3 parts out");
  expect(overview).toContain("<span>Three</span>");
  expect(renderIndex("en", [one, two], [series])).toContain(
    'href="/blog/series/agents/"'
  );
});

test("a post must name an existing series and a planned part", async () => {
  const series = await parseSeries("s.md", SERIES, "agents", "en");
  const lost = await parsePost(
    "x.md",
    post(`${VALID}\nseries: other\npart: 1`),
    "x",
    "en"
  );
  expect(() => checkSeries([lost], [series])).toThrow("no en series");
  const late = await parsePost(
    "y.md",
    post(`${VALID}\nseries: agents\npart: 4`),
    "y",
    "en"
  );
  expect(() => checkSeries([late], [series])).toThrow("past the plan");
  await expect(
    parsePost("z.md", post(`${VALID}\nseries: agents`), "z", "en")
  ).rejects.toThrow('"part"');
});

test("every committed series is valid", async () => {
  const posts = await loadPosts("content/blog", true);
  checkSeries(posts, await loadSeries("content/series"));
});
