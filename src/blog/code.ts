import type { Element, ElementContent, Root as HastRoot, Text } from "hast";
import { h } from "hastscript";
import { visit } from "unist-util-visit";

/** Blocks longer than this fold; the stylesheet shows the first 10 lines. */
export const FOLD_AFTER = 16;

/** A first line like `// src/db.ts` or `# deploy.yml` names the file. */
const FILE_LINE = /^\s*(?:\/\/|#|--|;)\s*([\w./@-]+\.\w+)\s*$/;
const TRAILING_NEWLINE = /\n$/;

const ruLines = (count: number) => {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) {
    return `${count} строк`;
  }
  if (ones === 1) {
    return `${count} строка`;
  }
  return ones >= 2 && ones <= 4 ? `${count} строки` : `${count} строк`;
};

interface Labels {
  less: string;
  more: (count: number) => string;
}

const EN: Labels = {
  less: "Collapse",
  more: (count) => `Show all ${count} lines`,
};
const RU: Labels = {
  less: "Свернуть",
  more: (count) => `Показать весь код · ${ruLines(count)}`,
};

const hasClass = (node: Element, name: string) => {
  const classes = node.properties.className;
  return Array.isArray(classes) && classes.includes(name);
};

const languageOf = (code: Element) => {
  const classes = code.properties.className;
  const found = Array.isArray(classes)
    ? classes.find((name) => String(name).startsWith("language-"))
    : undefined;
  return found ? String(found).slice("language-".length) : "";
};

/** The `code` text of a `pre > code` block, if the node is one. */
function codeOf(node: Element) {
  const [code] = node.children;
  if (node.tagName !== "pre" || code?.type !== "element") {
    return;
  }
  const text = code.children.find(
    (child): child is Text => child.type === "text"
  );
  return text && code.tagName === "code" ? { code, text } : undefined;
}

/** Takes the file-name comment off the first line; returns name and lines. */
function splitFile(text: Text) {
  const lines = text.value.replace(TRAILING_NEWLINE, "").split("\n");
  const file = FILE_LINE.exec(lines[0] ?? "")?.[1];
  if (file && lines.length > 1) {
    lines.shift();
    text.value = `${lines.join("\n")}\n`;
    return { file, lines: lines.length };
  }
  return { file: undefined, lines: lines.length };
}

/**
 * Wraps every code block: the file name from its first comment line goes
 * into a tab, and a long block folds to its first lines behind a checkbox
 * and a label, so it opens without any JavaScript. Runs before Shiki, which
 * then highlights the `pre` inside.
 */
export function rehypeCodeBlocks(lang: string) {
  const label = lang === "ru" ? RU : EN;
  return () => (tree: HastRoot) => {
    let count = 0;
    visit(tree, "element", (node: Element, index, parent) => {
      const found = codeOf(node);
      if (
        !(found && parent && index !== undefined) ||
        (parent.type === "element" && hasClass(parent, "code"))
      ) {
        return;
      }
      const { file, lines } = splitFile(found.text);
      count += 1;
      const children: ElementContent[] = file
        ? [
            h("div.code-head", [
              h("span.code-file", file),
              h("span.code-lang", languageOf(found.code)),
            ]),
          ]
        : [];
      if (lines > FOLD_AFTER) {
        const id = `code-${count}`;
        children.push(
          h("input.code-toggle", { id, type: "checkbox" }),
          node,
          h("label.code-more", { htmlFor: id }, [
            h("span.code-more-open", label.more(lines)),
            h("span.code-more-close", label.less),
          ])
        );
        parent.children[index] = h("div.code.folds", children);
      } else {
        children.push(node);
        parent.children[index] = h("div.code", children);
      }
    });
  };
}
