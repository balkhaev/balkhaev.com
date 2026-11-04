import type { Issue } from "./content";

export const LATEST_LIMIT = 5;
const WEB = /^https:\/\//;

const ENTITIES: Record<string, string> = {
  "'": "&#39;",
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
const html = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);

/** "2026-11-04" → "04.11". */
const shortDate = (date: string) =>
  date.split("-").reverse().slice(0, 2).join(".");

/** The newest stories across editions, each link once. */
export function latestStories(issues: Issue[], limit = LATEST_LIMIT) {
  const seen = new Set<string>();
  return [...issues]
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap((issue) =>
      issue.stories.map((story) => ({ date: issue.date, story }))
    )
    .filter(({ story }) => {
      const fresh = WEB.test(story.url) && !seen.has(story.url);
      seen.add(story.url);
      return fresh;
    })
    .slice(0, limit);
}

/** The list inside the homepage's news sidebar. */
export function latestBody(issues: Issue[], limit = LATEST_LIMIT) {
  const items = latestStories(issues, limit)
    .map(
      ({ date, story }) => `<li>
                <a class="news-side-item" href="${html(story.url)}" rel="external noopener noreferrer" target="_blank">
                  <span class="news-side-meta"><time datetime="${date}">${shortDate(date)}</time> · ${html(story.source)} <span aria-hidden="true">↗</span></span>
                  <span class="news-side-title">${html(story.title)}</span>
                </a>
              </li>`
    )
    .join("");
  return `<ol class="news-side-list">${items}</ol>`;
}
