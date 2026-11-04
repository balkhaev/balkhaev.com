import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { file, sleep } from "bun";
import { readIssues } from "../src/news/channel";
import { FIRST_ISSUE, type Issue } from "../src/news/content";
import { mergeIssues } from "../src/news/feed";
import { renderNews } from "../src/news/render";

const feed = new URL("https://t.me/s/bestburyat");
feed.searchParams.set("q", "AI за два дня");

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
  const response = await fetch(feed, {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Telegram HTTP ${response.status}`);
  }
  const issues = (await readIssues(response)).filter(
    (issue) => issue.date >= FIRST_ISSUE.date
  );
  if (issues.length === 0) {
    return;
  }
  const json = join(folder, "feed.json");
  await replace(
    json,
    JSON.stringify(mergeIssues([...issues, ...(await known(json))]))
  );
  await replace(join(folder, "index.html"), renderNews(issues));
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
