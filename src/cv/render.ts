import {
  type Job,
  LANGS,
  type Lang,
  type Project,
  RESUMES,
  type Resume,
} from "./content";

export const CV_PATHS: Record<Lang, string> = { en: "/cv/", ru: "/cv/ru/" };
const ORIGIN = "https://balkhaev.com";
const CONTACTS = [
  { href: "mailto:m.balkhaev@gmail.com", text: "m.balkhaev@gmail.com" },
  { href: "tel:+79660066068", text: "+7 966 006-60-68" },
  { href: "https://t.me/balkhaev", text: "t.me/balkhaev" },
  { href: "https://balkhaev.com/", text: "balkhaev.com" },
];

const ENTITIES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
const html = (text: string) =>
  text.replace(/[&<>"]/g, (char) => ENTITIES[char] ?? char);

const section = (label: string, body: string) => `
      <section class="row">
        <h2>${html(label)}</h2>
        <div>${body}</div>
      </section>`;

const where = ({ place, sites }: Job) => {
  if (sites) {
    const links = sites.map(
      (site) => `<a href="https://${site}/">${html(site)}</a>`
    );
    return `<span>, ${links.join(", ")}</span>`;
  }
  return place ? `<span>, ${html(place)}</span>` : "";
};

const job = (entry: Job) => `
          <article class="job">
            <header>
              <h3>${html(entry.company)}${where(entry)}</h3>
              <p class="period">${html(entry.period)}</p>
            </header>
            <p class="role">${html(entry.role)}</p>
            <ul>${entry.points.map((point) => `<li>${html(point)}</li>`).join("")}</ul>
          </article>`;

const earlier = (entry: Job) => `
          <article class="job brief">
            <header>
              <h3>${html(entry.company)}${where(entry)}<span>, ${html(entry.role)}</span></h3>
              <p class="period">${html(entry.period)}</p>
            </header>
            <p>${entry.points.map(html).join(" ")}</p>
          </article>`;

const project = ({ name, text, url }: Project) => {
  const domain = url?.replace(/^https:\/\/|\/$/g, "");
  const link =
    url && domain !== name
      ? `<span>, <a href="${url}">${html(domain ?? "")}</a></span>`
      : "";
  const title =
    url && domain === name ? `<a href="${url}">${html(name)}</a>` : html(name);
  return `
          <article class="project">
            <h3>${title}${link}</h3>
            <p>${html(text)}</p>
          </article>`;
};

const details = (cv: Resume) =>
  [
    [cv.labels.languages, cv.languages],
    [cv.labels.education, cv.education],
    [cv.labels.format, cv.details],
  ]
    .map(
      ([label, text]) =>
        `<div><dt>${html(label ?? "")}</dt><dd>${html(text ?? "")}</dd></div>`
    )
    .join("");

/**
 * Renders one language of the resume. `assets` points at the folder with
 * cv.css, the photo and the PDFs: /cv/ on the site, a file URL when printing.
 */
export function renderCv(lang: Lang, assets = "/cv/") {
  const cv = RESUMES[lang];
  const alternates = LANGS.map(
    (code) =>
      `<link href="${ORIGIN}${CV_PATHS[code]}" hreflang="${code}" rel="alternate">`
  ).join("\n    ");
  const switcher = LANGS.map((code) =>
    code === lang
      ? `<a aria-current="page" href="${CV_PATHS[code]}">${code.toUpperCase()}</a>`
      : `<a href="${CV_PATHS[code]}" hreflang="${code}" lang="${code}">${code.toUpperCase()}</a>`
  ).join("");
  const skills = cv.skills
    .map(
      ({ group, items }) =>
        `<div><dt>${html(group)}</dt><dd>${html(items)}</dd></div>`
    )
    .join("");

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8">
    <meta content="width=device-width, initial-scale=1" name="viewport">
    <meta content="${html(cv.description)}" name="description">
    <meta content="${html(cv.title)}" property="og:title">
    <meta content="${html(cv.headline)}" property="og:description">
    <meta content="${ORIGIN}${CV_PATHS[lang]}" property="og:url">
    <meta content="profile" property="og:type">
    <link href="${ORIGIN}${CV_PATHS[lang]}" rel="canonical">
    ${alternates}
    <link href="${ORIGIN}${CV_PATHS.en}" hreflang="x-default" rel="alternate">
    <link href="/icon.svg" rel="icon" type="image/svg+xml">
    <link href="${assets}cv.css" rel="stylesheet">
    <title>${html(cv.title)}</title>
  </head>
  <body>
    <nav class="bar">
      <a href="/">balkhaev.com</a>
      <span aria-label="${html(cv.labels.switcher)}" class="langs" role="group">${switcher}</span>
      <a download href="${assets}${cv.pdf}">PDF</a>
    </nav>
    <main>
      <header class="top">
        <div>
          <h1>${html(cv.name)}</h1>
          <p class="headline">${html(cv.headline)}</p>
          <ul class="contacts">
            <li>${html(cv.location)}</li>
            ${CONTACTS.map(({ href, text }) => `<li><a href="${href}">${html(text)}</a></li>`).join("\n            ")}
          </ul>
        </div>
        <img alt="${html(cv.name)}" class="photo" height="420" src="${assets}photo.jpg" width="420">
      </header>
      <p class="summary">${html(cv.summary)}</p>
${section(cv.labels.experience, cv.jobs.map(job).join(""))}
${cv.projectGroups.map((group) => section(group.label, group.projects.map(project).join(""))).join("\n")}
${section(cv.labels.web, cv.web.map(job).join("") + cv.earlier.map(earlier).join(""))}
${section(cv.labels.skills, `<dl class="skills">${skills}</dl>`)}
${section(cv.labels.details, `<dl class="skills">${details(cv)}</dl>`)}
    </main>
  </body>
</html>
`;
}
