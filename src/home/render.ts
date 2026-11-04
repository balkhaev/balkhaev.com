import type { Post } from "../blog/content";
import { blogPath } from "../blog/render";
import { type Project, RESUMES } from "../cv/content";

const LATEST = 3;
const ENTITIES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
const html = (text: string) =>
  text.replace(/[&<>"]/g, (char) => ENTITIES[char] ?? char);
const SENTENCE = /^(.+?[.!?])(?:\s|$)/;
const SCHEME = /^https?:\/\//;
const TRAILING_SLASH = /\/$/;

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("ru", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`)
  );

/** Newest Russian posts; English ones fill in for slugs with no translation. */
export function latestPosts(posts: Post[], count = LATEST) {
  const picked = new Map<string, Post>();
  for (const post of posts) {
    const seen = picked.get(post.slug);
    if (!seen || (seen.lang !== "ru" && post.lang === "ru")) {
      picked.set(post.slug, post);
    }
  }
  return [...picked.values()]
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug)
    )
    .slice(0, count);
}

/** Public projects from the Russian resume, except this site itself. */
export function featuredProjects(): Project[] {
  return RESUMES.ru.projectGroups
    .flatMap((group) => group.projects)
    .filter(
      (project) => project.url && project.url !== "https://balkhaev.com/"
    );
}

const renderPosts = (posts: Post[]) =>
  posts.length
    ? `<ol class="latest">${posts
        .map(
          (post) => `
          <li>
            <a href="${blogPath(post.lang, post.slug)}"${post.lang === "ru" ? "" : ' hreflang="en" lang="en"'}>
              <span class="latest-title">${html(post.title)}</span>
              <span class="latest-text">${html(post.description)}</span>
              <span class="latest-meta"><time datetime="${post.date}">${formatDate(post.date)}</time> · ${post.minutes} мин</span>
            </a>
          </li>`
        )
        .join("")}
        </ol>`
    : '<p class="empty">Первые посты скоро появятся.</p>';

const renderProjects = (projects: Project[]) =>
  `<ul class="projects">${projects
    .map((project) => {
      const text = SENTENCE.exec(project.text)?.[1] ?? project.text;
      const host = (project.url ?? "")
        .replace(SCHEME, "")
        .replace(TRAILING_SLASH, "");
      return `
          <li>
            <a href="${html(project.url ?? "")}" rel="noopener noreferrer" target="_blank">
              <span class="project-name">${html(project.name)} <span aria-hidden="true" class="project-arrow">↗</span></span>
              <span class="project-text">${html(text)}</span>
              <span class="project-host">${html(host)}</span>
            </a>
          </li>`;
    })
    .join("")}
        </ul>`;

/** Fills the homepage template's placeholders with posts and projects. */
export function renderHome(template: string, posts: Post[]) {
  return template
    .replace("<!-- home:posts -->", renderPosts(latestPosts(posts)))
    .replace("<!-- home:projects -->", renderProjects(featuredProjects()));
}
