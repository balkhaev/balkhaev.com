import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { file, sleep } from "bun";
import type { Issue } from "../src/news/content";
import { mergeIssues } from "../src/news/feed";
import { renderNews } from "../src/news/render";

/**
 * The editions the site collects (scripts/collect-news.ts, committed daily by
 * .github/workflows/news.yml). The container picks up new ones from GitHub,
 * so a new edition needs no redeploy.
 */
const feed =
  "https://raw.githubusercontent.com/balkhaev/balkhaev.com/main/content/news/editions.json";

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
    throw new Error(`Editions HTTP ${response.status}`);
  }
  const data: unknown = await response.json();
  const issues = Array.isArray(data) ? (data as Issue[]) : [];
  if (issues.length === 0) {
    return;
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
