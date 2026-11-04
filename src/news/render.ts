import { FIRST_ISSUE, type Issue, type Story } from "./content";

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

function html(value: string) {
  return escapeHTML(value);
}

function story(item: Story, index: number) {
  return `<article class="story">
    <span class="number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
    <div><h3>${html(item.title)}</h3><p>${html(item.text)}</p>
    <a class="source" href="${html(item.url)}" rel="external noreferrer">${html(item.source)} <span aria-hidden="true">↗</span></a></div>
  </article>`;
}

function edition(issue: Issue) {
  const label = dateFormat.format(new Date(`${issue.date}T12:00:00Z`));
  const permalink = issue.post
    ? `<a class="post" href="https://t.me/bestburyat/${issue.post}">Выпуск в Telegram ↗</a>`
    : "";
  return `<section class="edition" aria-labelledby="issue-${issue.date}">
    <div class="dateline"><span class="kicker">Выпуск</span>
    <h2 id="issue-${issue.date}"><time datetime="${issue.date}">${html(label)}</time></h2>${permalink}</div>
    <div class="stories">${issue.stories.map(story).join("")}</div></section>`;
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
<link rel="stylesheet" href="/news/news.css"></head><body><div class="sheet">
<header><a class="wordmark" href="/" aria-label="Balkhaev — на главную">balkhaev<span>.</span></a>
<a class="channel" href="https://t.me/bestburyat">Telegram-канал <span aria-hidden="true">↗</span></a></header>
<main><div class="lead"><p class="kicker"><span class="dot"></span> Дайджест раз в два дня</p>
<h1>Новости <em>AI</em></h1><p class="intro">Крупные релизы, открытые веса и новые возможности. Коротко, с&nbsp;первоисточниками.</p></div>
${ordered.map(edition).join("")}</main>
<footer><a href="/">← На главную</a><a href="https://t.me/bestburyat">Читать в Telegram ↗</a></footer></div></body></html>`;
}

import { escapeHTML } from "bun";
