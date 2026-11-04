// src/forms.ts
import { config } from "./config";
import { sql } from "./db";
import { ingest } from "./ingest";
import { sources } from "./sources";

const MAX_PER_IP = 5; // submissions per 10 minutes

/**
 * A plain HTML form posts here straight from the browser. There is no secret
 * to sign with, so instead: a honeypot field, a per-IP limit and length checks.
 */
export async function leadForm(req: Request) {
  const back = Response.redirect(config.formRedirectUrl, 303);
  const form = await req.formData();
  const field = (name: string, max: number) =>
    String(form.get(name) ?? "").trim().slice(0, max);

  // Bots fill every field, people never see this one
  if (field("website", 100)) {
    return back;
  }
  const contact = field("contact", 200);
  if (!contact) {
    return new Response("Please leave a phone number or email", { status: 400 });
  }

  // Caddy sets X-Forwarded-For to the client's address
  const ip = req.headers.get("x-forwarded-for") ?? "";
  const [{ count }] = await sql`
    select count(*)::int as count from events
    where source = 'site'
      and received_at > now() - interval '10 minutes'
      and headers->>'x-forwarded-for' = ${ip}
  `;
  if (count >= MAX_PER_IP) {
    return new Response("Too many requests", { status: 429 });
  }

  const body = JSON.stringify({
    id: crypto.randomUUID(),
    name: field("name", 200) || "No name",
    contact,
    message: field("message", 4000),
    page: req.headers.get("referer") ?? "",
  });
  await ingest("site", sources.site, req.headers, body);
  return back;
}
