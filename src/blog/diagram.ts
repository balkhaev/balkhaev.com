import { renderMermaidSVG } from "beautiful-mermaid";
import type { Element, Root as HastRoot } from "hast";
import { toString as hastText } from "hast-util-to-string";
import { visit } from "unist-util-visit";

/**
 * Colours are the page's own tokens, so a diagram follows the blog theme
 * (and any future dark theme) without a rebuild. Every slot is set
 * explicitly: the SVG falls back to `var(--line)` and `var(--muted)`, which
 * the page already defines for other things.
 */
const COLORS = {
  accent: "var(--signal)",
  bg: "var(--paper)",
  border: "var(--ink)",
  fg: "var(--ink)",
  line: "var(--ink-2)",
  muted: "var(--muted)",
  surface: "var(--paper-2)",
};

const FONT_IMPORT = /@import url\([^)]*\);?\s*/g;

/**
 * Mermaid source to a standalone SVG for the page. Ids get a per-diagram
 * prefix: node ids like "db" would otherwise clash with heading anchors and
 * with the arrow markers of other diagrams on the same page.
 */
export function renderDiagram(source: string, prefix: string): string {
  const svg = renderMermaidSVG(source, {
    ...COLORS,
    font: "IBM Plex Sans",
    padding: 8,
    transparent: true,
  });
  return (
    svg
      // The site serves Plex itself; no request to Google from the SVG.
      .replace(FONT_IMPORT, "")
      .replace(/\bid="([^"]+)"/g, `id="${prefix}-$1"`)
      .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
      .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`)
      .replace("<svg ", '<svg role="img" ')
  );
}

const isMermaid = (node: Element) => {
  const classes = node.properties.className;
  return Array.isArray(classes) && classes.includes("language-mermaid");
};

/**
 * ```mermaid code blocks become inline SVG figures at build time: no
 * client-side JavaScript. A diagram that does not parse fails the build.
 */
export function rehypeDiagrams() {
  return (tree: HastRoot) => {
    let count = 0;
    visit(tree, "element", (node: Element, index, parent) => {
      const [code] = node.children;
      if (
        node.tagName !== "pre" ||
        code?.type !== "element" ||
        !isMermaid(code) ||
        !parent ||
        index === undefined
      ) {
        return;
      }
      count += 1;
      const source = hastText(code);
      let svg: string;
      try {
        svg = renderDiagram(source, `d${count}`);
      } catch (error) {
        throw new Error(
          `Invalid diagram: ${(error as Error).message}\n${source}`,
          { cause: error }
        );
      }
      parent.children[index] = {
        children: [{ type: "raw", value: svg }],
        properties: { className: ["diagram"] },
        tagName: "figure",
        type: "element",
      };
    });
  };
}
