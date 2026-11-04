import { escapeHTML as html } from "bun";
import { siteFooter, siteHeader } from "../site/chrome";
import { FIRST_ISSUE, type Issue, type Story } from "./content";

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

const channel = "https://t.me/bestburyat";

function story(
  item: Story,
  index: number,
  total: number,
  date: string,
  featured: boolean
) {
  const id = `story-${date}-${index + 1}`;
  const number = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  const source = `${html(item.source)} <span aria-hidden="true">↗</span>`;
  const link = `href="${html(item.url)}" rel="external noreferrer" aria-labelledby="${id} ${id}-source"`;
  if (featured) {
    return `<article class="story"><a class="cycle news-feature" ${link}>
      <span class="cycle-no">${number}</span>
      <h3 id="${id}">${html(item.title)}</h3>
      <p class="cycle-desc">${html(item.text)}</p>
      <span class="cycle-foot" id="${id}-source">${source}</span>
    </a></article>`;
  }
  return `<li><article class="story"><a class="row news-row" ${link}>
    <div class="row-main"><span class="row-kicker">${number}</span>
    <h3 class="row-title" id="${id}">${html(item.title)}</h3>
    <p class="row-sub">${html(item.text)}</p></div>
    <span class="row-meta" id="${id}-source">${source}</span>
  </a></article></li>`;
}

function edition(issue: Issue, issueIndex: number) {
  const label = dateFormat.format(new Date(`${issue.date}T12:00:00Z`));
  const permalink = issue.post
    ? `<a class="issue-link" href="${channel}/${issue.post}">Выпуск в Telegram ↗</a>`
    : "";
  const [first, ...rest] = issue.stories;
  if (!first) {
    return "";
  }
  const count = issue.stories.length;
  const featured = issueIndex === 0;
  const rows = (featured ? rest : issue.stories)
    .map((item, i) =>
      story(item, featured ? i + 1 : i, count, issue.date, false)
    )
    .join("");
  return `<section class="block" aria-labelledby="issue-${issue.date}">
    <div class="label"><h2 id="issue-${issue.date}">Выпуск · <time datetime="${issue.date}">${html(label)}</time></h2>${permalink}</div>
    <div class="${featured ? "news-spread" : "news-archive"}">
      ${featured ? story(first, 0, count, issue.date, true) : ""}
      ${rows ? `<ol class="rows">${rows}</ol>` : ""}
    </div></section>`;
}

export function renderNews(updates: Issue[] = []) {
  const issues = new Map<string, Issue>();
  for (const issue of updates) {
    if (issue.date >= FIRST_ISSUE.date && !issues.has(issue.date)) {
      issues.set(issue.date, issue);
    }
  }
  if (!issues.has(FIRST_ISSUE.date)) {
    issues.set(FIRST_ISSUE.date, FIRST_ISSUE);
  }
  const ordered = [...issues.values()].sort((a, b) =>
    b.date.localeCompare(a.date)
  );
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Новости AI · Balkhaev</title><meta name="description" content="Дайджест раз в два дня. Крупные релизы AI, открытые веса и новые возможности со ссылками на первоисточники.">
<link rel="canonical" href="https://balkhaev.com/news/"><link rel="icon" href="/icon.svg">
<meta property="og:title" content="Новости AI · Balkhaev"><meta property="og:url" content="https://balkhaev.com/news/">
<meta name="theme-color" content="#efece6">
<link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/blog/blog.css"><link rel="stylesheet" href="/news/news.css">
</head><body id="top"><div class="page news">
${siteHeader("ru", "news")}
<main><div class="masthead"><h1>Новости AI<span aria-hidden="true" class="stop"></span></h1></div>
<div class="lead"><p>Крупные релизы, открытые веса и новые возможности AI. Раз в два дня — со ссылками на первоисточники.</p>
<p class="lead-actions"><a class="pill" href="${channel}">Дайджест в Telegram <span aria-hidden="true">↗</span></a></p></div>
${ordered.map(edition).join("")}</main>
${siteFooter("ru", '<a href="/blog/ru/">Блог</a>')}</div></body></html>`;
}
