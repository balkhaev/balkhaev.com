type Language = "en" | "ru";
type Section = "home" | "blog" | "news";

export function siteHeader(
  lang: Language,
  section: Section,
  languageLinks = ""
) {
  const ru = lang === "ru";
  const blog = ru ? "/blog/ru/" : "/blog/";
  const role = {
    blog: ru
      ? "Блог · AI-агенты и автоматизации"
      : "Blog · AI agents and automations",
    home: "ML-инженер · генеративный AI · Москва",
    news: "Дайджест · Искусственный интеллект",
  }[section];
  return `<header class="topbar">
    <a class="topbar-site" href="/">balkhaev.com</a>
    ${section === "blog" ? `<a class="topbar-role" href="${blog}">${role}</a>` : `<span class="topbar-role">${role}</span>`}
    <nav aria-label="${ru ? "Разделы" : "Sections"}" class="topbar-nav">
      <a href="${blog}"${section === "blog" ? ' aria-current="location"' : ""}>${ru ? "Блог" : "Blog"}</a>
      <a href="/news/"${section === "news" ? ' aria-current="page"' : ""}${ru ? "" : ' hreflang="ru"'}>${ru ? "Новости AI" : "AI news"}</a>
      <a href="${ru ? "/cv/ru/" : "/cv/"}">${ru ? "Резюме" : "Resume"}</a>
      <a href="https://t.me/balkhaev" rel="noopener noreferrer" target="_blank">Telegram</a>
      ${languageLinks}
    </nav>
  </header>`;
}

export function siteFooter(lang: Language, link: string) {
  const ru = lang === "ru";
  return `<footer class="site-foot">
    <span>© 2026 ${ru ? "Михаил Бальхаев" : "Mikhail Balkhaev"}</span>
    ${link}
    <a href="#top">${ru ? "Наверх" : "Back to top"} <span aria-hidden="true">↑</span></a>
  </footer>`;
}
