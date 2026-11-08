import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { file, sleep } from "bun";
import { readIssues } from "../src/news/channel";
import { FIRST_ISSUE, type Issue } from "../src/news/content";
import { mergeIssues } from "../src/news/feed";
import { renderNews } from "../src/news/render";

/**
 * The editions the site collects (scripts/collect-news.ts, committed daily by
 * .github/workflows/news.yml). The container picks up new ones from GitHub,
 * so a new edition needs no redeploy.
 */
const feed =
  "https://raw.githubusercontent.com/balkhaev/balkhaev.com/main/content/news/editions.json";

/**
 * The Telegram digest @bestburyat fills the days without an edition of the
 * site's own (before the collector has an API key, or when it fails). It is
 * read here, from the server: Telegram gives GitHub's runners no posts.
 */
const telegram = new URL("https://t.me/s/bestburyat");
telegram.searchParams.set("q", "AI за два дня");

async function own(): Promise<Issue[]> {
  const response = await fetch(feed, {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Editions HTTP ${response.status}`);
  }
  const data: unknown = await response.json();
  return Array.isArray(data) ? (data as Issue[]) : [];
}

async function digest(): Promise<Issue[]> {
  const response = await fetch(telegram, {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Telegram HTTP ${response.status}`);
  }
  return (await readIssues(response)).filter(
    (issue) => issue.date >= FIRST_ISSUE.date
  );
}

async function replace(target: string, content: string) {
  if (
    (await file(target).exists()) &&
    (await file(target).text()) === content
  ) {
    return;
  }
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, target);
}

/** Editions already published, so the widgets keep older stories too. */
async function known(target: string): Promise<Issue[]> {
  try {
    const data = await file(target).json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function refresh(folder: string) {
  const [mine, theirs] = await Promise.allSettled([own(), digest()]);
  for (const result of [mine, theirs]) {
    if (result.status === "rejected") {
      console.error(
        "News source failed",
        result.reason instanceof Error ? result.reason.message : "read error"
      );
    }
  }
  // mergeIssues keeps the first edition per date: the site's own wins.
  const issues = [mine, theirs].flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  if (issues.length === 0) {
    throw new Error("No news source answered");
  }
  const json = join(folder, "feed.json");
  const merged = mergeIssues([...issues, ...(await known(json))]);
  await replace(json, JSON.stringify(merged));
  await replace(join(folder, "index.html"), renderNews(merged));
}

const directory = process.argv.at(2) ?? "dist/news";
const polling = process.argv.includes("--poll");
do {
  try {
    // biome-ignore lint/performance/noAwaitInLoops: one serial refresh per interval
    await refresh(directory);
  } catch (error) {
    console.error(
      "News refresh failed",
      error instanceof Error ? error.message : "read error"
    );
    if (!polling) {
      process.exitCode = 1;
    }
  }
  if (polling) {
    await sleep(15 * 60 * 1000);
  }
} while (polling);
