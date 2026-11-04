import type { Issue, Story } from "./content";

export type TopicLang = "en" | "ru";

export interface Topic {
  label: Record<TopicLang, string>;
  /** Stems and names matched in a story's title and text. */
  words: string[];
}

/**
 * Topics a post can ask news for with `::news{topic="agents mcp"}`.
 * A word matches at the start of a word, so "агент" finds "агентов";
 * a word ending in "!" must also end there ("MCP!" skips "MCPs").
 */
export const TOPICS = {
  agents: {
    label: { en: "AI agents", ru: "AI-агенты" },
    words: [
      "агент",
      "agent",
      "tool use",
      "function calling",
      "вызов инструмент",
      "computer use",
      "MCP!",
      "A2A!",
    ],
  },
  automation: {
    label: { en: "Automation", ru: "Автоматизация" },
    words: [
      "автоматиз",
      "automat",
      "workflow",
      "воркфлоу",
      "n8n",
      "Zapier",
      "бизнес",
      "business",
      "enterprise",
      "поддержк",
      "customer support",
      "CRM!",
    ],
  },
  coding: {
    label: { en: "AI for code", ru: "AI для кода" },
    words: [
      "программир",
      "coding",
      "код",
      "code",
      "Codex",
      "Claude Code",
      "Cursor",
      "Copilot",
      "SWE-bench",
    ],
  },
  cost: {
    label: { en: "Price and limits", ru: "Цены и лимиты" },
    words: [
      "цен",
      "стоимост",
      "дешевл",
      "дешёв",
      "price",
      "pricing",
      "cheap",
      "cost",
      "токен",
      "token",
      "кэш",
      "cach",
      "лимит",
      "rate limit",
      "меньше вычислен",
    ],
  },
  inference: {
    label: { en: "Inference", ru: "Инференс" },
    words: [
      "инференс",
      "inference",
      "vLLM",
      "SGLang",
      "llama.cpp",
      "Ollama",
      "GGUF",
      "квантиз",
      "quantiz",
      "ускорен",
      "ускоря",
      "faster",
      "GPU",
      "TensorRT",
      "MLX!",
      "ComfyUI",
      "пример запуска",
    ],
  },
  "llm-api": {
    label: { en: "Models and APIs", ru: "Модели и API" },
    words: [
      "Claude",
      "Anthropic",
      "OpenAI",
      "GPT",
      "Gemini",
      "Grok",
      "DeepSeek",
      "Mistral",
      "Qwen",
      "Llama",
      "LLM",
      "API!",
      "языков",
      "language model",
    ],
  },
  mcp: {
    label: { en: "MCP", ru: "MCP" },
    words: ["MCP!", "Model Context Protocol", "коннектор", "connector"],
  },
  "open-models": {
    label: { en: "Open models", ru: "Открытые модели" },
    words: [
      "открыт",
      "open-source",
      "open source",
      "open weight",
      "open-weight",
      "веса",
      "весов",
      "weights",
      "Hugging Face",
      "Apache 2",
      "MIT!",
      "лицензи",
      "license",
    ],
  },
  search: {
    label: { en: "Search and RAG", ru: "Поиск и RAG" },
    words: [
      "RAG!",
      "поиск",
      "search",
      "retriev",
      "эмбеддинг",
      "embedding",
      "вектор",
      "vector",
      "реранк",
      "rerank",
    ],
  },
  security: {
    label: { en: "Security", ru: "Безопасность" },
    words: [
      "безопасн",
      "security",
      "уязвим",
      "vulnerab",
      "prompt injection",
      "инъекци",
      "jailbreak",
      "джейлбрейк",
      "утечк",
      "leak",
      "приватн",
      "privacy",
    ],
  },
} satisfies Record<string, Topic>;

export type TopicId = keyof typeof TOPICS;

export const isTopic = (id: string): id is TopicId => Object.hasOwn(TOPICS, id);

const SPECIAL = /[.*+?^${}()|[\]\\]/g;
const LETTER = "[\\p{L}\\p{N}]";

function pattern(word: string) {
  const whole = word.endsWith("!");
  const text = (whole ? word.slice(0, -1) : word).replace(SPECIAL, "\\$&");
  return `(?<!${LETTER})${text}${whole ? `(?!${LETTER})` : ""}`;
}

const MATCHERS = Object.fromEntries(
  Object.entries(TOPICS).map(([id, topic]) => [
    id,
    new RegExp(topic.words.map(pattern).join("|"), "giu"),
  ])
) as Record<TopicId, RegExp>;

/** How many topic words a story mentions; the title counts double. */
export function score(story: Story, topics: TopicId[]) {
  let total = 0;
  for (const id of topics) {
    const matcher = MATCHERS[id];
    total +=
      2 * (story.title.match(matcher)?.length ?? 0) +
      (story.text.match(matcher)?.length ?? 0);
  }
  return total;
}

export interface Pick {
  date: string;
  story: Story;
}

export interface Picked {
  /** False when nothing matched and these are just the newest stories. */
  matched: boolean;
  stories: Pick[];
}

/**
 * Stories for a widget: those that mention the topics, newest edition first
 * and the stronger match first within an edition. With no match at all, the
 * newest stories, so the widget is never empty.
 */
export function pickStories(
  issues: Issue[],
  topics: TopicId[],
  limit: number
): Picked {
  const all = [...issues]
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap((issue) =>
      issue.stories.map((story) => ({ date: issue.date, story }))
    );
  const seen = new Set<string>();
  const unique = all.filter(({ story }) => {
    const fresh = !seen.has(story.url);
    seen.add(story.url);
    return fresh;
  });
  const scored = unique
    .map((item, order) => ({ item, order, points: score(item.story, topics) }))
    .filter(({ points }) => points > 0)
    .sort((a, b) =>
      a.item.date === b.item.date
        ? b.points - a.points || a.order - b.order
        : b.item.date.localeCompare(a.item.date)
    );
  return scored.length
    ? { matched: true, stories: scored.slice(0, limit).map(({ item }) => item) }
    : { matched: false, stories: unique.slice(0, limit) };
}
