import { expect, test } from "bun:test";
import { ARCHIVE, FIRST_ISSUE } from "./content";
import { renderNews } from "./render";

test("serves all four launch stories with original links before a channel issue exists", () => {
  const page = renderNews();
  const stories = ARCHIVE.reduce((sum, issue) => sum + issue.stories.length, 0);
  expect(page.split('<article class="story">')).toHaveLength(5 + stories);
  expect(page).toContain(ARCHIVE.at(-1)?.stories[0]?.url ?? "missing");
  for (const story of FIRST_ISSUE.stories) {
    expect(page).toContain(story.title);
    expect(page).toContain(`href="${story.url}"`);
  }
  expect(page).not.toContain("Выпуск в Telegram");
});

test("shows the newest published edition first, escapes channel text, and keeps one edition per date", () => {
  const issue = {
    date: "2026-11-06",
    post: 570,
    stories: [
      {
        source: "AI",
        text: "<script>unsafe</script>",
        title: "Модель <v2>",
        url: "https://example.com/",
      },
    ],
  };
  const page = renderNews([issue, { ...issue, post: 569 }]);
  expect(page.indexOf(issue.date)).toBeLessThan(page.indexOf(FIRST_ISSUE.date));
  expect(page).toContain("bestburyat/570");
  expect(page).not.toContain("bestburyat/569");
  expect(page).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
});
