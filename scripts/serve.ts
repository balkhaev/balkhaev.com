import { file as readFile, serve } from "bun";

const files = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/style.css", "style.css"],
  ["/icon.svg", "icon.svg"],
  ["/robots.txt", "robots.txt"],
  ["/sitemap.xml", "sitemap.xml"],
  ["/cv/", "cv/index.html"],
]);
const CV_ASSET = /^\/cv\/(?:fonts\/)?[\w-]+\.(?:css|jpg|pdf|woff2)$/;
serve({
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/cv") {
      return new Response(null, { headers: { Location: "/cv/" }, status: 301 });
    }
    const file =
      files.get(pathname) ??
      (CV_ASSET.test(pathname) ? pathname.slice(1) : undefined);
    return file
      ? new Response(readFile(`dist/${file}`), {
          headers: { "Cache-Control": "no-store" },
        })
      : new Response("Not found", { status: 404 });
  },
  hostname: "127.0.0.1",
  port: 4175,
});
