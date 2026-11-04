import { ARCHIVE, FIRST_ISSUE, type Issue } from "./content";

/** Editions the feed keeps: the archive year plus about a year of new ones. */
export const FEED_SIZE = 400;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The file on disk is trusted only after this check.
const valid = (issue: Partial<Issue> | null) =>
  typeof issue?.date === "string" &&
  DATE.test(issue.date) &&
  Array.isArray(issue.stories) &&
  issue.stories.every(
    (story) =>
      typeof story?.title === "string" &&
      typeof story.text === "string" &&
      typeof story.source === "string" &&
      typeof story.url === "string" &&
      (story.topics === undefined ||
        (Array.isArray(story.topics) &&
          story.topics.every((topic) => typeof topic === "string"))) &&
      story.url.startsWith("https://")
  );

/**
 * One edition per date (the first one given wins), newest first, with the
 * launch edition and the archive always there.
 */
export function mergeIssues(issues: Issue[]): Issue[] {
  const byDate = new Map<string, Issue>();
  for (const issue of [...issues, FIRST_ISSUE, ...ARCHIVE]) {
    if (valid(issue) && !byDate.has(issue.date)) {
      byDate.set(issue.date, issue);
    }
  }
  return [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, FEED_SIZE);
}

/** Oldest edition the site has: posts before it get the newest matches. */
export const NEWS_SINCE = ARCHIVE.reduce(
  (oldest, issue) => (issue.date < oldest ? issue.date : oldest),
  "9999-12-31"
);

/** A post's date when the archive covers it, for `near` in renderWidget. */
export const nearDate = (date: string | undefined) =>
  date !== undefined && date >= NEWS_SINCE ? date : undefined;
