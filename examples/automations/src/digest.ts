// src/digest.ts
import { askJson } from "./claude";
import { config } from "./config";
import { sql } from "./db";
import { currentState, type DayStats, yesterdayVsWeek } from "./metrics";
import { money } from "./orders";
import { html, tg } from "./telegram";

/** ▲ or ▼ when a number is more than 30% away from the weekly average. */
export function trend(value: number, average: number) {
  if (average < 1 && value < 1) {
    return "";
  }
  const change = (value - average) / Math.max(average, 1);
  if (change > 0.3) {
    return " ▲";
  }
  if (change < -0.3) {
    return " ▼";
  }
  return "";
}

const avg = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

export function renderDigest(
  day: Date,
  y: DayStats,
  a: Record<keyof DayStats, number>,
  now: { overdue: number; overdueSum: number; openTickets: number },
  highlights: string[]
) {
  const date = day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const lines = [
    `<b>📊 Yesterday, ${date}</b>`,
    "",
    `<b>Leads:</b> ${y.leads} (avg ${avg(a.leads)})${trend(y.leads, a.leads)} · 🔥 ${y.hot} · spam ${y.spam}`,
    `taken in a median of ${y.takeMinutes ?? "–"} min · not taken: ${y.untaken}`,
    `<b>Payments:</b> ${y.paid} for ${money(y.paidSum)} (avg ${money(Math.round(a.paidSum))})${trend(y.paidSum, a.paidSum)}`,
    `invoiced: ${y.invoiced} for ${money(y.invoicedSum)} · overdue over 14 days: ${now.overdue} for ${money(now.overdueSum)}`,
    `<b>Support:</b> ${y.tickets} tickets (avg ${avg(a.tickets)})${trend(y.tickets, a.tickets)} · answered ${y.answered}, median ${y.answerMinutes ?? "–"} min`,
    `drafts sent as is: ${y.draftsUsed} of ${y.answered} · open now: ${now.openTickets}`,
  ];
  lines.push(
    `<b>Claude:</b> ${y.llmRequests} requests for $${y.llmCost.toFixed(2)} (avg $${a.llmCost.toFixed(2)})${trend(y.llmCost, a.llmCost)}`
  );
  if (y.failedJobs > 0) {
    lines.push(`<b>Failed jobs:</b> ${y.failedJobs}`);
  }
  if (highlights.length > 0) {
    lines.push("", "<b>What stands out:</b>", ...highlights.map((h) => `• ${html(h)}`));
  }
  return lines.join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    highlights: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["highlights"],
  additionalProperties: false,
};

const SYSTEM = `You help the owner of a small web studio read the morning digest.
You get yesterday's numbers, the average day of the previous week, and short
summaries of yesterday's leads and support tickets.
Name up to three things worth the owner's attention: a change against the week,
a pattern in what clients ask for, a risk. Each one sentence.
Use only the numbers given; never calculate new ones. If nothing stands out,
return an empty list. Write in English.`;

/** What clients wrote about yesterday, in the model's own summaries from parts 4 and 6. */
async function yesterdaySummaries(from: Date, to: Date) {
  const leads = await sql`
    select qualification->>'summary' as s from leads
    where created_at >= ${from} and created_at < ${to} and qualification is not null
      and (qualification->>'spam')::boolean is not true
  `;
  const tickets = await sql`
    select triage->>'category' as c, triage->>'summary' as s from tickets
    where created_at >= ${from} and created_at < ${to} and triage is not null
  `;
  return [
    ...leads.map((l: any) => `lead: ${l.s}`),
    ...tickets.map((t: any) => `ticket (${t.c}): ${t.s}`),
  ].join("\n");
}

export async function sendDigest(now = new Date()) {
  const { from, to, yesterday, average } = await yesterdayVsWeek(now);
  const state = await currentState();
  let highlights: string[] = [];
  try {
    const summaries = await yesterdaySummaries(from, to);
    const answer = await askJson<{ highlights: string[] }>({
      task: "digest",
      system: SYSTEM,
      content:
        `<numbers>\n${JSON.stringify({ yesterday, weekAverage: average, now: state })}\n</numbers>\n\n` +
        `<summaries>\n${summaries || "none"}\n</summaries>`,
      schema: SCHEMA,
      effort: "low",
    });
    highlights = answer.highlights.slice(0, 3);
  } catch (error) {
    // The numbers matter more than the commentary: send the digest without it
    console.error("digest commentary failed", error);
  }
  await tg("sendMessage", {
    chat_id: config.digestChatId,
    text: renderDigest(from, yesterday, average, state, highlights),
    parse_mode: "HTML",
  });
}
