// src/server.ts
import { config } from "./config";
import { sql } from "./db";
import { leadForm } from "./forms";
import { ingest } from "./ingest";
import { pay } from "./pay";
import { sources } from "./sources";

const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: 1024 * 1024, // 1 MB is plenty for a webhook
  routes: {
    "/health": async () => {
      await sql`select 1`;
      return Response.json({ ok: true });
    },
    "/forms/lead": { POST: leadForm },
    "/pay/:id": { GET: pay },
    // Where YooKassa sends the client back after paying
    "/paid": () =>
      new Response(
        "<!doctype html><meta charset=utf-8><title>Thank you</title>" +
          "<p>Thank you! As soon as the payment goes through, we will email you access.</p>",
        { headers: { "content-type": "text/html; charset=utf-8" } }
      ),
    "/hooks/:source": {
      POST: async (req) => {
        const name = req.params.source;
        const source = sources[name];
        if (!source) {
          return new Response("Unknown source", { status: 404 });
        }
        const body = await req.text();
        if (!source.verify(req.headers, body)) {
          return new Response("Bad signature", { status: 401 });
        }
        const result = await ingest(name, source, req.headers, body);
        return Response.json(result, { status: 202 });
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

console.log(`listening on :${server.port}`);

process.on("SIGTERM", async () => {
  await server.stop();
  await sql.close();
  process.exit(0);
});
