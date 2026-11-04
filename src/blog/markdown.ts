import rehypeShiki from "@shikijs/rehype";
import type { Element, Root as HastRoot } from "hast";
import { toString as hastText } from "hast-util-to-string";
import { h } from "hastscript";
import type { Root as MdastRoot } from "mdast";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export interface Heading {
  depth: 2 | 3;
  id: string;
  text: string;
}

export interface Rendered {
  html: string;
  /** True when the post has formulas and needs the KaTeX stylesheet. */
  math: boolean;
  toc: Heading[];
}

/** `:::note`, `:::warning`, `:::tldr` boxes and a collapsible `:::proof`. */
export const CALLOUTS = ["note", "warning", "tldr", "proof"] as const;
type Callout = (typeof CALLOUTS)[number];
const isCallout = (name: string): name is Callout =>
  (CALLOUTS as readonly string[]).includes(name);

function calloutProps(name: string) {
  const kind = isCallout(name) ? name : "note";
  return kind === "proof"
    ? { hName: "details", hProperties: { className: ["callout", "proof"] } }
    : { hName: "aside", hProperties: { className: ["callout", kind] } };
}

function remarkCallouts() {
  return (tree: MdastRoot) => {
    visit(tree, (node, index, parent) => {
      if (node.type === "containerDirective") {
        node.data = { ...node.data, ...calloutProps(node.name) };
        return;
      }
      const inline =
        node.type === "textDirective" || node.type === "leafDirective";
      if (inline && parent && index !== undefined) {
        // Not a callout: "a:b" in prose must stay text.
        const marker = node.type === "textDirective" ? ":" : "::";
        parent.children.splice(index, 1, {
          type: "text",
          value: `${marker}${node.name}`,
        });
      }
    });
  };
}

const SUMMARY: Record<string, string> = { en: "Proof", ru: "Доказательство" };

interface Collected {
  errors: string[];
  math: boolean;
  toc: Heading[];
}

const hasClass = (node: Element, name: string) => {
  const classes = node.properties.className;
  return Array.isArray(classes) && classes.includes(name);
};

function collectHeading(node: Element, toc: Heading[]) {
  const { id } = node.properties;
  const heading = node.tagName === "h2" || node.tagName === "h3";
  // The footnote section's hidden heading is not part of the article.
  if (heading && typeof id === "string" && id !== "footnote-label") {
    toc.push({
      depth: node.tagName === "h2" ? 2 : 3,
      id,
      // Without footnote markers: "Two¹" reads as "Two" in the contents.
      text: hastText({
        ...node,
        children: node.children.filter(
          (child) => child.type !== "element" || child.tagName !== "sup"
        ),
      }).trim(),
    });
  }
}

/** Adds a <summary> to proofs, finds formulas and collects h2/h3. */
function rehypeCollect(lang: string, found: Collected) {
  return () => (tree: HastRoot) => {
    visit(tree, "element", (node: Element) => {
      found.math ||= hasClass(node, "katex");
      if (hasClass(node, "katex-error")) {
        found.errors.push(String(node.properties.title ?? hastText(node)));
      }
      if (node.tagName === "details" && hasClass(node, "proof")) {
        node.children.unshift(h("summary", SUMMARY[lang] ?? SUMMARY.en));
      }
      collectHeading(node, found.toc);
    });
  };
}

/**
 * Markdown body of a post to HTML: GFM (tables, footnotes), $math$ via KaTeX,
 * code via Shiki in light and dark themes, callouts. Raw HTML is dropped.
 */
export async function renderMarkdown(
  source: string,
  lang = "en"
): Promise<Rendered> {
  const found: Collected = { errors: [], math: false, toc: [] };
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirective)
    .use(remarkCallouts)
    .use(remarkRehype, {
      footnoteLabel: lang === "ru" ? "Примечания" : "Footnotes",
    })
    .use(rehypeKatex)
    .use(rehypeShiki, {
      defaultColor: false,
      fallbackLanguage: "text",
      lazy: true,
      themes: { dark: "github-dark", light: "github-light" },
    })
    .use(rehypeSlug)
    .use(rehypeCollect(lang, found))
    .use(rehypeStringify)
    .process(source);
  if (found.errors.length) {
    throw new Error(`Invalid formula: ${found.errors.join("; ")}`);
  }
  return { html: String(file), math: found.math, toc: found.toc };
}
