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
  gpu: {
    label: { en: "GPUs and chips", ru: "GPU и чипы" },
    words: [
      "GPU",
      "видеокарт",
      "чип",
      "chip",
      "ускорител",
      "accelerator",
      "TPU",
      "H100",
      "B200",
      "NVIDIA",
      "Cerebras",
      "Groq",
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
  media: {
    label: { en: "Images and video", ru: "Картинки и видео" },
    words: [
      "изображен",
      "картин",
      "image",
      "видео",
      "video",
      "ComfyUI",
      "FLUX",
      "Stable Diffusion",
      "3D",
    ],
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
  training: {
    label: { en: "Fine-tuning", ru: "Дообучение" },
    words: [
      "дообуч",
      "fine-tun",
      "finetun",
      "post-train",
      "LoRA!",
      "QLoRA!",
      "Unsloth",
      "Axolotl",
      "TRL!",
      "DPO!",
      "GRPO!",
      "RLHF",
      "дистилл",
      "distill",
      "датасет",
      "dataset",
    ],
  },
  voice: {
    label: { en: "Voice", ru: "Голос" },
    words: [
      "голос",
      "voice",
      "речи",
      "речь",
      "speech",
      "TTS!",
      "ASR!",
      "транскри",
      "transcri",
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

/**
 * How well a story fits the topics; 0 means it does not. A story tagged by
 * hand fits when it shares a tag. An untagged one must name a topic word in
 * its title: a word only in the text is too often a passing mention.
 */
export function score(story: Story, topics: TopicId[]) {
  if (story.topics) {
    return 10 * topics.filter((id) => story.topics?.includes(id)).length;
  }
  let total = 0;
  let titled = false;
  for (const id of topics) {
    const matcher = MATCHERS[id];
    const inTitle = story.title.match(matcher)?.length ?? 0;
    titled ||= inTitle > 0;
    total += 2 * inTitle + (story.text.match(matcher)?.length ?? 0);
  }
  return titled ? total : 0;
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

/** How far around a post's date its widget looks first: about two months. */
export const NEAR_DAYS = 60;
const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A small stable string hash: the same slug always picks the same slice. */
function hash(text: string) {
  let value = 7;
  for (const char of text) {
    value = (value * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003;
  }
  return value;
}

const distance = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

/**
 * Stories for a widget: those that mention the topics, newest edition first
 * and the stronger match first within an edition. With `near` (a post's date),
 * matches within NEAR_DAYS of it come first, closest first, then the other
 * matches. With no match the list is empty and the widget stays hidden.
 */
export function pickStories(
  issues: Issue[],
  topics: TopicId[],
  limit: number,
  near?: string,
  /**
   * Any stable string, such as a post slug. Without stories near the date,
   * it picks which slice of the top matches to show, so posts on one topic
   * do not all show the same three stories.
   */
  seed?: string
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
  const close = (item: Pick) =>
    near !== undefined &&
    DATE.test(near) &&
    distance(item.date, near) <= NEAR_DAYS;
  const scored = unique
    .map((item, order) => ({ item, order, points: score(item.story, topics) }))
    .filter(({ points }) => points > 0)
    .sort(
      (a, b) =>
        Number(close(b.item)) - Number(close(a.item)) ||
        (close(a.item) && near
          ? distance(a.item.date, near) - distance(b.item.date, near)
          : 0) ||
        (a.item.date === b.item.date
          ? b.points - a.points || a.order - b.order
          : b.item.date.localeCompare(a.item.date))
    );
  if (scored.length === 0) {
    return { matched: false, stories: [] };
  }
  const nearFirst = scored[0] && close(scored[0].item);
  const pool = scored.slice(0, limit * 3);
  const windows = Math.ceil(pool.length / limit);
  const start = seed && !nearFirst ? (hash(seed) % windows) * limit : 0;
  const chosen = [...pool.slice(start), ...pool.slice(0, start)].slice(
    0,
    limit
  );
  if (start) {
    chosen.sort((a, b) => b.item.date.localeCompare(a.item.date));
  }
  return { matched: true, stories: chosen.map(({ item }) => item) };
}
