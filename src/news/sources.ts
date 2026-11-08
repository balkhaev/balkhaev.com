/**
 * Where the site collects AI news itself: primary sources (labs, model hubs,
 * release pages) and a few curated outlets. scripts/collect-news.ts reads
 * them once a day and has a model pick and retell the most important items.
 */

export interface Source {
  kind: "feed" | "hf-papers";
  /** Shown under a story as its source. */
  name: string;
  /** At most this many of the newest items go to the editor. */
  take: number;
  url: string;
}

export const SOURCES: Source[] = [
  {
    kind: "feed",
    name: "OpenAI",
    take: 5,
    url: "https://openai.com/news/rss.xml",
  },
  {
    kind: "feed",
    name: "Google DeepMind",
    take: 5,
    url: "https://deepmind.google/blog/rss.xml",
  },
  {
    kind: "feed",
    name: "Google",
    take: 5,
    url: "https://blog.google/technology/ai/rss/",
  },
  {
    kind: "feed",
    name: "Hugging Face",
    take: 5,
    url: "https://huggingface.co/blog/feed.xml",
  },
  {
    kind: "hf-papers",
    name: "Hugging Face Papers",
    take: 6,
    url: "https://huggingface.co/api/daily_papers",
  },
  {
    kind: "feed",
    name: "Qwen",
    take: 3,
    url: "https://qwenlm.github.io/blog/index.xml",
  },
  {
    kind: "feed",
    name: "NVIDIA",
    take: 4,
    url: "https://developer.nvidia.com/blog/feed",
  },
  {
    kind: "feed",
    name: "Microsoft Research",
    take: 3,
    url: "https://www.microsoft.com/en-us/research/feed/",
  },
  {
    kind: "feed",
    name: "vLLM",
    take: 2,
    url: "https://github.com/vllm-project/vllm/releases.atom",
  },
  {
    kind: "feed",
    name: "Ollama",
    take: 2,
    url: "https://github.com/ollama/ollama/releases.atom",
  },
  {
    kind: "feed",
    name: "Transformers",
    take: 2,
    url: "https://github.com/huggingface/transformers/releases.atom",
  },
  {
    kind: "feed",
    name: "Simon Willison",
    take: 5,
    url: "https://simonwillison.net/atom/entries/",
  },
  {
    kind: "feed",
    name: "TechCrunch",
    take: 6,
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
  },
  {
    kind: "feed",
    name: "The Verge",
    take: 6,
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
  },
  {
    kind: "feed",
    name: "Hacker News",
    take: 8,
    url: "https://hnrss.org/frontpage?points=150",
  },
];

/** One item from a source, before the editor has seen it. */
export interface Candidate {
  /** ISO time; empty when the source gave none. */
  published: string;
  source: string;
  summary: string;
  title: string;
  url: string;
}

const SUMMARY_LENGTH = 280;
const ENTITY = /&(#x[\da-f]+|#\d+|[a-z]+);/gi;
const NAMED: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  rsquo: "’",
};

function decode(text: string) {
  return text.replace(ENTITY, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    }
    if (lower.startsWith("#")) {
      return String.fromCodePoint(Number(lower.slice(1)));
    }
    return NAMED[lower] ?? whole;
  });
}

const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const TAG = /<[^>]+>/g;
const SPACE = /\s+/g;

/** Text of an XML/HTML fragment: CDATA unwrapped, tags dropped, one line. */
export function plain(fragment: string) {
  const unwrapped = fragment.replace(CDATA, "$1");
  // Feeds often escape their HTML once: decode, strip tags, decode again.
  return decode(decode(unwrapped).replace(TAG, " "))
    .replace(TAG, " ")
    .replace(SPACE, " ")
    .trim();
}

export function clip(text: string, length = SUMMARY_LENGTH) {
  return text.length <= length
    ? text
    : `${text.slice(0, length - 1).trimEnd()}…`;
}

const ITEM = /<(item|entry)\b[\s\S]*?<\/\1>/gi;

function field(block: string, names: string[]) {
  for (const name of names) {
    const match = block.match(
      new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i")
    );
    if (match?.[1]?.trim()) {
      return match[1];
    }
  }
  return "";
}

const ALTERNATE = /<link\b[^>]*rel=["']alternate["'][^>]*>/i;
const BARE_LINK = /<link\b(?![^>]*rel=)[^>]*href=[^>]*>/i;
const HREF = /href=["']([^"']+)["']/i;

function link(block: string) {
  // Atom: the alternate link, or the first one without a rel.
  const atom = block.match(ALTERNATE)?.[0] ?? block.match(BARE_LINK)?.[0];
  const href = atom?.match(HREF)?.[1];
  if (href) {
    return decode(href);
  }
  return plain(field(block, ["link", "guid"]));
}

function time(value: string) {
  const parsed = Date.parse(plain(value));
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
}

/** Items of an RSS 2.0 or Atom feed, in feed order. */
export function parseFeed(xml: string, source: string): Candidate[] {
  return [...xml.matchAll(ITEM)].flatMap(([block]) => {
    const title = plain(field(block, ["title"]));
    const url = link(block);
    if (!(title && url.startsWith("https://"))) {
      return [];
    }
    return [
      {
        published: time(
          field(block, ["pubDate", "published", "updated", "dc:date"])
        ),
        source,
        summary: clip(
          plain(
            field(block, [
              "description",
              "summary",
              "content:encoded",
              "content",
            ])
          )
        ),
        title,
        url,
      },
    ];
  });
}

interface DailyPaper {
  paper?: {
    id?: string;
    publishedAt?: string;
    summary?: string;
    title?: string;
    upvotes?: number;
  };
  publishedAt?: string;
  title?: string;
}

/** Hugging Face daily papers, most upvoted first. */
export function parsePapers(data: unknown, source: string): Candidate[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return (data as DailyPaper[])
    .filter((item) => typeof item?.paper?.id === "string")
    .sort((a, b) => (b.paper?.upvotes ?? 0) - (a.paper?.upvotes ?? 0))
    .map((item) => ({
      published: time(item.publishedAt ?? item.paper?.publishedAt ?? ""),
      source,
      summary: clip(plain(item.paper?.summary ?? "")),
      title: plain(item.title ?? item.paper?.title ?? ""),
      url: `https://huggingface.co/papers/${item.paper?.id}`,
    }))
    .filter((item) => item.title);
}
