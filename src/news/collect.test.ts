import { describe, expect, test } from "bun:test";
import { addEdition, shortlist, toStories, urlKey } from "./collect";
import type { Issue } from "./content";
import { type Candidate, parseFeed, parsePapers } from "./sources";

const rss = `<?xml version="1.0"?><rss><channel><title>Lab</title>
<item><title><![CDATA[Model &amp; tools]]></title><link>https://lab.ai/news/model?utm_source=rss</link>
<description>&lt;p&gt;New &lt;b&gt;weights&lt;/b&gt; &amp;amp; API.&lt;/p&gt;</description>
<pubDate>Sat, 07 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Plain http</title><link>http://lab.ai/old</link></item>
</channel></rss>`;

const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title>
<entry><title>v1.2.0</title><link rel="replies" href="https://x.dev/c"/><link rel="alternate" type="text/html" href="https://github.com/o/r/releases/tag/v1.2.0"/>
<updated>2026-11-07T08:00:00Z</updated><content type="html">&lt;h2&gt;Faster&lt;/h2&gt;</content></entry>
</feed>`;

describe("parseFeed", () => {
  test("reads RSS: CDATA, double-escaped HTML, dates, https only", () => {
    expect(parseFeed(rss, "Lab")).toEqual([
      {
        published: "2026-11-07T10:00:00.000Z",
        source: "Lab",
        summary: "New weights & API.",
        title: "Model & tools",
        url: "https://lab.ai/news/model?utm_source=rss",
      },
    ]);
  });

  test("reads Atom with the alternate link", () => {
    const [entry] = parseFeed(atom, "R");
    expect(entry?.url).toBe("https://github.com/o/r/releases/tag/v1.2.0");
    expect(entry?.summary).toBe("Faster");
    expect(entry?.published).toBe("2026-11-07T08:00:00.000Z");
  });
});

test("parsePapers sorts by upvotes and links to the paper page", () => {
  const papers = parsePapers(
    [
      { paper: { id: "1", summary: "a", title: "Low", upvotes: 2 } },
      {
        paper: { id: "2", summary: "b", title: "High", upvotes: 50 },
        publishedAt: "2026-11-07T00:00:00Z",
      },
      { paper: {} },
    ],
    "HF"
  );
  expect(papers.map((paper) => paper.title)).toEqual(["High", "Low"]);
  expect(papers[0]?.url).toBe("https://huggingface.co/papers/2");
  expect(parsePapers({ nope: 1 }, "HF")).toEqual([]);
});

test("urlKey ignores tracking, www and trailing slash", () => {
  expect(urlKey("https://www.a.com/x/?utm_source=1&id=2#top")).toBe(
    "https://a.com/x/?id=2"
  );
  expect(urlKey("https://a.com/x/")).toBe(urlKey("https://a.com/x"));
});

const now = new Date("2026-11-08T06:00:00Z");
const item = (url: string, hoursAgo: number, source = "S"): Candidate => ({
  published: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
  source,
  summary: "",
  title: url,
  url: `https://a.com/${url}`,
});

describe("shortlist", () => {
  const many = Array.from({ length: 14 }, (_, i) => item(`n${i}`, 1));

  test("keeps fresh unpublished items, a source's limit, each link once", () => {
    const published: Issue[] = [
      {
        date: "2026-11-07",
        post: null,
        stories: [
          { source: "S", text: "", title: "", url: "https://a.com/n0?utm_x=1" },
        ],
      },
    ];
    const list = shortlist(
      [
        { items: [...many, item("old", 60)], take: 20 },
        { items: [item("n1", 1, "T"), item("t1", 2, "T")], take: 1 },
      ],
      published,
      now
    );
    const urls = list.map((entry) => entry.title);
    expect(urls).not.toContain("n0");
    expect(urls).not.toContain("old");
    expect(urls.filter((url) => url === "n1")).toHaveLength(1);
    expect(list.filter((entry) => entry.source === "T")).toHaveLength(1);
  });

  test("looks four days back when two days were quiet", () => {
    const list = shortlist(
      [{ items: [item("a", 1), item("b", 70), item("c", 200)], take: 9 }],
      [],
      now
    );
    expect(list.map((entry) => entry.title)).toEqual(["a", "b"]);
  });
});

test("toStories takes links and sources from candidates, not the model", () => {
  const candidates = [item("x", 1, "Lab"), item("y", 1, "Blog")];
  const stories = toStories(
    {
      stories: [
        {
          id: 2,
          text_en: "Text.",
          text_ru: "Текст.",
          title_en: "Title",
          title_ru: "Заголовок",
          topics: ["agents", "nope"],
        },
        { id: 2, text_ru: "dup", title_ru: "dup" },
        { id: 9, text_ru: "missing", title_ru: "missing" },
        { id: 1, text_ru: "", title_ru: "empty" },
      ],
    },
    candidates
  );
  expect(stories).toEqual([
    {
      en: { text: "Text.", title: "Title" },
      source: "Blog",
      text: "Текст.",
      title: "Заголовок",
      topics: ["agents"],
      url: "https://a.com/y",
    },
  ]);
  expect(toStories(null, candidates)).toEqual([]);
});

test("addEdition replaces the same date and keeps newest first", () => {
  const edition = (date: string, title = date): Issue => ({
    date,
    post: null,
    stories: [{ source: "S", text: "", title, url: "https://a.com" }],
  });
  const result = addEdition(
    [edition("2026-11-07"), edition("2026-11-05")],
    edition("2026-11-07", "new")
  );
  expect(result.map((issue) => issue.date)).toEqual([
    "2026-11-07",
    "2026-11-05",
  ]);
  expect(result[0]?.stories[0]?.title).toBe("new");
});
