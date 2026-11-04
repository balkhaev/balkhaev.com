import { YAML } from "bun";

/**
 * A storyboard is the script of one post's video: the post's ideas as a
 * sequence of scenes, without code. It lives next to the post as
 * content/blog/<slug>/video.<lang>.yml and is turned into a HyperFrames
 * composition by compose.ts.
 *
 * In any text field `*word*` is drawn in the accent colour.
 */

interface SceneBase {
  /** Caption under the scene, also spoken. */
  say?: string;
  /** What the narrator says instead of the line built from the scene's text. */
  voice?: string;
}

export interface TitleScene extends SceneBase {
  /** Small line above the title, e.g. the series and part. */
  kicker?: string;
  subtitle?: string;
  title: string;
  type: "title";
}

export interface StatementScene extends SceneBase {
  label?: string;
  text: string;
  type: "statement";
}

export interface ListScene extends SceneBase {
  heading: string;
  items: string[];
  label?: string;
  /** Numbered rows (01, 02, …) instead of dashes. */
  numbered?: boolean;
  type: "list";
}

export interface CompareColumn {
  /** The column the scene argues for: drawn inverted. */
  pick?: boolean;
  points: string[];
  title: string;
}

export interface CompareScene extends SceneBase {
  columns: CompareColumn[];
  heading: string;
  label?: string;
  type: "compare";
}

export interface DiagramNode {
  /** Highlight the node in the accent colour. */
  accent?: boolean;
  /** Left edge, in columns of a 12-column grid (0–11). */
  col: number;
  id: string;
  label: string;
  /** Top edge, in rows of a 6-row grid (0–5). */
  row: number;
  /** Order in which nodes appear; nodes with the same step appear together. */
  step?: number;
  sub?: string;
  /** Width in columns, default 3. */
  w?: number;
}

export interface DiagramEdge {
  /** Arrowheads at both ends. */
  both?: boolean;
  from: string;
  label?: string;
  to: string;
}

export interface DiagramScene extends SceneBase {
  edges: DiagramEdge[];
  heading: string;
  label?: string;
  nodes: DiagramNode[];
  type: "diagram";
}

export interface EndScene extends SceneBase {
  text: string;
  type: "end";
  /** Shown under the text, e.g. the post URL. */
  url?: string;
}

export type Scene =
  | CompareScene
  | DiagramScene
  | EndScene
  | ListScene
  | StatementScene
  | TitleScene;

export interface Storyboard {
  /** Shown in the top bar, e.g. the series name. */
  context: string;
  scenes: Scene[];
}

/** A scene placed on the timeline. */
export interface TimedScene {
  duration: number;
  scene: Scene;
  start: number;
}

const ACCENT = /\*([^*]+)\*/g;
const GRID_COLS = 12;
const GRID_ROWS = 6;

function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function texts(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isText);
}

function need(file: string, ok: boolean, message: string) {
  if (!ok) {
    fail(file, message);
  }
}

function checkDiagram(file: string, at: string, scene: DiagramScene) {
  need(file, isText(scene.heading), `${at}: "heading" is required`);
  need(
    file,
    Array.isArray(scene.nodes) && scene.nodes.length > 0,
    `${at}: "nodes" must be a non-empty list`
  );
  const ids = new Set<string>();
  for (const node of scene.nodes) {
    const width = node.w ?? 3;
    need(file, isText(node.id), `${at}: every node needs an "id"`);
    need(file, !ids.has(node.id), `${at}: duplicate node "${node.id}"`);
    ids.add(node.id);
    need(file, isText(node.label), `${at}: node "${node.id}" needs a label`);
    need(
      file,
      Number.isInteger(node.col) &&
        node.col >= 0 &&
        Number.isInteger(width) &&
        width >= 1 &&
        node.col + width <= GRID_COLS,
      `${at}: node "${node.id}" does not fit the 12 columns`
    );
    need(
      file,
      Number.isInteger(node.row) && node.row >= 0 && node.row < GRID_ROWS,
      `${at}: node "${node.id}" row must be 0–5`
    );
  }
  need(file, Array.isArray(scene.edges), `${at}: "edges" must be a list`);
  for (const edge of scene.edges) {
    need(
      file,
      ids.has(edge.from) && ids.has(edge.to),
      `${at}: edge ${edge.from} -> ${edge.to} names an unknown node`
    );
  }
}

function checkScene(file: string, index: number, scene: Scene) {
  const at = `scene ${index + 1}`;
  switch (scene.type) {
    case "title":
      need(file, isText(scene.title), `${at}: "title" is required`);
      return;
    case "statement":
      need(file, isText(scene.text), `${at}: "text" is required`);
      return;
    case "list":
      need(file, isText(scene.heading), `${at}: "heading" is required`);
      need(file, texts(scene.items), `${at}: "items" must be a list of text`);
      return;
    case "compare":
      need(file, isText(scene.heading), `${at}: "heading" is required`);
      need(
        file,
        Array.isArray(scene.columns) &&
          scene.columns.length >= 2 &&
          scene.columns.length <= 3,
        `${at}: "columns" must hold 2 or 3 columns`
      );
      for (const column of scene.columns) {
        need(
          file,
          isText(column.title) && texts(column.points),
          `${at}: every column needs a title and points`
        );
      }
      return;
    case "diagram":
      checkDiagram(file, at, scene);
      return;
    case "end":
      need(file, isText(scene.text), `${at}: "text" is required`);
      return;
    default:
      fail(file, `${at}: unknown scene type`);
  }
}

/** Parses and validates a storyboard; throws with the file name on errors. */
export function parseStoryboard(file: string, source: string): Storyboard {
  const data = YAML.parse(source) as Partial<Storyboard> | null;
  if (!(data && typeof data === "object")) {
    fail(file, "expected a YAML mapping");
  }
  need(file, isText(data.context), `"context" is required`);
  need(
    file,
    Array.isArray(data.scenes) && data.scenes.length > 0,
    `"scenes" must be a non-empty list`
  );
  const scenes = data.scenes as Scene[];
  scenes.forEach((scene, index) => {
    checkScene(file, index, scene);
  });
  return { context: data.context as string, scenes };
}

/** All visible text of a scene, for estimating how long it needs. */
export function sceneText(scene: Scene): string {
  const parts: (string | undefined)[] = [scene.say];
  switch (scene.type) {
    case "title":
      parts.push(scene.kicker, scene.title, scene.subtitle);
      break;
    case "statement":
      parts.push(scene.label, scene.text);
      break;
    case "list":
      parts.push(scene.heading, ...scene.items);
      break;
    case "compare":
      parts.push(
        scene.heading,
        ...scene.columns.flatMap((column) => [column.title, ...column.points])
      );
      break;
    case "diagram":
      parts.push(
        scene.heading,
        ...scene.nodes.flatMap((node) => [node.label, node.sub]),
        ...scene.edges.map((edge) => edge.label)
      );
      break;
    case "end":
      parts.push(scene.text, scene.url);
      break;
    default:
      break;
  }
  return parts.filter(Boolean).join(" ").replace(ACCENT, "$1");
}

/** Reading speed for on-screen text, in characters per second. */
export const READING_SPEED = 17;
const BASE_SECONDS = 2;
const MIN_SECONDS = 4;

/** Seconds a scene stays on screen: enough time to read all of its text. */
export function sceneDuration(scene: Scene): number {
  const seconds = BASE_SECONDS + sceneText(scene).length / READING_SPEED;
  return Math.round(Math.max(MIN_SECONDS, seconds) * 10) / 10;
}

/**
 * Places the scenes one after another. `minimum` gives a scene more time,
 * e.g. to fit its voiceover.
 */
export function timeline(
  board: Storyboard,
  minimum: number[] = []
): TimedScene[] {
  let start = 0;
  return board.scenes.map((scene, index) => {
    const duration = Math.max(
      sceneDuration(scene),
      Math.ceil((minimum[index] ?? 0) * 10) / 10
    );
    const timed = { duration, scene, start };
    start = Math.round((start + duration) * 10) / 10;
    return timed;
  });
}
