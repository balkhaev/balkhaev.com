import type { Issue } from "./content";

const ENTITY = /&(#x[\da-f]+|#\d+|[a-z][\da-z]*);/gi;
const HEADER = /^🗞[\ufe0e\ufe0f]? AI за два дня · (\d{1,2}) ([а-я]+)$/u;
const STAMP =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const WEB = /^https?:\/\//i;
// biome-ignore lint/suspicious/noControlCharactersInRegex: reject controls in raw URL attributes
const INVALID_URL = /[\u0000-\u0020\u007f\\]/u;
const POST = /^bestburyat\/(\d+)$/;
const ARROW = /^↗[\ufe0e\ufe0f]?$/u;

interface Piece {
  bold: boolean;
  link: number | null;
  text: string;
}
interface Message {
  bodies: number;
  invalid: boolean;
  lines: Piece[][];
  links: string[];
  post: number;
  times: string[];
}

const months = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
// Telegram escapes text, not HTML fragments. Decode once, after joining chunks.
const entities: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  euro: "€",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: "\u00a0",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
};

function decode(value: string): string {
  return value.replace(ENTITY, (_, entity: string) => {
    if (!entity.startsWith("#")) {
      const decoded = entities[entity];
      if (decoded === undefined) {
        throw new Error("Unknown text entity");
      }
      return decoded;
    }
    const hex = entity[1]?.toLowerCase() === "x";
    const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (
      point === 0 ||
      point > 0x10_ff_ff ||
      (point >= 0xd8_00 && point <= 0xdf_ff)
    ) {
      throw new Error("Invalid character reference");
    }
    return String.fromCodePoint(point);
  });
}

function validDay(year: number, month: number, day: number): boolean {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function issueDate(heading: string, times: string[]): string | null {
  const match = HEADER.exec(heading);
  if (!match || times.length !== 1) {
    return null;
  }
  const time = STAMP.exec(times[0] ?? "");
  if (!(time && Number.isFinite(Date.parse(times[0] ?? "")))) {
    return null;
  }
  let year = Number(time[1]);
  const postedMonth = Number(time[2]);
  if (!validDay(year, postedMonth, Number(time[3]))) {
    return null;
  }
  const month = months.indexOf(match[2] ?? "") + 1;
  // A December digest may be posted (or manually corrected) in January.
  if (month === 12 && postedMonth === 1) {
    year -= 1;
  }
  const day = Number(match[1]);
  if (!(month && validDay(year, month, day))) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function safeUrl(raw: string): string | null {
  const value = decode(raw).trim();
  if (!WEB.test(value) || INVALID_URL.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.hostname && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

const emoji =
  /^(?:\p{Extended_Pictographic}[\ufe0e\ufe0f]?\p{Emoji_Modifier}?(?:\u200d\p{Extended_Pictographic}[\ufe0e\ufe0f]?\p{Emoji_Modifier}?)*)\s*/u;

function lineText(pieces: Piece[]): string {
  return pieces
    .map((piece) => piece.text)
    .join("")
    .trim();
}

function readStory(lines: Piece[][], links: string[]) {
  const [headline = [], body = [], sourceLine = []] = lines;
  const fullTitle = lineText(headline);
  const title = fullTitle.replace(emoji, "").trim();
  const boldTitle = lineText(headline.filter((piece) => piece.bold))
    .replace(emoji, "")
    .trim();
  if (!title || title === fullTitle || title !== boldTitle) {
    return null;
  }
  const references = sourceLine.filter((piece) => piece.link !== null);
  const id = references[0]?.link;
  const source = lineText(references);
  if (
    !source ||
    typeof id !== "number" ||
    references.some((piece) => piece.link !== id)
  ) {
    return null;
  }
  const arrow = lineText(sourceLine.filter((piece) => piece.link === null));
  if (!(ARROW.test(arrow) && lineText(sourceLine).startsWith(arrow))) {
    return null;
  }
  const url = safeUrl(links[id] ?? "");
  return url ? { source, text: lineText(body), title, url } : null;
}

function parse(message: Message): Issue | null {
  if (message.invalid || message.bodies !== 1) {
    return null;
  }
  try {
    const lines = message.lines
      .map((line) =>
        line.map((piece) => ({ ...piece, text: decode(piece.text) }))
      )
      .filter((line) => lineText(line));
    const date = issueDate(lineText(lines.shift() ?? []), message.times);
    if (
      !(date && lines.length) ||
      lines.length > 12 ||
      lines.length % 3 !== 0
    ) {
      return null;
    }
    const stories: Issue["stories"] = [];
    for (let i = 0; i < lines.length; i += 3) {
      const story = readStory(lines.slice(i, i + 3), message.links);
      if (!story) {
        return null;
      }
      stories.push(story);
    }
    return { date, post: message.post, stories };
  } catch {
    return null;
  }
}

/** Read compose-format digests only; no Telegram HTML is returned to callers. */
export async function readIssues(response: Response): Promise<Issue[]> {
  const messages: Message[] = [];
  let current: Message | null = null;
  let body = false;
  let bold = 0;
  let link: number | null = null;
  // biome-ignore lint/correctness/noUndeclaredVariables: HTMLRewriter is provided by Bun
  const rewriter = new HTMLRewriter()
    .on(".tgme_widget_message", {
      element(element) {
        const previous = current;
        const match = POST.exec(element.getAttribute("data-post") ?? "");
        const post = Number(match?.[1]);
        current =
          match && Number.isSafeInteger(post) && post > 0
            ? {
                bodies: 0,
                invalid: false,
                lines: [[]],
                links: [],
                post,
                times: [],
              }
            : null;
        if (current) {
          messages.push(current);
        }
        element.onEndTag(() => {
          current = previous;
        });
      },
    })
    .on(".tgme_widget_message time", {
      element(element) {
        if (current) {
          current.times.push(element.getAttribute("datetime") ?? "");
        }
      },
    })
    .on(".tgme_widget_message_text", {
      element(element) {
        if (!current) {
          return;
        }
        current.bodies += 1;
        body = true;
        bold = 0;
        link = null;
        element.onEndTag(() => {
          body = false;
        });
      },
      text(chunk) {
        if (!(current && body && chunk.text)) {
          return;
        }
        const line = current.lines.at(-1);
        if (!line) {
          return;
        }
        const last = line.at(-1);
        if (last && last.bold === bold > 0 && last.link === link) {
          last.text += chunk.text;
        } else {
          line.push({ bold: bold > 0, link, text: chunk.text });
        }
      },
    })
    .on(".tgme_widget_message_text *", {
      element(element) {
        if (!(current && body)) {
          return;
        }
        const tag = element.tagName;
        if (tag === "br") {
          current.lines.push([]);
        } else if (tag === "b" || tag === "strong") {
          bold += 1;
          element.onEndTag(() => {
            bold -= 1;
          });
        } else if (tag === "a") {
          if (link !== null) {
            current.invalid = true;
          }
          const previous = link;
          link = current.links.push(element.getAttribute("href") ?? "") - 1;
          element.onEndTag(() => {
            link = previous;
          });
        } else if (!["i", "em", "span", "mark"].includes(tag)) {
          current.invalid = true;
        }
      },
    });
  await rewriter.transform(response).text();
  return messages
    .map(parse)
    .filter((issue): issue is Issue => issue !== null)
    .sort((a, b) => (b.post ?? 0) - (a.post ?? 0));
}
