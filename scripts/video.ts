/**
 * Renders the post videos: content/blog/<slug>/video.<lang>.yml →
 * HyperFrames composition → video/<slug>/<lang>.mp4 (+ .jpg poster).
 *
 *   bun scripts/video.ts                 every storyboard that changed
 *   bun scripts/video.ts agent-concept   only these slugs
 *   --lang ru                            only one language
 *   --force                              re-render even if unchanged
 *   --draft                              fast low-quality render
 *   --compose                            write the compositions, do not render
 *
 * A render is skipped when video/<slug>/<lang>.hash matches the hash of the
 * composition, so CI re-renders only what changed.
 */
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { CryptoHasher, spawn } from "bun";
import { compose } from "../src/video/compose";
import { parseStoryboard } from "../src/video/storyboard";

export const HYPERFRAMES = "hyperframes@0.9.11";
const CONTENT = "content/blog";
const WORK = ".video";
const OUT = "video";
const STORYBOARD = /^video\.([a-z]{2})\.yml$/;
const FONTS: Record<string, string> = {
  "mono-cyrillic-400.woff2":
    "public/fonts/ibm-plex-mono-cyrillic-400-normal.woff2",
  "mono-cyrillic-500.woff2":
    "public/fonts/ibm-plex-mono-cyrillic-500-normal.woff2",
  "mono-latin-400.woff2": "public/fonts/ibm-plex-mono-latin-400-normal.woff2",
  "mono-latin-500.woff2": "public/fonts/ibm-plex-mono-latin-500-normal.woff2",
  "plex-cyrillic.woff2": "public/cv/fonts/plex-cyrillic.woff2",
  "plex-latin.woff2": "public/cv/fonts/plex-latin.woff2",
};

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const langIndex = args.indexOf("--lang");
const onlyLang = langIndex >= 0 ? args[langIndex + 1] : undefined;
const slugs = args.filter(
  (arg, index) => !arg.startsWith("--") && args[index - 1] !== "--lang"
);

async function run(argv: string[]) {
  const child = spawn(argv, { stderr: "inherit", stdout: "inherit" });
  if ((await child.exited) !== 0) {
    throw new Error(`${argv.slice(0, 3).join(" ")} failed`);
  }
}

async function exists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

interface Job {
  file: string;
  lang: string;
  slug: string;
}

async function jobs(): Promise<Job[]> {
  const folders = (await readdir(CONTENT))
    .filter((slug) => !slugs.length || slugs.includes(slug))
    .sort();
  const listed = await Promise.all(
    folders.map(async (slug) => {
      const files = await readdir(join(CONTENT, slug)).catch(() => []);
      return files.flatMap((name) => {
        const lang = STORYBOARD.exec(name)?.[1];
        return lang && (!onlyLang || lang === onlyLang)
          ? [{ file: join(CONTENT, slug, name), lang, slug }]
          : [];
      });
    })
  );
  return listed.flat();
}

async function prepare(job: Job) {
  const board = parseStoryboard(job.file, await readFile(job.file, "utf8"));
  const page = compose(board, job.lang);
  const dir = join(WORK, `${job.slug}-${job.lang}`);
  await rm(dir, { force: true, recursive: true });
  await mkdir(join(dir, "fonts"), { recursive: true });
  await writeFile(join(dir, "index.html"), page);
  await copyFile(
    "node_modules/gsap/dist/gsap.min.js",
    join(dir, "gsap.min.js")
  );
  await Promise.all(
    Object.entries(FONTS).map(([name, source]) =>
      copyFile(source, join(dir, "fonts", name))
    )
  );
  const hash = new CryptoHasher("sha256")
    .update(`${HYPERFRAMES}\n${flag("draft")}\n${page}`)
    .digest("hex");
  return { dir, hash };
}

async function renderJob(job: Job) {
  const { dir, hash } = await prepare(job);
  const out = join(OUT, job.slug);
  const mp4 = join(out, `${job.lang}.mp4`);
  const hashFile = join(out, `${job.lang}.hash`);
  if (flag("compose")) {
    process.stdout.write(`composed ${dir}/index.html\n`);
    return;
  }
  const previous = await readFile(hashFile, "utf8").catch(() => "");
  if (!flag("force") && previous.trim() === hash && (await exists(mp4))) {
    process.stdout.write(`unchanged ${mp4}\n`);
    return;
  }
  await mkdir(out, { recursive: true });
  process.stdout.write(`rendering ${mp4}\n`);
  await run([
    "npx",
    "--yes",
    HYPERFRAMES,
    "render",
    dir,
    "--output",
    join(process.cwd(), mp4),
    "--fps",
    "30",
    "--quality",
    flag("draft") ? "draft" : "standard",
    "--crf",
    flag("draft") ? "32" : "26",
    "--quiet",
  ]);
  // Poster: the title card once it has settled.
  await run([
    "ffmpeg",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    "2.5",
    "-i",
    mp4,
    "-frames:v",
    "1",
    "-vf",
    "scale=1280:-2",
    "-q:v",
    "4",
    join(out, `${job.lang}.jpg`),
  ]);
  await writeFile(hashFile, `${hash}\n`);
}

const list = await jobs();
if (!list.length) {
  process.stdout.write("no storyboards found\n");
}
for (const job of list) {
  // biome-ignore lint/performance/noAwaitInLoops: renders run one at a time, each uses every core
  await renderJob(job);
}
