import { expect, test } from "bun:test";

import { LANGS, RESUMES } from "./content";
import { CV_PATHS, renderCv } from "./render";

const shape = (lang: (typeof LANGS)[number]) => {
  const cv = RESUMES[lang];
  return {
    earlier: cv.earlier.map((job) => [job.company, job.points.length]),
    jobs: cv.jobs.map((job) => [job.sites, job.points.length]),
    projects: cv.projects.map((project) => project.url),
    skills: cv.skills.length,
    web: cv.web.map((job) => job.points.length),
  };
};

test("both languages describe the same career", () => {
  expect(shape("ru")).toEqual(shape("en"));
});

test("each page names its language and links to the other one", () => {
  for (const lang of LANGS) {
    const html = renderCv(lang);
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain(`href="/cv/${RESUMES[lang].pdf}"`);
    for (const other of LANGS) {
      expect(html).toContain(
        `href="https://balkhaev.com${CV_PATHS[other]}" hreflang="${other}"`
      );
    }
  }
});

test("printing points every asset at the given folder", () => {
  const html = renderCv("en", "file:///site/public/cv/");
  expect(html).toContain('href="file:///site/public/cv/cv.css"');
  expect(html).toContain('src="file:///site/public/cv/photo.jpg"');
});
