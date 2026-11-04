import { expect, test } from "bun:test";
import { FOLD_AFTER } from "./code";
import { renderMarkdown } from "./markdown";

const block = (lines: number, first = "// src/app.ts") =>
  `\`\`\`ts\n${[first, ...Array.from({ length: lines }, (_, i) => `const a${i} = ${i};`)].join("\n")}\n\`\`\``;

test("a file comment becomes the block's tab", async () => {
  const { html } = await renderMarkdown(block(3));
  expect(html).toContain('<span class="code-file">src/app.ts</span>');
  expect(html).not.toContain("// src/app.ts");
  expect(html).not.toContain("code-toggle");
});

test("long blocks fold behind a labelled checkbox", async () => {
  const { html } = await renderMarkdown(block(FOLD_AFTER + 4), "ru");
  expect(html).toContain('<div class="code folds">');
  expect(html).toContain(
    '<input class="code-toggle" id="code-1" type="checkbox">'
  );
  expect(html).toContain('<label class="code-more" for="code-1">');
  expect(html).toContain(`Показать весь код · ${FOLD_AFTER + 4} строк`);
});

test("a block without a file comment keeps its first line", async () => {
  const { html } = await renderMarkdown("```sh\nbun add zod\n```");
  expect(html).toContain('<div class="code"><pre');
  expect(html).toContain("zod");
  expect(html).not.toContain("code-head");
});
