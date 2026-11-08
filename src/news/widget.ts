import type { Issue } from "./content";
import {
  isTopic,
  type Pick,
  type Picked,
  pickStories,
  TOPICS,
  type TopicId,
  type TopicLang,
} from "./topics";

/** Where the site publishes every digest edition it has seen, as JSON. */
export const FEED_PATH = "/news/feed.json";
export const DEFAULT_LIMIT = 3;
export const MAX_LIMIT = 6;

const WEB = /^https:\/\//;
const SEPARATOR = /[\s,]+/;
const ENTITIES: Record<string, string> = {
  "'": "&#39;",
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
const html = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);

const LABELS: Record<
  TopicLang,
  {
    all: string;
    fresh: string;
    kicker: string;
    note: string;
    topic: string;
  }
> = {
  en: {
    all: "All news",
    fresh: "Nothing on this topic yet. The latest in AI",
    kicker: "News on the topic",
    note: "Some stories are in Russian",
    topic: "Topic",
  },
  ru: {
    all: "Все новости",
    fresh: "По теме пока тихо. Свежее в AI",
    kicker: "Новости по теме",
    note: "",
    topic: "Тема",
  },
};

/** "agents mcp" or "agents,mcp" → known topic ids, in order, no repeats. */
export function parseTopics(value: string): TopicId[] {
  const ids = value.split(SEPARATOR).filter(Boolean);
  const unknown = ids.filter((id) => !isTopic(id));
  if (unknown.length || ids.length === 0) {
    throw new Error(
      `Unknown news topic "${unknown.join(", ") || value}". Known: ${Object.keys(TOPICS).join(", ")}`
    );
  }
  return [...new Set(ids)] as TopicId[];
}

export function parseLimit(value: string | undefined) {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  const limit = Number(value);
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT)) {
    throw new Error(`News limit must be 1 to ${MAX_LIMIT}, got "${value}"`);
  }
  return limit;
}

const shortDate = (date: string) =>
  date.split("-").reverse().slice(0, 2).join(".");

/** Inside of the widget: heading, stories and a link to the whole digest. */
export function widgetBody(picked: Picked, topics: TopicId[], lang: TopicLang) {
  const label = LABELS[lang];
  const names = topics.map((id) => TOPICS[id].label[lang]).join(" · ");
  const head = picked.matched ? label.kicker : label.fresh;
  const shown = picked.stories.filter(({ story }) => WEB.test(story.url));
  // English pages show a story's English version when it has one.
  const local = (story: Pick["story"]) =>
    lang === "en" && story.en
      ? { ...story.en, lang: "en" }
      : { lang: "ru", text: story.text, title: story.title };
  const items = shown
    .map(({ date, story }, index) => {
      const { lang: storyLang, text, title } = local(story);
      return `<li class="news-item" lang="${storyLang}">
<span class="news-no">${String(index + 1).padStart(2, "0")}</span>
<div class="news-main"><a class="news-title" href="${html(story.url)}" rel="external noopener noreferrer" target="_blank">${html(title)}</a>
<p class="news-text">${html(text)}</p>
<p class="news-meta"><time datetime="${date}">${shortDate(date)}</time><span>${html(story.source)} <span aria-hidden="true">↗</span></span></p></div>
</li>`;
    })
    .join("");
  const russian = shown.some(({ story }) => local(story).lang === "ru");
  const note =
    label.note && russian ? `<span lang="en">${label.note}</span>` : "";
  return `<p class="news-head"><span class="news-kicker"><span aria-hidden="true" class="news-dot"></span>${head}</span><span class="news-topic">${html(names)}</span></p>
<ol class="news-list">${items}</ol>
<p class="news-foot"><a href="/news/">${label.all} <span aria-hidden="true">→</span></a>${note}</p>`;
}

/**
 * The whole widget as the build writes it into a post. The browser refreshes
 * it from FEED_PATH (see src/news/client.ts), so the page stays static.
 */
export function renderWidget(
  topics: TopicId[],
  limit: number,
  lang: TopicLang,
  near: string | undefined,
  issues: Issue[],
  seed?: string
) {
  const picked = pickStories(issues, topics, limit, near, seed);
  const name = topics.map((id) => TOPICS[id].label[lang]).join(", ");
  return `<aside aria-label="${html(`${LABELS[lang].kicker}: ${name}`)}" class="news-widget" data-lang="${lang}" data-limit="${limit}"${near ? ` data-near="${near}"` : ""}${seed ? ` data-seed="${html(seed)}"` : ""} data-topics="${topics.join(" ")}"${picked.matched ? "" : " hidden"}>
${picked.matched ? widgetBody(picked, topics, lang) : ""}
</aside>`;
}
