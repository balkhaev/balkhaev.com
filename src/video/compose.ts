import type {
  CompareScene,
  DiagramNode,
  DiagramScene,
  EndScene,
  ListScene,
  Scene,
  StatementScene,
  Storyboard,
  TimedScene,
  TitleScene,
} from "./storyboard";
import { timeline } from "./storyboard";

/**
 * Turns a storyboard into a single-file HyperFrames composition: every scene
 * is a timed `.clip`, and one paused GSAP timeline (registered on
 * `window.__timelines`) animates all of them at absolute times. The look
 * follows the blog: paper, ink, one orange accent, IBM Plex.
 */

export const WIDTH = 1920;
export const HEIGHT = 1080;
const MARGIN = 120;
const GRID_TOP = 290;
const ROW = 110;
const COL = (WIDTH - 2 * MARGIN) / 12;
const GAP = 24;
const NODE_HEIGHT = 96;
const ARROW = 14;

const ENTITIES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
const SPECIAL = /["&<>]/g;
const ACCENT = /\*([^*]+)\*/g;
const SPACE = /\s+/;

function html(value: string) {
  return value.replace(SPECIAL, (char) => ENTITIES[char] ?? char);
}

/** Escapes text and turns `*word*` into the accent span. */
export function inline(value: string) {
  return html(value).replace(ACCENT, '<em class="acc">$1</em>');
}

/**
 * Text split into words, each in a clipping wrapper so it can rise into
 * view. Accent markup may span several words.
 */
export function words(value: string) {
  // Each word is a list of pieces, so "*источники*." stays one word.
  const list: { accent: boolean; text: string }[][] = [];
  let glue = false;
  const push = (text: string, accent: boolean) => {
    const parts = text.split(SPACE);
    parts.forEach((part, index) => {
      if (index > 0) {
        glue = false;
      }
      if (part) {
        const prev = list.at(-1);
        if (glue && prev) {
          prev.push({ accent, text: part });
        } else {
          list.push([{ accent, text: part }]);
        }
        glue = true;
      }
    });
  };
  let last = 0;
  for (const match of value.matchAll(ACCENT)) {
    push(value.slice(last, match.index), false);
    push(match[1] ?? "", true);
    last = (match.index ?? 0) + match[0].length;
  }
  push(value.slice(last), false);
  return list
    .map(
      (pieces) =>
        `<span class="w"><span class="wi">${pieces
          .map((piece) =>
            piece.accent
              ? `<em class="acc">${html(piece.text)}</em>`
              : html(piece.text)
          )
          .join("")}</span></span>`
    )
    .join(" ");
}

/** Collects GSAP calls; times are seconds from the start of the video. */
class Motion {
  readonly lines: string[] = [];

  from(selector: string, vars: string, at: number) {
    this.lines.push(`tl.from(${JSON.stringify(selector)}, ${vars}, ${at.toFixed(2)});`);
  }

  to(selector: string, vars: string, at: number) {
    this.lines.push(`tl.to(${JSON.stringify(selector)}, ${vars}, ${at.toFixed(2)});`);
  }

  set(selector: string, vars: string, at: number) {
    this.lines.push(`tl.set(${JSON.stringify(selector)}, ${vars}, ${at.toFixed(2)});`);
  }

  /** Words of a text block rise into view one after another. */
  rise(selector: string, at: number, stagger = 0.035) {
    this.from(
      `${selector} .wi`,
      `{ yPercent: 110, duration: 0.7, ease: "expo.out", stagger: ${stagger} }`,
      at
    );
  }

  /** Slides an element in from the left. */
  slide(selector: string, at: number) {
    this.from(
      selector,
      `{ x: -40, opacity: 0, duration: 0.6, ease: "expo.out" }`,
      at
    );
  }

  /** Draws a horizontal rule from the left. */
  rule(selector: string, at: number) {
    this.from(
      selector,
      `{ scaleX: 0, transformOrigin: "0 50%", duration: 0.8, ease: "expo.inOut" }`,
      at
    );
  }
}

/** Times for `count` beats spread over the useful part of a scene. */
function beats(count: number, start: number, duration: number, from = 0.7) {
  const span = Math.max(0.5, duration * 0.6 - from);
  const step = count > 1 ? span / (count - 1) : 0;
  return Array.from({ length: count }, (_, index) => start + from + index * step);
}

interface Part {
  body: string;
}

function label(text: string | undefined) {
  return text ? `<div class="label">${inline(text)}</div>` : "";
}

function title(scene: TitleScene, id: string, t: TimedScene, m: Motion): Part {
  m.slide(`#${id} .kicker`, t.start + 0.1);
  m.rise(`#${id} .title`, t.start + 0.25, 0.05);
  m.slide(`#${id} .subtitle`, t.start + 1.1);
  m.rule(`#${id} .bar`, t.start + 0.2);
  return {
    body: `<div class="bar"></div>
      ${scene.kicker ? `<div class="kicker">${inline(scene.kicker)}</div>` : ""}
      <h1 class="title">${words(scene.title)}</h1>
      ${scene.subtitle ? `<p class="subtitle">${inline(scene.subtitle)}</p>` : ""}`,
  };
}

function statement(
  scene: StatementScene,
  id: string,
  t: TimedScene,
  m: Motion
): Part {
  m.slide(`#${id} .label`, t.start + 0.1);
  m.rise(`#${id} .statement`, t.start + 0.25);
  return {
    body: `${label(scene.label)}
      <p class="statement">${words(scene.text)}</p>`,
  };
}

function list(scene: ListScene, id: string, t: TimedScene, m: Motion): Part {
  m.slide(`#${id} .label`, t.start + 0.1);
  m.rise(`#${id} .heading`, t.start + 0.2);
  const times = beats(scene.items.length, t.start, t.duration);
  const rows = scene.items.map((item, index) => {
    const at = times[index] ?? t.start;
    m.rule(`#${id} .row-${index} .row-line`, at);
    m.slide(`#${id} .row-${index} .row-text`, at + 0.1);
    m.slide(`#${id} .row-${index} .row-no`, at + 0.05);
    const mark = scene.numbered ? String(index + 1).padStart(2, "0") : "—";
    return `<li class="row row-${index}"><span class="row-line"></span><span class="row-no">${mark}</span><span class="row-text">${inline(item)}</span></li>`;
  });
  const split = scene.items.length > 6;
  const style = split
    ? ` style="grid-template-rows: repeat(${Math.ceil(scene.items.length / 2)}, auto)"`
    : "";
  return {
    body: `${label(scene.label)}
      <h2 class="heading">${words(scene.heading)}</h2>
      <ol class="rows${split ? " split" : ""}"${style}>${rows.join("")}</ol>`,
  };
}

function compare(
  scene: CompareScene,
  id: string,
  t: TimedScene,
  m: Motion
): Part {
  m.slide(`#${id} .label`, t.start + 0.1);
  m.rise(`#${id} .heading`, t.start + 0.2);
  const times = beats(scene.columns.length, t.start, t.duration, 0.8);
  const columns = scene.columns.map((column, index) => {
    const at = times[index] ?? t.start;
    const sel = `#${id} .col-${index}`;
    m.rule(`${sel} .col-line`, at);
    m.slide(`${sel} .col-title`, at + 0.1);
    m.from(
      `${sel} li`,
      `{ y: 24, opacity: 0, duration: 0.5, ease: "expo.out", stagger: 0.12 }`,
      at + 0.3
    );
    if (column.pick) {
      m.from(
        `${sel} .col-fill`,
        `{ scaleY: 0, transformOrigin: "50% 0%", duration: 0.7, ease: "expo.inOut" }`,
        at + 0.6
      );
    }
    const points = column.points.map((point) => `<li>${inline(point)}</li>`);
    return `<div class="col col-${index}${column.pick ? " pick" : ""}">
          ${column.pick ? '<span class="col-fill"></span>' : ""}
          <span class="col-line"></span>
          <h3 class="col-title">${inline(column.title)}</h3>
          <ul>${points.join("")}</ul>
        </div>`;
  });
  return {
    body: `${label(scene.label)}
      <h2 class="heading">${words(scene.heading)}</h2>
      <div class="cols cols-${scene.columns.length}">${columns.join("")}</div>`,
  };
}

interface Box {
  h: number;
  w: number;
  x: number;
  y: number;
}

export function nodeBox(node: DiagramNode): Box {
  const span = node.w ?? 3;
  return {
    h: NODE_HEIGHT,
    w: span * COL - GAP,
    x: MARGIN + node.col * COL + GAP / 2,
    y: GRID_TOP + node.row * ROW,
  };
}

/** Where the segment from the box centre towards (dx, dy) leaves the box. */
function exitPoint(box: Box, dx: number, dy: number, pad: number) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : (box.w / 2 + pad) / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : (box.h / 2 + pad) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** The visible part of an edge: from the border of one box to the other. */
export function edgeLine(from: Box, to: Box) {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  const a = exitPoint(from, dx, dy, 6);
  const b = exitPoint(to, -dx, -dy, 6);
  return { x1: a.x, x2: b.x, y1: a.y, y2: b.y };
}

function arrowHead(x: number, y: number, angle: number) {
  const points = [
    [0, 0],
    [-ARROW, -ARROW / 2],
    [-ARROW, ARROW / 2],
  ].map(([px = 0, py = 0]) => {
    const rx = px * Math.cos(angle) - py * Math.sin(angle) + x;
    const ry = px * Math.sin(angle) + py * Math.cos(angle) + y;
    return `${rx.toFixed(1)},${ry.toFixed(1)}`;
  });
  return `<polygon points="${points.join(" ")}" />`;
}

function diagram(
  scene: DiagramScene,
  id: string,
  t: TimedScene,
  m: Motion
): Part {
  m.slide(`#${id} .label`, t.start + 0.1);
  m.rise(`#${id} .heading`, t.start + 0.2);
  const steps = [...new Set(scene.nodes.map((node) => node.step ?? 0))].sort(
    (a, b) => a - b
  );
  const times = beats(steps.length, t.start, t.duration, 0.8);
  const shownAt = new Map<string, number>();
  const boxes = new Map<string, Box>();
  const nodes = scene.nodes.map((node, index) => {
    const box = nodeBox(node);
    boxes.set(node.id, box);
    const at = times[steps.indexOf(node.step ?? 0)] ?? t.start;
    shownAt.set(node.id, at);
    m.from(
      `#${id} .node-${index}`,
      `{ y: 20, opacity: 0, duration: 0.55, ease: "expo.out" }`,
      at
    );
    const style = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
    return `<div class="node node-${index}${node.accent ? " accent" : ""}" style="${style}">
          <strong>${inline(node.label)}</strong>${node.sub ? `<span>${inline(node.sub)}</span>` : ""}
        </div>`;
  });
  const edges = scene.edges.map((edge, index) => {
    const from = boxes.get(edge.from) as Box;
    const to = boxes.get(edge.to) as Box;
    const line = edgeLine(from, to);
    const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
    const at =
      Math.max(shownAt.get(edge.from) ?? 0, shownAt.get(edge.to) ?? 0) + 0.35;
    const sel = `#${id} .edge-${index}`;
    m.from(
      `${sel} line`,
      `{ strokeDashoffset: ${length.toFixed(1)}, duration: 0.6, ease: "expo.inOut" }`,
      at
    );
    m.from(`${sel} polygon`, "{ opacity: 0, duration: 0.2 }", at + 0.45);
    if (edge.label) {
      m.from(`${sel} text`, "{ opacity: 0, duration: 0.4 }", at + 0.4);
    }
    const heads = [arrowHead(line.x2, line.y2, angle)];
    if (edge.both) {
      heads.push(arrowHead(line.x1, line.y1, angle + Math.PI));
    }
    const mid = { x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 };
    const vertical = Math.abs(line.x2 - line.x1) < 1;
    const text = edge.label
      ? `<text x="${(mid.x + (vertical ? 14 : 0)).toFixed(1)}" y="${(mid.y - (vertical ? -6 : 12)).toFixed(1)}" text-anchor="${vertical ? "start" : "middle"}">${html(edge.label)}</text>`
      : "";
    return `<g class="edge edge-${index}"><line x1="${line.x1.toFixed(1)}" y1="${line.y1.toFixed(1)}" x2="${line.x2.toFixed(1)}" y2="${line.y2.toFixed(1)}" stroke-dasharray="${length.toFixed(1)}" />${heads.join("")}${text}</g>`;
  });
  return {
    body: `${label(scene.label)}
      <h2 class="heading">${words(scene.heading)}</h2>
      <svg class="edges" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${edges.join("")}</svg>
      ${nodes.join("")}`,
  };
}

function end(scene: EndScene, id: string, t: TimedScene, m: Motion): Part {
  m.rule(`#${id} .bar`, t.start + 0.1);
  m.rise(`#${id} .statement`, t.start + 0.25);
  m.slide(`#${id} .url`, t.start + 1.2);
  return {
    body: `<div class="bar"></div>
      <p class="statement">${words(scene.text)}</p>
      ${scene.url ? `<div class="url">${html(scene.url)}</div>` : ""}`,
  };
}

function render(scene: Scene, id: string, t: TimedScene, m: Motion): Part {
  switch (scene.type) {
    case "title":
      return title(scene, id, t, m);
    case "statement":
      return statement(scene, id, t, m);
    case "list":
      return list(scene, id, t, m);
    case "compare":
      return compare(scene, id, t, m);
    case "diagram":
      return diagram(scene, id, t, m);
    case "end":
      return end(scene, id, t, m);
    default:
      throw new Error("unknown scene type");
  }
}

const STYLE = `
@font-face { font-family: "Plex Sans"; font-weight: 400 700; src: url("fonts/plex-latin.woff2") format("woff2"); }
@font-face { font-family: "Plex Sans"; font-weight: 400 700; src: url("fonts/plex-cyrillic.woff2") format("woff2"); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: "Plex Mono"; font-weight: 400; src: url("fonts/mono-latin-400.woff2") format("woff2"); }
@font-face { font-family: "Plex Mono"; font-weight: 400; src: url("fonts/mono-cyrillic-400.woff2") format("woff2"); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: "Plex Mono"; font-weight: 500; src: url("fonts/mono-latin-500.woff2") format("woff2"); }
@font-face { font-family: "Plex Mono"; font-weight: 500; src: url("fonts/mono-cyrillic-500.woff2") format("woff2"); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
:root { --paper: #efece6; --paper-2: #e5e1d9; --ink: #111; --ink-2: #2b2926; --muted: #6e6a64; --signal: #ff4d00; }
html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: var(--paper); }
#root { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; background: var(--paper); color: var(--ink); font-family: "Plex Sans", "Helvetica Neue", Arial, sans-serif; overflow: hidden; }
.mono, .top, .label, .kicker, .url, .row-no, .node span, .edges text, .counter { font-family: "Plex Mono", ui-monospace, monospace; }
.top { position: absolute; left: ${MARGIN}px; right: ${MARGIN}px; top: 52px; display: flex; justify-content: space-between; font-size: 20px; letter-spacing: 0.08em; text-transform: uppercase; }
.top-rule { position: absolute; left: ${MARGIN}px; right: ${MARGIN}px; top: 96px; height: 2px; background: var(--ink); }
.progress { position: absolute; left: 0; bottom: 0; height: 8px; width: ${WIDTH}px; background: var(--signal); transform-origin: 0 50%; }
.scene { position: absolute; inset: 0; }
.counter { position: absolute; right: ${MARGIN}px; top: 128px; font-size: 20px; letter-spacing: 0.08em; color: var(--muted); }
.acc { color: var(--signal); font-style: normal; }
.w { display: inline-block; overflow: hidden; vertical-align: top; padding-bottom: 0.08em; margin-bottom: -0.08em; }
.wi { display: inline-block; }
.label { position: absolute; left: ${MARGIN}px; top: 128px; font-size: 20px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--signal); }
.heading { position: absolute; left: ${MARGIN}px; top: 170px; width: 1500px; margin: 0; font-size: 64px; line-height: 1.05; letter-spacing: -0.025em; font-weight: 700; }
.bar { position: absolute; left: ${MARGIN}px; top: 300px; width: 120px; height: 12px; background: var(--signal); }
.kicker { position: absolute; left: ${MARGIN}px; top: 350px; font-size: 26px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.title { position: absolute; left: ${MARGIN}px; top: 400px; width: 1600px; margin: 0; font-size: 124px; line-height: 0.98; letter-spacing: -0.035em; font-weight: 700; }
.subtitle { position: absolute; left: ${MARGIN}px; top: 760px; width: 1300px; margin: 0; font-size: 36px; line-height: 1.3; color: var(--ink-2); }
.statement { position: absolute; left: ${MARGIN}px; top: 230px; width: 1560px; margin: 0; font-size: 84px; line-height: 1.08; letter-spacing: -0.03em; font-weight: 700; }
.is-end .statement { top: 360px; }
.url { position: absolute; left: ${MARGIN}px; top: 800px; font-size: 30px; letter-spacing: 0.04em; color: var(--signal); }
.rows { position: absolute; left: ${MARGIN}px; top: 330px; width: 1680px; margin: 0; padding: 0; list-style: none; }
.row { position: relative; display: flex; gap: 32px; padding: 22px 0 24px; font-size: 40px; line-height: 1.2; }
.rows.split { display: grid; grid-auto-flow: column; grid-template-columns: 1fr 1fr; column-gap: 64px; }
.row-line { position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--ink); }
.row-no { flex: 0 0 64px; font-size: 24px; padding-top: 10px; color: var(--signal); }
.cols { position: absolute; left: ${MARGIN}px; top: 330px; width: 1680px; display: grid; gap: 40px; }
.cols-2 { grid-template-columns: 1fr 1fr; }
.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
.col { position: relative; padding: 28px 28px 32px; min-height: 440px; box-sizing: border-box; }
.col-line { position: absolute; left: 0; right: 0; top: 0; height: 4px; background: var(--ink); }
.col-fill { position: absolute; inset: 0; background: var(--ink); }
.col-title { position: relative; margin: 0 0 20px; font-size: 40px; letter-spacing: -0.02em; }
.col ul { position: relative; margin: 0; padding: 0; list-style: none; }
.col li { font-size: 30px; line-height: 1.3; padding: 12px 0; border-top: 1px solid #1113; }
.col.pick .col-title, .col.pick li { color: var(--paper); }
.col.pick li { border-top-color: #efece633; }
.col.pick .col-line { background: var(--signal); }
.edges { position: absolute; left: 0; top: 0; }
.edges line { stroke: var(--ink); stroke-width: 3; }
.edges polygon { fill: var(--ink); }
.edges text { font-size: 22px; fill: var(--muted); paint-order: stroke; stroke: var(--paper); stroke-width: 10px; stroke-linejoin: round; }
.node { position: absolute; box-sizing: border-box; border: 3px solid var(--ink); background: var(--paper); display: flex; flex-direction: column; justify-content: center; padding: 0 18px; }
.node strong { font-size: 32px; line-height: 1.1; letter-spacing: -0.01em; }
.node span { font-size: 21px; line-height: 1.25; color: var(--muted); margin-top: 4px; }
.node.accent { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.node.accent span { color: #efece6b3; }
.say { position: absolute; left: ${MARGIN}px; bottom: 56px; width: 1500px; padding-left: 28px; border-left: 6px solid var(--signal); font-size: 34px; line-height: 1.3; color: var(--ink-2); }
`;

/** The full composition HTML for a storyboard. */
export function compose(board: Storyboard, lang: string): string {
  const timed = timeline(board);
  const last = timed.at(-1);
  const total = last ? last.start + last.duration : 0;
  const motion = new Motion();
  const count = String(timed.length).padStart(2, "0");
  const scenes = timed.map((item, index) => {
    const id = `s${index + 1}`;
    const part = render(item.scene, id, item, motion);
    if (item.scene.say) {
      motion.from(
        `#${id} .say`,
        `{ opacity: 0, x: -20, duration: 0.5, ease: "expo.out" }`,
        item.start + 0.4
      );
    }
    if (index < timed.length - 1) {
      motion.to(
        `#${id}`,
        "{ opacity: 0, duration: 0.25, ease: \"power1.in\" }",
        item.start + item.duration - 0.25
      );
    }
    const counter = `<div class="counter">${String(index + 1).padStart(2, "0")} / ${count}</div>`;
    const say = item.scene.say
      ? `<div class="say">${inline(item.scene.say)}</div>`
      : "";
    return `    <div id="${id}" class="scene clip is-${item.scene.type}" data-start="${item.start}" data-duration="${item.duration}" data-track-index="1">
      ${item.scene.type === "title" || item.scene.type === "end" ? "" : counter}
      ${part.body}
      ${say}
    </div>`;
  });
  motion.from(
    ".progress",
    `{ scaleX: 0, duration: ${total.toFixed(2)}, ease: "none" }`,
    0
  );
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <title>${html(board.context)}</title>
  <script src="gsap.min.js"></script>
  <style>${STYLE}</style>
</head>
<body>
  <div id="root" data-composition-id="root" data-width="${WIDTH}" data-height="${HEIGHT}" data-start="0" data-duration="${total}">
    <div class="top"><span>balkhaev.com</span><span>${inline(board.context)}</span><span>${lang === "ru" ? "блог" : "blog"}</span></div>
    <div class="top-rule"></div>
${scenes.join("\n")}
    <div class="progress"></div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${motion.lines.join("\n      ")}
      window.__timelines = window.__timelines || {};
      window.__timelines.root = tl;
    </script>
  </div>
</body>
</html>
`;
}
