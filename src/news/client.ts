import type { Issue } from "./content";
import { pickStories, type TopicId, type TopicLang } from "./topics";
import { FEED_PATH, parseLimit, parseTopics, widgetBody } from "./widget";

// Post pages are static: the build writes the launch stories into each
// widget, and this swaps them for the editions the server has collected.
async function refresh() {
  const widgets = document.querySelectorAll<HTMLElement>(".news-widget");
  if (widgets.length === 0) {
    return;
  }
  const response = await fetch(FEED_PATH, { cache: "no-cache" });
  if (!response.ok) {
    return;
  }
  const issues = (await response.json()) as Issue[];
  if (!Array.isArray(issues) || issues.length === 0) {
    return;
  }
  for (const widget of widgets) {
    try {
      const topics: TopicId[] = parseTopics(widget.dataset.topics ?? "");
      const limit = parseLimit(widget.dataset.limit);
      const lang: TopicLang = widget.dataset.lang === "en" ? "en" : "ru";
      widget.innerHTML = widgetBody(
        pickStories(issues, topics, limit),
        topics,
        lang
      );
    } catch {
      // Keep what the build wrote.
    }
  }
}

refresh().catch(() => {
  // Offline or no feed yet: the build-time stories stay.
});
