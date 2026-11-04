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
 *   --plan <file>                        print, as a JSON list of {slug, lang},
 *                                        the videos whose hash is not in <file>
 *                                        (lines "slug/lang.hash:<hash>", as
 *                                        `grep -r .` prints them); renders nothing
 *   --mute                               no voiceover
 *   --voice-ref <lang>                   make the narrator's reference recording
 *                                        <VOICE_DIR>/<lang>.wav and exit
 *
 * Voiced posts (see src/video/voice.ts) are spoken by scripts/voice.py in the
 * narrator voice from VOICE_DIR (default .video/voice), and each scene is
 * stretched to fit its line. That needs Python with qwen-tts.
 *
 * A render is skipped when video/<slug>/<lang>.hash matches the hash of the
 * inputs (composition, narration, voice), so CI re-renders only what changed.
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
import { parseStoryboard, timeline } from "../src/video/storyboard";
import {
  isVoiced,
  LEAD_IN,
  narration,
  TAIL,
  VOICE_VERSION,
  VOICES,
} from "../src/video/voice";

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
const planIndex = args.indexOf("--plan");
const planFile = planIndex >= 0 ? args[planIndex + 1] : undefined;
const refIndex = args.indexOf("--voice-ref");
const refLang = refIndex >= 0 ? args[refIndex + 1] : undefined;
const VOICE_DIR = process.env.VOICE_DIR ?? join(WORK, "voice");
const slugs = args.filter(
  (arg, index) =>
    !(
      arg.startsWith("--") ||
      ["--lang", "--plan", "--voice-ref"].includes(args[index - 1] ?? "")
    )
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

async function composition(job: Job) {
  const board = parseStoryboard(job.file, await readFile(job.file, "utf8"));
  const page = compose(board, job.lang);
  const voiced = isVoiced(job.slug) && !flag("mute");
  const lines = voiced ? narration(board, job.lang) : [];
  // Silent videos keep the hash they had before voiceover existed.
  const voice = voiced
    ? `${JSON.stringify({ lines, version: VOICE_VERSION, voice: VOICES[job.lang] })}\n`
    : "";
  const hash = new CryptoHasher("sha256")
    .update(`${HYPERFRAMES}\n${flag("draft")}\n${voice}${page}`)
    .digest("hex");
  return { board, hash, lines, page, voiced };
}

async function python(command: string, spec: object, file: string) {
  await writeFile(file, JSON.stringify(spec));
  await run(["python3", "scripts/voice.py", command, file]);
}

/** Makes the narrator's reference recording for one language. */
async function voiceReference(lang: string) {
  const voice = VOICES[lang];
  if (!voice) {
    throw new Error(`no voice for "${lang}"`);
  }
  await mkdir(VOICE_DIR, { recursive: true });
  await python(
    "design",
    { ...voice, out: join(VOICE_DIR, `${lang}.wav`) },
    join(VOICE_DIR, `${lang}.design.json`)
  );
}

/**
 * Speaks the narration and returns the seconds each scene needs for its
 * line, with the files in <dir>/voice.
 */
async function speak(job: Job, lines: string[], dir: string) {
  const voice = VOICES[job.lang];
  const ref = join(VOICE_DIR, `${job.lang}.wav`);
  if (!(voice && (await exists(ref)))) {
    throw new Error(`no narrator voice ${ref}; run --voice-ref ${job.lang}`);
  }
  const out = join(dir, "voice");
  await mkdir(out, { recursive: true });
  await python(
    "speak",
    {
      language: voice.language,
      lines,
      out_dir: out,
      ref_audio: ref,
      ref_text: voice.reference,
    },
    join(out, "spec.json")
  );
  const seconds = JSON.parse(
    await readFile(join(out, "durations.json"), "utf8")
  ) as number[];
  return seconds.map((value) => (value > 0 ? LEAD_IN + value + TAIL : 0));
}

/** Lays the scene lines onto one track and puts it under the video. */
async function mux(silent: string, starts: number[], dir: string, mp4: string) {
  const inputs = starts.flatMap((_, index) => [
    "-i",
    join(dir, "voice", `${index}.wav`),
  ]);
  const delays = starts
    .map(
      (start, index) =>
        `[${index + 1}:a]adelay=${Math.round((start + LEAD_IN) * 1000)}:all=1[a${index}]`
    )
    .join(";");
  const labels = starts.map((_, index) => `[a${index}]`).join("");
  await run([
    "ffmpeg",
    "-loglevel",
    "error",
    "-y",
    "-i",
    silent,
    ...inputs,
    "-filter_complex",
    `${delays};${labels}amix=inputs=${starts.length}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[voice]`,
    "-map",
    "0:v",
    "-map",
    "[voice]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    mp4,
  ]);
}

async function prepare(job: Job, page: string) {
  const dir = join(WORK, `${job.slug}-${job.lang}`);
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
  return dir;
}

async function renderJob(job: Job) {
  const { board, hash, lines, page, voiced } = await composition(job);
  const out = join(OUT, job.slug);
  const mp4 = join(out, `${job.lang}.mp4`);
  const hashFile = join(out, `${job.lang}.hash`);
  if (flag("compose")) {
    process.stdout.write(`composed ${await prepare(job, page)}/index.html\n`);
    return;
  }
  const previous = await readFile(hashFile, "utf8").catch(() => "");
  if (!flag("force") && previous.trim() === hash && (await exists(mp4))) {
    process.stdout.write(`unchanged ${mp4}\n`);
    return;
  }
  await mkdir(out, { recursive: true });
  const work = join(WORK, `${job.slug}-${job.lang}`);
  await rm(work, { force: true, recursive: true });
  const minimum = voiced ? await speak(job, lines, work) : [];
  const dir = await prepare(job, compose(board, job.lang, minimum));
  const timed = timeline(board, minimum);
  const last = timed.at(-1);
  const silent = voiced ? join(dir, "silent.mp4") : mp4;
  process.stdout.write(`rendering ${mp4}\n`);
  await run([
    "npx",
    "--yes",
    HYPERFRAMES,
    "render",
    dir,
    "--output",
    join(process.cwd(), silent),
    "--fps",
    "30",
    "--quality",
    flag("draft") ? "draft" : "standard",
    "--crf",
    flag("draft") ? "32" : "26",
    "--quiet",
  ]);
  if (voiced) {
    await mux(
      silent,
      timed.map((item) => item.start),
      dir,
      mp4
    );
  }
  await writeFile(
    join(out, `${job.lang}.json`),
    `${JSON.stringify({ duration: last ? Math.round(last.start + last.duration) : 0, voiced })}\n`
  );
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

async function plan(file: string) {
  const have = new Set(
    (await readFile(file, "utf8").catch(() => ""))
      .split("\n")
      .map((line) => line.trim().replace(".hash:", ":"))
  );
  const needed: { lang: string; slug: string; voiced: boolean }[] = [];
  for (const job of await jobs()) {
    // biome-ignore lint/performance/noAwaitInLoops: cheap, keeps order
    const { hash, voiced } = await composition(job);
    if (!have.has(`${job.slug}/${job.lang}:${hash}`)) {
      needed.push({ lang: job.lang, slug: job.slug, voiced });
    }
  }
  process.stdout.write(`${JSON.stringify(needed)}\n`);
}

if (refLang !== undefined) {
  await voiceReference(refLang);
  process.exit(0);
}

if (planFile !== undefined) {
  await plan(planFile);
  process.exit(0);
}

const list = await jobs();
if (!list.length) {
  process.stdout.write("no storyboards found\n");
}
for (const job of list) {
  // biome-ignore lint/performance/noAwaitInLoops: renders run one at a time, each uses every core
  await renderJob(job);
}
