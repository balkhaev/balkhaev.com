// src/alerts.ts
import { config } from "./config";
import { sql } from "./db";
import { alert } from "./telegram";

export interface Check {
  name: string;
  firing: boolean;
  text: string;
}

/**
 * "We would normally have had 5 of these by now, and there are none."
 * The usual rate is the average over the last 14 days. Silence is suspicious
 * when the number we would expect since the last one reaches `expected`.
 */
export function silence(
  name: string,
  what: string,
  rows: { last: Date | null; per_hour: number },
  expected = 5
): Check {
  if (!rows.last) {
    return { name, firing: false, text: "" };
  }
  const hours = (Date.now() - rows.last.getTime()) / 3_600_000;
  const usual = Number(rows.per_hour) * hours;
  return {
    name,
    firing: usual >= expected,
    text: `No ${what} for ${Math.round(hours)} h, though usually there would be about ${Math.round(usual)} by now`,
  };
}

/** Everything we watch. Each check looks at the data as it is right now. */
export async function runChecks(): Promise<Check[]> {
  const [leads] = await sql`
    select max(created_at) as last,
           count(*) filter (where created_at > now() - interval '14 days') / (14 * 24.0) as per_hour
    from leads
  `;
  const [payments] = await sql`
    select max(paid_at) as last,
           count(*) filter (where paid_at > now() - interval '14 days') / (14 * 24.0) as per_hour
    from orders
  `;
  const [support] = await sql`
    select count(*)::int as n from tickets
    where status = 'new' and created_at < now() - interval '4 hours'
  `;
  const [queue] = await sql`
    select count(*)::int as n from jobs
    where status = 'pending' and run_at < now() - interval '10 minutes'
  `;
  const [spend] = await sql`
    select coalesce(sum(cost), 0)::float8 as today from llm_usage
    where created_at >= date_trunc('day', now())
  `;
  return [
    silence("leads.silence", "leads", leads),
    silence("payments.silence", "payments", payments),
    {
      name: "support.backlog",
      firing: support.n >= 5,
      text: `${support.n} tickets have waited for an answer over 4 hours`,
    },
    {
      name: "queue.lag",
      firing: queue.n > 0,
      text: `${queue.n} jobs are overdue by more than 10 minutes: the worker is not keeping up`,
    },
    {
      name: "llm.spend",
      firing: spend.today > config.llmDailyLimit,
      text: `Claude has cost $${spend.today.toFixed(2)} today, over the $${config.llmDailyLimit} limit`,
    },
  ];
}

/**
 * An alert is a state, not a message: one message when a problem starts and
 * one when it ends, however often the checks run in between.
 */
export async function evaluate(checks: Check[]) {
  for (const check of checks) {
    if (check.firing) {
      const [started] = await sql`
        insert into alerts (name, text) values (${check.name}, ${check.text})
        on conflict (name) do nothing
        returning name
      `;
      if (started) {
        await alert(`🚨 ${check.text}`);
      }
    } else {
      const [ended] = await sql`delete from alerts where name = ${check.name} returning since, text`;
      if (ended) {
        const minutes = Math.round((Date.now() - ended.since.getTime()) / 60_000);
        await alert(`✅ Back to normal after ${minutes} min: ${ended.text}`);
      }
    }
  }
}
