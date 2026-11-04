import { expect, test } from "bun:test";
import { loadPosts, parsePost } from "./content";
import { blogPath, renderIndex, renderPost } from "./render";

const post = (frontmatter: string, body = "Hello **world**.") =>
  `---\n${frontmatter}\n---\n${body}\n`;
const VALID = "title: T\ndescription: D\ndate: 2026-11-04\ntags: [ml]";

test("parses frontmatter and renders Markdown", () => {
  const parsed = parsePost(
    "x.md",
    post(VALID, "## Head\n\n| a |\n| - |\n| 1 |"),
    "x",
    "en"
  );
  expect(parsed).toMatchObject({
    date: "2026-11-04",
    tags: ["ml"],
    title: "T",
  });
  expect(parsed.html).toContain('<h2 id="head">Head</h2>');
  expect(parsed.html).toContain("<table>");
});

test("drops raw HTML from the source", () => {
  const parsed = parsePost(
    "x.md",
    post(VALID, "<script>alert(1)</script>"),
    "x",
    "en"
  );
  expect(parsed.html).not.toContain("<script>");
});

test("rejects malformed posts with the file name", () => {
  expect(() => parsePost("a.md", "no frontmatter", "a", "en")).toThrow("a.md");
  expect(() =>
    parsePost("a.md", post("title: T\ndate: 2026-11-04"), "a", "en")
  ).toThrow('"description"');
  expect(() =>
    parsePost(
      "a.md",
      post(VALID.replace("2026-11-04", "04.11.2026")),
      "a",
      "en"
    )
  ).toThrow('"date"');
  expect(() => parsePost("a.md", post(VALID), "ru", "en")).toThrow("slug");
  expect(() => parsePost("a.md", post(VALID), "Bad Slug", "en")).toThrow(
    "slug"
  );
});

test("English lives at /blog/, Russian at /blog/ru/", () => {
  expect(blogPath("en")).toBe("/blog/");
  expect(blogPath("ru", "hello")).toBe("/blog/ru/hello/");
});

test("posts link their translation and escape titles", () => {
  const en = parsePost(
    "en.md",
    post(VALID.replace("T", "A <b> & C")),
    "x",
    "en"
  );
  const ru = parsePost("ru.md", post(VALID), "x", "ru");
  const html = renderPost(en, [en, ru]);
  expect(html).toContain('<html lang="en">');
  expect(html).toContain("A &lt;b&gt; &amp; C");
  expect(html).toContain(
    'href="https://balkhaev.com/blog/ru/x/" hreflang="ru"'
  );
  const index = renderIndex("ru", [en, ru]);
  expect(index).toContain('href="/blog/ru/x/"');
  expect(index).not.toContain('href="/blog/x/"');
});

test("an untranslated post does not claim a translation", () => {
  const ru = parsePost("ru.md", post(VALID), "only-ru", "ru");
  expect(renderPost(ru, [ru])).not.toContain('hreflang="en" rel="alternate"');
});

test("every committed post is valid", async () => {
  const posts = await loadPosts("content/blog", true);
  expect(posts.length).toBeGreaterThan(0);
});
