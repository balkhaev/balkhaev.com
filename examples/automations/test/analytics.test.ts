// test/analytics.test.ts
import { beforeEach, expect, test } from "bun:test";
import { evaluate, runChecks } from "../src/alerts";
import { config } from "../src/config";
import { sql } from "../src/db";
import { sendDigest, trend } from "../src/digest";
import { dayStats, startOfDay } from "../src/metrics";
import { calls, claude, reset } from "./stubs";

const HOUR = 60 * 60 * 1000;
const now = new Date();
const yesterday = (hour: number, minute = 0) =>
  new Date(startOfDay(now, 1).getTime() + hour * HOUR + minute * 60_000);
const messages = (chat: string) =>
  calls.filter((c) => c.method === "sendMessage" && String(c.body.chat_id) === chat);

beforeEach(async () => {
  reset();
  await sql`truncate leads, tickets, accesses, orders, jobs, alerts, llm_usage restart identity cascade`;
});

async function seedYesterday() {
  await sql`
    insert into leads (id, name, contact, message, status, qualification, created_at, taken_at) values
      ('a', 'A', 'a@x.io', '', 'taken', ${{ temperature: "hot", spam: false, summary: "Store by December" }},
       ${yesterday(10)}, ${yesterday(10, 8)}),
      ('b', 'B', 'b@x.io', '', 'spam', ${{ temperature: "cold", spam: true, summary: "SEO offer" }},
       ${yesterday(11)}, null),
      ('c', 'C', 'c@x.io', '', 'new', null, ${now}, null)
  `;
  await sql`
    insert into orders (id, email, description, amount, status, created_at, paid_at) values
      ('o1', 'a@x.io', 'Site', 1500000, 'paid', ${yesterday(-30)}, ${yesterday(12)}),
      ('o2', 'b@x.io', 'Fix', 500000, 'pending', ${yesterday(13)}, null)
  `;
  await sql`
    insert into tickets (source_id, channel, customer, message, status, draft_used, triage, created_at, answered_at)
    values ('t1', 'email', 'a@x.io', 'Hi', 'answered', true,
            ${{ category: "question", summary: "Asks about hosting" }}, ${yesterday(9)}, ${yesterday(9, 40)})
  `;
}

test("day stats count only what happened inside the day", async () => {
  await seedYesterday();
  const stats = await dayStats(startOfDay(now, 1), startOfDay(now, 0));
  expect(stats).toEqual({
    leads: 2,
    hot: 1,
    spam: 1,
    untaken: 0,
    takeMinutes: 8,
    invoiced: 1,
    invoicedSum: 500000,
    paid: 1,
    paidSum: 1500000,
    tickets: 1,
    answered: 1,
    answerMinutes: 40,
    draftsUsed: 1,
    failedJobs: 0,
    llmRequests: 0,
    llmCost: 0,
  });
});

test("the trend arrow shows only changes over 30%", () => {
  expect(trend(14, 10)).toBe(" ▲");
  expect(trend(12, 10)).toBe("");
  expect(trend(6, 10)).toBe(" ▼");
  expect(trend(0, 0)).toBe("");
  expect(trend(2, 0)).toBe(" ▲");
});

test("the digest carries the model's highlights, and goes out without them if the model fails", async () => {
  await seedYesterday();
  claude.answer = { highlights: ["Twice as many leads as usual"] };
  await sendDigest(now);
  const first = messages(config.digestChatId).at(-1)!.body.text;
  expect(first).toContain("<b>Leads:</b> 2 (avg 0) ▲");
  expect(first).toContain("Twice as many leads as usual");

  const request = calls.find((c) => c.api === "claude")!.body;
  expect(request.messages[0].content).toContain('"weekAverage"');
  expect(request.messages[0].content).toContain("lead: Store by December");
  expect(request.messages[0].content).not.toContain("SEO offer"); // spam stays out

  claude.status = 400;
  await sendDigest(now);
  const second = messages(config.digestChatId).at(-1)!.body.text;
  expect(second).toContain("<b>Payments:</b> 1");
  expect(second).not.toContain("What stands out");
});

test("a silence alert fires once and resolves once", async () => {
  // Two leads an hour for two weeks, then nothing for the last 10 hours
  await sql`
    insert into leads (id, name, contact, message, created_at)
    select 'old' || g, 'X', 'x@x.io', '', now() - interval '10 hours' - g * interval '30 minutes'
    from generate_series(0, 14 * 48 - 21) as g
  `;
  await evaluate(await runChecks());
  await evaluate(await runChecks());
  const alerts = () => messages(config.alertChatId).map((c) => c.body.text);
  expect(alerts()).toHaveLength(1);
  expect(alerts()[0]).toStartWith("🚨 No leads for 10 h");

  await sql`insert into leads (id, name, contact, message) values ('fresh', 'Y', 'y@x.io', '')`;
  await evaluate(await runChecks());
  await evaluate(await runChecks());
  expect(alerts()).toHaveLength(2);
  expect(alerts()[1]).toStartWith("✅ Back to normal");
});

test("overdue jobs raise the queue lag alert", async () => {
  await sql`insert into jobs (kind, run_at) values ('x', now() - interval '20 minutes')`;
  const checks = await runChecks();
  expect(checks.find((c) => c.name === "queue.lag")!.firing).toBe(true);
  expect(checks.find((c) => c.name === "payments.silence")!.firing).toBe(false);
});
