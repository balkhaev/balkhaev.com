/**
 * Collects today's AI news edition: reads the sources in src/news/sources.ts,
 * has a model pick and retell the most important items in Russian and
 * English, and adds the edition to content/news/editions.json.
 *
 * Runs daily in .github/workflows/news.yml, which commits the file. The site
 * container polls that file on GitHub (scripts/refresh-news.ts), so a new
 * edition shows up without a redeploy.
 *
 * The editor is Claude (ANTHROPIC_API_KEY). Until the key is set, and on any
 * day the site has no edition of its own, the Telegram digest @bestburyat
 * fills in, so the page never goes stale.
 *
 *   bun scripts/collect-news.ts [--force] [--dry-run]
 */
import { writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { file } from "bun";
import { readIssues } from "../src/news/channel";
import {
  addEdition,
  EDITOR_PROMPT,
  EDITOR_SCHEMA,
  editorInput,
  MIN_STORIES,
  shortlist,
  toStories,
} from "../src/news/collect";
import type { Issue } from "../src/news/content";
import {
  type Candidate,
  parseFeed,
  parsePapers,
  SOURCES,
  type Source,
} from "../src/news/sources";

const EDITIONS = "content/news/editions.json";
const CLAUDE_MODEL = "claude-opus-5-5";
const USER_AGENT = "balkhaev.com news collector (+https://balkhaev.com/news/)";
/** The digest the site showed before it collected news itself. */
const TELEGRAM =
  "https://t.me/s/bestburyat?q=AI+%D0%B7%D0%B0+%D0%B4%D0%B2%D0%B0+%D0%B4%D0%BD%D1%8F";

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const today = new Date().toISOString().slice(0, 10);

async function get(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response;
}

async function read(source: Source): Promise<Candidate[]> {
  const response = await get(source.url);
  return source.kind === "hf-papers"
    ? parsePapers(await response.json(), source.name)
    : parseFeed(await response.text(), source.name);
}

async function claude(input: string) {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    max_tokens: 16_000,
    messages: [{ content: input, role: "user" }],
    model: CLAUDE_MODEL,
    output_config: {
      effort: "medium",
      format: { schema: EDITOR_SCHEMA, type: "json_schema" },
    },
    system: EDITOR_PROMPT,
  });
  if (response.stop_reason === "refusal") {
    throw new Error("The editor declined");
  }
  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  return JSON.parse(text) as unknown;
}

/** Digest editions from Telegram, for the days without the site's own. */
async function telegram(): Promise<Issue[]> {
  try {
    return await readIssues(await get(TELEGRAM));
  } catch (error) {
    console.warn("Telegram:", error instanceof Error ? error.message : error);
    return [];
  }
}

const stored = (await file(EDITIONS).json()) as Issue[];
let editions = stored;
for (const issue of await telegram()) {
  if (!editions.some((known) => known.date === issue.date)) {
    editions = addEdition(editions, issue);
  }
}

async function save() {
  if (editions === stored) {
    return;
  }
  const json = `${JSON.stringify(editions, null, 2)}\n`;
  if (dryRun) {
    console.log(json.slice(0, 4000));
  } else {
    await writeFile(EDITIONS, json);
  }
}

// An edition of the site's own has post: null; a Telegram one gives way to it.
const own = editions.some((issue) => issue.date === today && !issue.post);
if (!process.env.ANTHROPIC_API_KEY) {
  console.log(
    "::warning::Add the ANTHROPIC_API_KEY secret to the production environment: until then the site shows the Telegram digest"
  );
} else if (own && !force) {
  console.log(`Edition ${today} is already there`);
} else {
  const results = await Promise.allSettled(SOURCES.map(read));
  const bySource = SOURCES.map((source, index) => {
    const result = results[index];
    if (result?.status === "fulfilled") {
      console.log(`${source.name}: ${result.value.length} items`);
      return { items: result.value, take: source.take };
    }
    console.warn(`${source.name}: ${result?.reason?.message ?? "failed"}`);
    return { items: [], take: 0 };
  });
  const others = editions.filter((issue) => issue.date !== today);
  const candidates = shortlist(bySource, others);
  console.log(`${candidates.length} fresh candidates`);
  try {
    if (candidates.length < MIN_STORIES) {
      throw new Error("Too few fresh items to make an edition");
    }
    const stories = toStories(
      await claude(editorInput(candidates)),
      candidates
    );
    if (stories.length < MIN_STORIES) {
      throw new Error(`The editor picked ${stories.length} usable stories`);
    }
    editions = addEdition(editions, { date: today, post: null, stories });
    for (const story of stories) {
      console.log(`· ${story.title} — ${story.source}\n  ${story.url}`);
    }
  } catch (error) {
    // Keep what Telegram gave, then fail the run so it is seen.
    await save();
    throw error;
  }
}
await save();
