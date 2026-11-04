import type { Post } from "../blog/content";
import { blogPath } from "../blog/render";
import { type Job, type Project, RESUMES } from "../cv/content";

const LATEST = 3;
const EXPERIENCE = 4;
const ENTITIES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
const html = (text: string) =>
  text.replace(/[&<>"]/g, (char) => ENTITIES[char] ?? char);
/** The project's one-line summary: the text before its first colon. */
export const summary = (text: string) => text.split(":")[0]?.trim() ?? text;

/** The summary of a project described in the Russian resume. */
function summaryOf(name: string) {
  const project = RESUMES.ru.projectGroups
    .flatMap((group) => group.projects)
    .find((item) => item.name === name);
  return project ? summary(project.text) : "";
}

const SCHEME = /^https?:\/\//;
const TRAILING_SLASH = /\/$/;
const YEAR = /\d{4}/g;
const PRESENT = /сейчас|present/i;

const shortDate = (date: string) => date.split("-").reverse().join(".");

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
      (a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug)
    )
    .slice(0, count);
}

/** Projects Mikhail chose for the homepage, in his order. */
export const HOME_PROJECTS: Project[] = [
  {
    name: "Adorely",
    text: "Платформа AI-компаньонов: генерация фото и видео, чат и голос",
    url: "https://adorely.co/",
  },
  {
    name: "Sinly",
    text: "Платформа AI-компаньонов на общем мультитенантном бэкенде",
    url: "https://sinly.io/",
  },
  {
    name: "Luv Club",
    text: "AI-компаньоны со студией: фото, видео и 3D-сцены",
    url: "https://luv.club/",
  },
  {
    name: "ggpick.club",
    text: summaryOf("ggpick.club"),
    url: "https://ggpick.club/",
  },
  {
    name: "Алтай — живая земля",
    text: summaryOf("Алтай — живая земля"),
    url: "https://алтайземля.рф/",
  },
];

/** "Март 2026 – сейчас" → "2026 — н. в."; "Октябрь 2022 – август 2024" → "2022 — 2024". */
export function years(period: string) {
  const [from, to] = period.match(YEAR) ?? [];
  if (PRESENT.test(period)) {
    return `${from} — н. в.`;
  }
  return to && to !== from ? `${from} — ${to}` : (from ?? period);
}

const arrow = '<span aria-hidden="true" class="row-arrow">→</span>';

const renderPosts = (posts: Post[]) =>
  posts.length
    ? `<ol class="rows">${posts
        .map(
          (post) => `
          <li>
            <a class="row post-row" href="${blogPath(post.lang, post.slug)}"${post.lang === "ru" ? "" : ' hreflang="en" lang="en"'}>
              <time class="row-meta" datetime="${post.date}">${shortDate(post.date)}</time>
              <span class="row-main">
                <span class="row-title">${html(post.title)}</span>
                <span class="row-text">${html(post.description)}</span>
              </span>
              <span class="row-side">${post.minutes} мин ${arrow}</span>
            </a>
          </li>`
        )
        .join("")}
          </ol>`
    : '<p class="empty">Первые записи скоро появятся.</p>';

const renderProjects = (projects: Project[]) =>
  `<ul class="rows">${projects
    .map((project) => {
      const host = (project.url ?? "")
        .replace(SCHEME, "")
        .replace(TRAILING_SLASH, "");
      return `
          <li>
            <a class="row project-row" href="${html(project.url ?? "")}" rel="noopener noreferrer" target="_blank">
              <span class="row-title">${html(project.name)}</span>
              <span class="row-text">${html(project.text)}</span>
              <span class="row-side">${html(host)} <span aria-hidden="true" class="row-arrow">↗</span></span>
            </a>
          </li>`;
    })
    .join("")}
          </ul>`;

const renderExperience = (jobs: Job[]) =>
  `<ol class="rows">${jobs
    .map(
      (job) => `
          <li class="row job-row">
            <span class="row-meta">${html(years(job.period))}</span>
            <span class="row-title">${html(job.company)}</span>
            <span class="row-text">${html(job.role)}</span>
          </li>`
    )
    .join("")}
          </ol>`;

/** Fills the homepage template's placeholders with posts, projects and jobs. */
export function renderHome(template: string, posts: Post[]) {
  const { jobs, web } = RESUMES.ru;
  return template
    .replace("<!-- home:posts -->", renderPosts(latestPosts(posts)))
    .replace("<!-- home:projects -->", renderProjects(HOME_PROJECTS))
    .replace(
      "<!-- home:experience -->",
      renderExperience([...jobs, ...web].slice(0, EXPERIENCE))
    );
}
