import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "bun";
import { LANGS, RESUMES } from "../src/cv/content";
import { renderCv } from "../src/cv/render";

// Prints each language of the resume to its committed PDF with a local Chrome or Edge.
const browser = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((path) => path && existsSync(path));
if (!browser) {
  throw new Error("Set CHROME_PATH to a Chrome or Edge executable");
}

const assets = new URL("../public/cv/", import.meta.url);
// A private profile keeps headless Chrome away from a running browser.
const work = await mkdtemp(join(tmpdir(), "balkhaev-cv-"));
try {
  for (const lang of LANGS) {
    const page = join(work, `${lang}.html`);
    const output = fileURLToPath(new URL(RESUMES[lang].pdf, assets));
    // biome-ignore lint/performance/noAwaitInLoops: one headless Chrome at a time
    await writeFile(page, renderCv(lang, assets.href));
    const child = spawn(
      [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-pdf-header-footer",
        "--virtual-time-budget=10000",
        `--user-data-dir=${join(work, "profile")}`,
        `--print-to-pdf=${output}`,
        pathToFileURL(page).href,
      ],
      { stderr: "ignore", stdout: "ignore" }
    );
    if ((await child.exited) !== 0 || !existsSync(output)) {
      throw new Error(`Chrome could not print the ${lang} CV`);
    }
    process.stdout.write(`Printed ${output}\n`);
  }
} finally {
  await rm(work, { force: true, recursive: true });
}
