import type { Scene, Storyboard } from "./storyboard";

/**
 * Voiceover for the post videos. Every scene gets one narration line: its
 * `voice` field when the storyboard sets one, otherwise a line built from the
 * scene's own text. scripts/voice.py speaks the lines with Qwen3-TTS (Apache
 * 2.0) in one narrator voice per language, and scripts/video.ts stretches each
 * scene to fit its line.
 */

/**
 * Names the narrator: the speech model plus the reference recording made
 * from VOICES. Bump it to re-voice every video with a new reference.
 */
export const VOICE_VERSION = "qwen3-tts-v2";

/** Posts whose videos are voiced: "all", or a list of slugs. */
export const VOICED: string[] | "all" = "all";

export function isVoiced(slug: string): boolean {
  return VOICED === "all" || VOICED.includes(slug);
}

export interface VoiceConfig {
  /** How VoiceDesign describes the narrator when the reference is made. */
  instruct: string;
  /** Language name as Qwen3-TTS expects it. */
  language: string;
  /** What the narrator says in the reference recording. */
  reference: string;
}

export const VOICES: Record<string, VoiceConfig> = {
  en: {
    instruct:
      "A calm, confident male narrator in his thirties with a warm, mid-low voice. Clear studio recording, brisk, energetic pace, to the point, like a fast-moving tech explainer video.",
    language: "English",
    reference:
      "Today we will take one idea from the concept to a working system. Step by step, without extra theory, and with the numbers that matter.",
  },
  ru: {
    instruct:
      "Спокойный уверенный мужской голос диктора, около тридцати лет, тёплый тембр средней высоты. Чистая студийная запись, бодрый быстрый темп, энергично и по делу, как в динамичном видео, которое объясняет технологию.",
    language: "Russian",
    reference:
      "Сегодня мы проведём одну идею от концепции до работающей системы. По шагам, без лишней теории и с цифрами, которые важны.",
  },
};

/** Silence before a scene's line and after it, in seconds. */
export const LEAD_IN = 0.15;
export const TAIL = 0.3;
/** Playback speed of the narration: the model speaks a little slowly. */
export const SPEED = 1.12;

const ACCENT = /\*([^*]+)\*/g;
const END_PUNCT = /[.!?…:]$/;
const CAPITALIZED = /^\p{Lu}\p{Ll}/u;
const FIRST_SENTENCE = /^.+?[.!?…](?=\s+\p{Lu}|$)/su;
/** A list item's key is the part before its colon, if that is short. */
const ITEM_KEY = /^([^:]+):\s/;
const KEY_WORDS = 3;
const SPACES = /\s+/;

interface Words {
  and: string;
  currency: (amount: string) => string;
  gb: string;
  multiply: string;
  percent: string;
  range: (from: string, to: string) => string;
  tb: string;
  times: string;
}

const WORDS: Record<string, Words> = {
  en: {
    and: "and",
    currency: (amount) => `${amount} dollars`,
    gb: "gigabytes",
    multiply: "times",
    percent: "percent",
    range: (from, to) => `${from} to ${to}`,
    tb: "terabytes",
    times: "times",
  },
  ru: {
    and: "и",
    currency: (amount) => `${amount} долларов`,
    gb: "гигабайт",
    multiply: "умножить на",
    percent: "процентов",
    range: (from, to) => `от ${from} до ${to}`,
    tb: "терабайт",
    times: "раза",
  },
};

function sentence(text: string): string {
  const trimmed = text.trim();
  return END_PUNCT.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Rewrites symbols and units the way a narrator would say them. */
export function speakable(text: string, lang: string): string {
  const words = (WORDS[lang] ?? WORDS.en) as Words;
  return text
    .replace(ACCENT, "$1")
    .replace(/\$\s?(\d+(?:[.,]\d+)?)/g, (_, amount) => words.currency(amount))
    .replace(/(\d+(?:[.,]\d+)?)\s?[–—-]\s?(\d+(?:[.,]\d+)?)/g, (_, from, to) =>
      words.range(from, to)
    )
    .replace(/(\d)\s?%/g, `$1 ${words.percent}`)
    .replace(/(\d)\s?×/g, `$1 ${words.times}`)
    .replace(/(\d)\s?(ГБ|GB)(?!\p{L})/gu, `$1 ${words.gb}`)
    .replace(/(\d)\s?(ТБ|TB)(?!\p{L})/gu, `$1 ${words.tb}`)
    .replace(/\s×\s/g, ` ${words.multiply} `)
    .replace(/\s[–—]\s/g, ", ")
    .replace(/\s*→\s*/g, ", ")
    .replace(/\s*&\s*/g, ` ${words.and} `)
    .replace(/[«»"“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Knowledge goes stale" → "knowledge goes stale", but "MCP" stays. */
function lowerFirst(text: string): string {
  return CAPITALIZED.test(text)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}

/** The first sentence of a text: captions are cut to it. */
function firstSentence(text: string | undefined): string {
  const trimmed = (text ?? "").trim();
  return trimmed.match(FIRST_SENTENCE)?.[0] ?? trimmed;
}

/** "*Модель*: понимает вопрос" → "Модель"; long keys are dropped. */
function itemKeys(items: string[]): string {
  const keys = items.map(
    (item) => item.replace(ACCENT, "$1").match(ITEM_KEY)?.[1]?.trim() ?? ""
  );
  const short = keys.every(
    (key) => key && key.split(SPACES).length <= KEY_WORDS
  );
  return short
    ? keys.map((key, index) => (index ? lowerFirst(key) : key)).join(", ")
    : "";
}

/**
 * The narration line of a scene, before `speakable`. It stays short: the
 * screen already shows the details, the narrator says the point.
 */
function sceneLine(scene: Scene): string {
  if (scene.voice) {
    return scene.voice;
  }
  const parts: string[] = [];
  switch (scene.type) {
    case "title":
      parts.push(scene.title);
      break;
    case "statement":
      parts.push(scene.text);
      break;
    case "list":
      parts.push(scene.heading, itemKeys(scene.items));
      break;
    case "compare": {
      const pick = scene.columns.find((column) => column.pick);
      parts.push(
        scene.heading,
        firstSentence(scene.say),
        pick ? `${pick.title}: ${lowerFirst(pick.points[0] ?? "")}` : ""
      );
      break;
    }
    case "diagram":
      parts.push(scene.heading);
      break;
    case "end":
      parts.push(scene.text);
      break;
    default:
      break;
  }
  if (scene.type !== "end" && scene.type !== "compare") {
    parts.push(firstSentence(scene.say));
  }
  return parts
    .filter((part) => part.trim())
    .map(sentence)
    .join(" ");
}

/** One narration line per scene, ready for the speech model. */
export function narration(board: Storyboard, lang: string): string[] {
  return board.scenes.map((scene) => speakable(sceneLine(scene), lang));
}
