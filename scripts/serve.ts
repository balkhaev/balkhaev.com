import { file as readFile, serve } from "bun";

const files = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/style.css", "style.css"],
  ["/icon.svg", "icon.svg"],
  ["/robots.txt", "robots.txt"],
  ["/sitemap.xml", "sitemap.xml"],
]);
serve({
  fetch(request) {
    const file = files.get(new URL(request.url).pathname);
    return file
      ? new Response(readFile(`dist/${file}`), {
          headers: { "Cache-Control": "no-store" },
        })
      : new Response("Not found", { status: 404 });
  },
  hostname: "127.0.0.1",
  port: 4175,
});
