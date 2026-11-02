import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "bun";

// Prints public/cv/index.html to the committed PDF with a local Chrome or Edge.
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

const page = new URL("../public/cv/index.html", import.meta.url);
const output = fileURLToPath(
  new URL("../public/cv/balkhaev-cv.pdf", import.meta.url)
);
// A private profile keeps headless Chrome away from a running browser.
const profile = await mkdtemp(join(tmpdir(), "balkhaev-cv-"));
try {
  const child = spawn(
    [
      browser,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-pdf-header-footer",
      "--virtual-time-budget=10000",
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${output}`,
      page.href,
    ],
    { stderr: "ignore", stdout: "ignore" }
  );
  if ((await child.exited) !== 0 || !existsSync(output)) {
    throw new Error("Chrome could not print the CV");
  }
} finally {
  await rm(profile, { force: true, recursive: true });
}
process.stdout.write(`Printed ${output}\n`);
