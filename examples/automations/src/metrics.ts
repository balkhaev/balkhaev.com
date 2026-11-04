// src/metrics.ts
import { sql } from "./db";

/** One day of the business in numbers. Every number comes from SQL, never from the model. */
export interface DayStats {
  leads: number;
  hot: number;
  spam: number;
  untaken: number;
  takeMinutes: number | null;
  invoiced: number;
  invoicedSum: number;
  paid: number;
  paidSum: number;
  tickets: number;
  answered: number;
  answerMinutes: number | null;
  draftsUsed: number;
  failedJobs: number;
  llmRequests: number;
  llmCost: number;
}

/** Midnight in the server's time zone (TZ in compose.yml), `daysAgo` days back. */
export function startOfDay(now: Date, daysAgo = 0) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - daysAgo);
  return day;
}

export async function dayStats(from: Date, to: Date): Promise<DayStats> {
  const [leads] = await sql`
    select
      count(*)::int as leads,
      count(*) filter (where qualification->>'temperature' = 'hot'
                         and status <> 'spam'
                         and (qualification->>'spam')::boolean is not true)::int as hot,
      count(*) filter (where status = 'spam' or (qualification->>'spam')::boolean)::int as spam,
      count(*) filter (where status = 'new' and (qualification->>'spam')::boolean is not true)::int as untaken,
      percentile_cont(0.5) within group (
        order by extract(epoch from taken_at - created_at) / 60
      ) filter (where status = 'taken') as take_minutes
    from leads where created_at >= ${from} and created_at < ${to}
  `;
  const [invoiced] = await sql`
    select count(*)::int as n, coalesce(sum(amount), 0)::bigint as sum
    from orders where created_at >= ${from} and created_at < ${to}
  `;
  const [paid] = await sql`
    select count(*)::int as n, coalesce(sum(amount), 0)::bigint as sum
    from orders where paid_at >= ${from} and paid_at < ${to}
  `;
  const [tickets] = await sql`
    select count(*)::int as n from tickets where created_at >= ${from} and created_at < ${to}
  `;
  const [answers] = await sql`
    select
      count(*)::int as n,
      count(*) filter (where draft_used)::int as drafts,
      percentile_cont(0.5) within group (
        order by extract(epoch from answered_at - created_at) / 60
      ) as minutes
    from tickets where answered_at >= ${from} and answered_at < ${to}
  `;
  const [jobs] = await sql`
    select count(*)::int as n from jobs
    where status = 'failed' and finished_at >= ${from} and finished_at < ${to}
  `;
  const [llm] = await sql`
    select count(*)::int as n, coalesce(sum(cost), 0)::float8 as cost from llm_usage
    where created_at >= ${from} and created_at < ${to}
  `;
  const minutes = (value: number | null) => (value === null ? null : Math.round(Number(value)));
  return {
    leads: leads.leads,
    hot: leads.hot,
    spam: leads.spam,
    untaken: leads.untaken,
    takeMinutes: minutes(leads.take_minutes),
    invoiced: invoiced.n,
    invoicedSum: Number(invoiced.sum),
    paid: paid.n,
    paidSum: Number(paid.sum),
    tickets: tickets.n,
    answered: answers.n,
    answerMinutes: minutes(answers.minutes),
    draftsUsed: answers.drafts,
    failedJobs: jobs.n,
    llmRequests: llm.n,
    llmCost: llm.cost,
  };
}

/** Yesterday, and the average day over the 7 days before it. */
export async function yesterdayVsWeek(now = new Date()) {
  const yesterday = await dayStats(startOfDay(now, 1), startOfDay(now, 0));
  const week: DayStats[] = [];
  for (let i = 2; i <= 8; i++) {
    week.push(await dayStats(startOfDay(now, i), startOfDay(now, i - 1)));
  }
  const average = {} as Record<keyof DayStats, number>;
  for (const key of Object.keys(yesterday) as (keyof DayStats)[]) {
    average[key] = week.reduce((total, day) => total + (day[key] ?? 0), 0) / week.length;
  }
  return { from: startOfDay(now, 1), to: startOfDay(now, 0), yesterday, average };
}

/** What is true right now, not per day: debts and the support queue. */
export async function currentState() {
  const [overdue] = await sql`
    select count(*)::int as n, coalesce(sum(amount), 0)::bigint as sum from orders
    where status = 'pending' and created_at < now() - interval '14 days'
  `;
  const [open] = await sql`select count(*)::int as n from tickets where status = 'new'`;
  return { overdue: overdue.n, overdueSum: Number(overdue.sum), openTickets: open.n };
}
