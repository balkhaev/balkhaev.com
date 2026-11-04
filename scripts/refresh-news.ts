import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { file, sleep } from "bun";
import { readIssues } from "../src/news/channel";
import { FIRST_ISSUE } from "../src/news/content";
import { renderNews } from "../src/news/render";

const feed = new URL("https://t.me/s/bestburyat");
feed.searchParams.set("q", "AI за два дня");

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
  const page = renderNews(issues);
  const target = join(folder, "index.html");
  if ((await file(target).text()) === page) {
    return;
  }
  const temporary = join(folder, `.index-${process.pid}.tmp`);
  await writeFile(temporary, page);
  await rename(temporary, target);
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
