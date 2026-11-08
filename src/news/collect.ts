import type { Issue, Story } from "./content";
import type { Candidate } from "./sources";
import { isTopic, TOPICS } from "./topics";

/** Stories in one edition the site collects. */
export const MIN_STORIES = 3;
export const MAX_STORIES = 6;
/** Items older than this are not news any more. */
export const FRESH_HOURS = 48;
/** If the last two days were quiet, look a bit further back. */
export const QUIET_HOURS = 96;
const MIN_CANDIDATES = 12;
/** Keeps the editor's input small enough for any model. */
export const MAX_CANDIDATES = 45;

const TRACKING = /^(utm_|ref$|ref_|fbclid$|gclid$)/;
const WWW = /^www\./;
const TRAILING_SLASH = /\/$/;
const SPACES = /\s+/g;

/** A URL as a key: no tracking parameters, fragment or trailing slash. */
export function urlKey(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const name of [...parsed.searchParams.keys()]) {
      if (TRACKING.test(name)) {
        parsed.searchParams.delete(name);
      }
    }
    parsed.hostname = parsed.hostname.replace(WWW, "");
    return parsed.toString().replace(TRAILING_SLASH, "");
  } catch {
    return url;
  }
}

const HOUR = 3_600_000;

/**
 * What the editor sees: fresh items from each source (a source's own limit
 * applied), each link once, none already published.
 */
export function shortlist(
  bySource: { items: Candidate[]; take: number }[],
  published: Issue[],
  now = new Date()
): Candidate[] {
  const used = new Set(
    published.flatMap((issue) =>
      issue.stories.map((story) => urlKey(story.url))
    )
  );
  const within = (hours: number) => {
    const seen = new Set(used);
    return bySource.flatMap(({ items, take }) =>
      items
        .filter((item) => {
          const key = urlKey(item.url);
          const age = item.published
            ? now.getTime() - Date.parse(item.published)
            : Number.POSITIVE_INFINITY;
          const keep = !seen.has(key) && age >= -HOUR && age <= hours * HOUR;
          seen.add(key);
          return keep;
        })
        .slice(0, take)
    );
  };
  const fresh = within(FRESH_HOURS);
  const picked = fresh.length >= MIN_CANDIDATES ? fresh : within(QUIET_HOURS);
  return picked.slice(0, MAX_CANDIDATES);
}

const TOPIC_LIST = Object.entries(TOPICS)
  .map(([id, topic]) => `${id} (${topic.label.en})`)
  .join(", ");

export const EDITOR_PROMPT = `Ты редактор ежедневного дайджеста новостей AI на сайте balkhaev.com. Читатели — разработчики и инженеры, которые строят продукты на LLM.

Тебе дают пронумерованный список свежих материалов из первоисточников и профильных изданий. Выбери от ${MIN_STORIES} до ${MAX_STORIES} самых важных для практика: крупные релизы моделей и продуктов, открытые веса, новые возможности API, заметные инструменты и исследования, которые меняют то, как строят AI-системы. Пропускай раунды инвестиций, кадровые новости, мнения, мелкие патч-релизы, рекламу и повторы одной новости из разных источников (из повторов бери первоисточник).

Для каждой выбранной новости:
- id — номер материала из списка, ровно как дан;
- title_ru — заголовок по-русски, до 90 знаков, без кликбейта;
- text_ru — 1–2 предложения по-русски, до 260 знаков: что произошло и почему это важно разработчику;
- title_en и text_en — то же по-английски;
- topics — от 1 до 3 тем из списка: ${TOPIC_LIST}.

Пиши только то, что есть в материале: не додумывай цифры, даты и характеристики. Названия моделей и продуктов не переводи. Порядок — от самой важной новости к менее важной.`;

/** The candidate list as the editor reads it. */
export function editorInput(candidates: Candidate[]) {
  return candidates
    .map(
      (item, index) =>
        `[${index + 1}] ${item.source}: ${item.title}${item.summary ? `\n${item.summary}` : ""}`
    )
    .join("\n\n");
}

/** JSON Schema of the editor's answer. */
export const EDITOR_SCHEMA = {
  additionalProperties: false,
  properties: {
    stories: {
      items: {
        additionalProperties: false,
        properties: {
          id: { type: "integer" },
          text_en: { type: "string" },
          text_ru: { type: "string" },
          title_en: { type: "string" },
          title_ru: { type: "string" },
          topics: { items: { type: "string" }, type: "array" },
        },
        required: [
          "id",
          "title_ru",
          "text_ru",
          "title_en",
          "text_en",
          "topics",
        ],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["stories"],
  type: "object",
} as const;

export interface EditorStory {
  id: number;
  text_en: string;
  text_ru: string;
  title_en: string;
  title_ru: string;
  topics: string[];
}

const TITLE_LENGTH = 110;
const TEXT_LENGTH = 320;
const clean = (text: unknown, length: number) =>
  typeof text === "string"
    ? text.replace(SPACES, " ").trim().slice(0, length)
    : "";

/**
 * The editor's picks as stories. Links and sources come from the candidates,
 * never from the model, so a story always points where the item came from.
 */
export function toStories(answer: unknown, candidates: Candidate[]): Story[] {
  const picks = (answer as { stories?: unknown } | null)?.stories;
  if (!Array.isArray(picks)) {
    return [];
  }
  const seen = new Set<number>();
  const stories: Story[] = [];
  for (const pick of picks as (Partial<EditorStory> | null)[]) {
    const id = Number(pick?.id);
    const item = candidates[id - 1];
    const title = clean(pick?.title_ru, TITLE_LENGTH);
    const text = clean(pick?.text_ru, TEXT_LENGTH);
    if (!(item && title && text) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const enTitle = clean(pick?.title_en, TITLE_LENGTH);
    const enText = clean(pick?.text_en, TEXT_LENGTH);
    const topics = [
      ...new Set((pick?.topics ?? []).filter((topic) => isTopic(topic))),
    ];
    stories.push({
      ...(enTitle && enText ? { en: { text: enText, title: enTitle } } : {}),
      source: item.source,
      text,
      title,
      ...(topics.length ? { topics } : {}),
      url: item.url,
    });
  }
  return stories.slice(0, MAX_STORIES);
}

/** Editions the repository keeps: about a year of daily ones. */
export const KEPT_EDITIONS = 400;

/** The stored editions with a new one: one per date, newest first. */
export function addEdition(editions: Issue[], edition: Issue): Issue[] {
  return [edition, ...editions.filter((issue) => issue.date !== edition.date)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, KEPT_EDITIONS);
}
