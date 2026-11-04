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
import { mergeIssues, nearDate } from "../news/feed";
import { parseLimit, parseTopics, renderWidget } from "../news/widget";
import { rehypeCodeBlocks } from "./code";
import { rehypeDiagrams } from "./diagram";

export interface Heading {
  depth: 2 | 3;
  id: string;
  text: string;
}

export interface Rendered {
  html: string;
  /** True when the post has formulas and needs the KaTeX stylesheet. */
  math: boolean;
  /** True when the post has a news widget and needs its script. */
  news: boolean;
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

const NEWS = "news-widget";

/**
 * `::news{topic="agents mcp" limit=3}` on its own line: a block of digest
 * stories on those topics (see src/news/topics.ts). The element is a
 * placeholder until rehypeNews fills it.
 */
function remarkNews() {
  return (tree: MdastRoot) => {
    visit(tree, "leafDirective", (node) => {
      if (node.name !== "news") {
        return;
      }
      const { limit, topic } = node.attributes ?? {};
      const topics = parseTopics(topic ?? "");
      node.data = {
        hName: NEWS,
        hProperties: {
          limit: parseLimit(limit ?? undefined),
          topics: topics.join(" "),
        },
      };
      node.children = [];
    });
  };
}

function rehypeNews(lang: string, found: Collected, date?: string) {
  return () => (tree: HastRoot) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== NEWS || !parent || index === undefined) {
        return;
      }
      found.news = true;
      const topics = parseTopics(String(node.properties.topics));
      const limit = Number(node.properties.limit);
      parent.children.splice(index, 1, {
        type: "raw",
        value: renderWidget(
          topics,
          limit,
          lang === "ru" ? "ru" : "en",
          nearDate(date),
          mergeIssues([])
        ),
      });
    });
  };
}

function remarkCallouts() {
  return (tree: MdastRoot) => {
    visit(tree, (node, index, parent) => {
      if (node.type === "leafDirective" && node.name === "news") {
        return;
      }
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
  news: boolean;
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
 * code via Shiki in light and dark themes, ```mermaid diagrams as inline SVG,
 * callouts, `::news` widgets. Raw HTML in the source is dropped.
 */
export async function renderMarkdown(
  source: string,
  lang = "en",
  /** The post's date: its news widgets prefer stories from around then. */
  date?: string
): Promise<Rendered> {
  const found: Collected = { errors: [], math: false, news: false, toc: [] };
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirective)
    .use(remarkNews)
    .use(remarkCallouts)
    .use(remarkRehype, {
      footnoteLabel: lang === "ru" ? "Примечания" : "Footnotes",
    })
    .use(rehypeKatex)
    .use(rehypeDiagrams)
    .use(rehypeCodeBlocks(lang))
    .use(rehypeShiki, {
      defaultColor: false,
      fallbackLanguage: "text",
      lazy: true,
      themes: { dark: "github-dark", light: "github-light" },
    })
    .use(rehypeSlug)
    .use(rehypeCollect(lang, found))
    .use(rehypeNews(lang, found, date))
    // Only the build-time diagram SVG is raw here: Markdown HTML was dropped
    // by remark-rehype above.
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(source);
  if (found.errors.length) {
    throw new Error(`Invalid formula: ${found.errors.join("; ")}`);
  }
  return {
    html: String(file),
    math: found.math,
    news: found.news,
    toc: found.toc,
  };
}
