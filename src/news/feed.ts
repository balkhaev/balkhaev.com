import { FIRST_ISSUE, type Issue } from "./content";

/** Editions the feed keeps: about four months of a digest every two days. */
export const FEED_SIZE = 60;

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
      story.url.startsWith("https://")
  );

/**
 * One edition per date (the first one given wins), newest first, never older
 * than the launch edition, which is always there.
 */
export function mergeIssues(issues: Issue[]): Issue[] {
  const byDate = new Map<string, Issue>();
  for (const issue of [...issues, FIRST_ISSUE]) {
    if (
      valid(issue) &&
      issue.date >= FIRST_ISSUE.date &&
      !byDate.has(issue.date)
    ) {
      byDate.set(issue.date, issue);
    }
  }
  return [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, FEED_SIZE);
}
