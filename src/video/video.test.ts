import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { compose, edgeLine, nodeBox, words } from "./compose";
import { parseStoryboard, sceneDuration, timeline } from "./storyboard";

const BOARD = `
context: Test series
scenes:
  - type: title
    title: Hello *world*
  - type: list
    heading: Three things
    items: [one, two, three]
    say: A caption.
  - type: diagram
    heading: Boxes
    nodes:
      - { id: a, label: A, col: 0, row: 0 }
      - { id: b, label: B, col: 6, row: 0 }
    edges:
      - { from: a, to: b, label: calls }
  - type: end
    text: Bye.
`;

describe("storyboard", () => {
  test("parses and places scenes back to back", () => {
    const board = parseStoryboard("t.yml", BOARD);
    const timed = timeline(board);
    expect(timed).toHaveLength(4);
    expect(timed[0]?.start).toBe(0);
    for (let index = 1; index < timed.length; index += 1) {
      const prev = timed[index - 1];
      expect(timed[index]?.start).toBeCloseTo(
        (prev?.start ?? 0) + (prev?.duration ?? 0),
        5
      );
    }
  });

  test("longer text stays on screen longer", () => {
    const short = sceneDuration({ text: "Hi.", type: "statement" });
    const long = sceneDuration({ text: "word ".repeat(60), type: "statement" });
    expect(short).toBe(4);
    expect(long).toBeGreaterThan(short);
  });

  test("rejects edges to unknown nodes and nodes off the grid", () => {
    expect(() =>
      parseStoryboard(
        "bad.yml",
        BOARD.replace("{ from: a, to: b", "{ from: a, to: c")
      )
    ).toThrow("unknown node");
    expect(() =>
      parseStoryboard("bad.yml", BOARD.replace("col: 6", "col: 11"))
    ).toThrow("12 columns");
    expect(() =>
      parseStoryboard("bad.yml", "context: x\nscenes:\n  - type: nope\n")
    ).toThrow("unknown scene type");
  });
});

describe("compose", () => {
  test("keeps punctuation glued to an accented word", () => {
    const out = words("see *the sources*.");
    expect(out).toContain('<em class="acc">sources</em>.</span>');
    expect(out.match(/class="w"/g)).toHaveLength(3);
  });

  test("escapes HTML in text", () => {
    expect(words("<b>")).toContain("&lt;b&gt;");
  });

  test("edges start and end on box borders", () => {
    const a = nodeBox({ col: 0, id: "a", label: "A", row: 0 });
    const b = nodeBox({ col: 6, id: "b", label: "B", row: 0 });
    const line = edgeLine(a, b);
    expect(line.x1).toBeCloseTo(a.x + a.w + 6, 5);
    expect(line.x2).toBeCloseTo(b.x - 6, 5);
    expect(line.y1).toBeCloseTo(a.y + a.h / 2, 5);
  });

  test("builds one timed clip per scene and registers the timeline", () => {
    const html = compose(parseStoryboard("t.yml", BOARD), "en");
    expect(html.match(/class="scene clip/g)).toHaveLength(4);
    expect(html).toContain('data-composition-id="root"');
    expect(html).toContain("window.__timelines.root = tl;");
    expect(html).toContain('<div class="say">A caption.</div>');
  });
});

test("every storyboard in content/blog is valid", async () => {
  const root = "content/blog";
  const slugs = await readdir(root);
  const files = (
    await Promise.all(
      slugs.map(async (slug) =>
        (
          await readdir(join(root, slug))
        )
          .filter((name) => name.startsWith("video."))
          .map((name) => join(root, slug, name))
      )
    )
  ).flat();
  const boards = await Promise.all(
    files.map(async (file) =>
      parseStoryboard(file, await readFile(file, "utf8"))
    )
  );
  for (const board of boards) {
    expect(board.scenes.length).toBeGreaterThan(0);
  }
});
