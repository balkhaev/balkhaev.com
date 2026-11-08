export interface Story {
  /** English title and text; the site's own editions carry them. */
  en?: { text: string; title: string };
  source: string;
  text: string;
  title: string;
  /**
   * Topic ids from src/news/topics.ts, set by hand in the archive. Stories
   * without them (new channel editions) are matched by their words.
   */
  topics?: string[];
  url: string;
}

import editions from "../../content/news/editions.json";
import archive from "./archive.json";

export interface Issue {
  date: string;
  post: number | null;
  stories: Story[];
}

// The edition selected for the site's launch was previewed, not posted to Telegram.
export const FIRST_ISSUE: Issue = {
  date: "2026-11-04",
  post: null,
  stories: [
    {
      source: "arXiv",
      text: "Опубликованы веса Dory1.0-4B: модель может повторять внутренние вычисления перед ответом. По словам авторов, дополнительные проходы повышают точность, особенно в программировании и работе с длинными текстами.",
      title: "Dory1.0-4B: открытая модель с регулируемыми вычислениями",
      topics: ["open-models", "inference"],
      url: "https://arxiv.org/abs/2611.03998",
    },
    {
      source: "arXiv",
      text: "Опубликованы веса и код PrimeSim — симулятора, который создаёт согласованные виды с нескольких камер по командам действий. Разработчики могут использовать его для отработки управления роботами.",
      title: "PrimeSim: открытая модель для симуляции действий роботов",
      topics: ["open-models"],
      url: "https://arxiv.org/abs/2611.04870",
    },
    {
      source: "Hugging Face",
      text: "Опубликована ускоренная версия Qwen-Image-2.1 для создания и редактирования картинок по одному или нескольким образцам. Есть веса и пример запуска; лицензия ограничивает коммерческое использование.",
      title: "Вышли веса Qwen-Image-2.1-Lightning-v2-RL",
      topics: ["media", "open-models", "inference"],
      url: "https://huggingface.co/lightx2v/Qwen-Image-2.1-Lightning-v2-RL",
    },
    {
      source: "Hugging Face",
      text: "Вышла Idol Turbo — ускоренная версия Idol для превращения изображения объекта в 3D-представление, совместимая с ComfyUI. По словам авторов, она требует меньше вычислений, но иногда уступает исходной модели по деталям и цвету.",
      title: "Idol Turbo ускоряет создание 3D-объектов по картинке",
      topics: ["media", "inference"],
      url: "https://huggingface.co/akhaliq/idol-turbo",
    },
  ],
};

/**
 * Editions from before the site's digest: real stories of the preceding year,
 * collected from release trackers and news roundups, linked to their sources.
 */
export const ARCHIVE = archive as Issue[];

/**
 * Editions the site collects itself (scripts/collect-news.ts, run daily by
 * .github/workflows/news.yml), newest first.
 */
export const EDITIONS = editions as Issue[];
