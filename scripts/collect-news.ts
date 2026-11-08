/**
 * Collects today's AI news edition: reads the sources in src/news/sources.ts,
 * has a model pick and retell the most important items in Russian and
 * English, and adds the edition to content/news/editions.json.
 *
 * Runs daily in .github/workflows/news.yml, which commits the file. The site
 * container polls that file on GitHub (scripts/refresh-news.ts), so a new
 * edition shows up without a redeploy.
 *
 * The editor is Claude when ANTHROPIC_API_KEY is set, otherwise a model from
 * GitHub Models through the workflow's GITHUB_TOKEN.
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
const GITHUB_MODEL = "openai/gpt-4.1";
const USER_AGENT = "balkhaev.com news collector (+https://balkhaev.com/news/)";
/** The digest the site showed before it collected news itself. */
const TELEGRAM =
  "https://t.me/s/bestburyat?q=AI+%D0%B7%D0%B0+%D0%B4%D0%B2%D0%B0+%D0%B4%D0%BD%D1%8F";
const OWN_SINCE = "2026-11-08";

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

async function githubModels(input: string) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("Set ANTHROPIC_API_KEY or GITHUB_TOKEN");
  }
  const response = await fetch(
    "https://models.github.ai/inference/chat/completions",
    {
      body: JSON.stringify({
        max_tokens: 4000,
        messages: [
          { content: EDITOR_PROMPT, role: "system" },
          { content: input, role: "user" },
        ],
        model: GITHUB_MODEL,
        response_format: {
          json_schema: { name: "edition", schema: EDITOR_SCHEMA, strict: true },
          type: "json_schema",
        },
      }),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      method: "POST",
      signal: AbortSignal.timeout(120_000),
    }
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub Models HTTP ${response.status}: ${body.slice(0, 300)}`
    );
  }
  try {
    const data = JSON.parse(body) as {
      choices?: { message?: { content?: string } }[];
    };
    return JSON.parse(data.choices?.[0]?.message?.content ?? "") as unknown;
  } catch (error) {
    throw new Error(`GitHub Models answered: ${body.slice(0, 500)}`, {
      cause: error,
    });
  }
}

/** Digest editions from Telegram, kept for the days before the site's own. */
async function telegram(): Promise<Issue[]> {
  try {
    const issues = await readIssues(await get(TELEGRAM));
    return issues.filter((issue) => issue.date < OWN_SINCE);
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

if (editions.some((issue) => issue.date === today) && !force) {
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
  if (candidates.length < MIN_STORIES) {
    throw new Error("Too few fresh items to make an edition");
  }
  const input = editorInput(candidates);
  const answer = process.env.ANTHROPIC_API_KEY
    ? await claude(input)
    : await githubModels(input);
  const stories = toStories(answer, candidates);
  if (stories.length < MIN_STORIES) {
    throw new Error(`The editor picked ${stories.length} usable stories`);
  }
  editions = addEdition(editions, { date: today, post: null, stories });
  for (const story of stories) {
    console.log(`· ${story.title} — ${story.source}\n  ${story.url}`);
  }
}

if (editions !== stored) {
  const json = `${JSON.stringify(editions, null, 2)}\n`;
  if (dryRun) {
    console.log(json.slice(0, 4000));
  } else {
    await writeFile(EDITIONS, json);
  }
}
