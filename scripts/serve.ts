import { posix } from "node:path";
import { file as readFile, serve } from "bun";

const ROOT = `${process.cwd()}/dist`;

serve({
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const path = posix.normalize(
      decodeURIComponent(pathname).replaceAll("\\", "/")
    );
    if (path.includes("..")) {
      return new Response("Not found", { status: 404 });
    }
    const target = readFile(`${ROOT}${path}`);
    if (!path.endsWith("/") && (await target.exists())) {
      return new Response(target, { headers: { "Cache-Control": "no-store" } });
    }
    const index = readFile(
      `${ROOT}${path}${path.endsWith("/") ? "" : "/"}index.html`
    );
    if (!(await index.exists())) {
      return new Response("Not found", { status: 404 });
    }
    if (!path.endsWith("/")) {
      return new Response(null, {
        headers: { Location: `${path}/` },
        status: 301,
      });
    }
    return new Response(index, { headers: { "Cache-Control": "no-store" } });
  },
  hostname: "127.0.0.1",
  port: 4175,
});
