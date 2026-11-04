---
title: "Replacing the analyst: a morning digest and alerts"
description: Every morning Telegram gets a digest of yesterday's leads, payments and support, compared with the week and with commentary from Claude. When something goes suspiciously quiet or gets stuck, the system speaks up by itself, once when it starts and once when it ends.
date: 2026-11-04
series: automations
part: 7
tags: [automation, analytics, alerts, claude, postgres]
---

:::tldr
At 9 a.m. the bot sends a digest of yesterday: leads, payments, support, each number with the weekly average and an arrow if it differs by more than 30%. SQL computes every number; Claude only adds up to three observations worth noticing. Every 15 minutes the system checks whether leads or payments have gone quiet, whether the support queue is piling up and whether the worker is falling behind. A problem produces one message when it starts and one when it ends.
:::

This is the seventh part of the series on commercial automations and the last of the "Replacing …" parts. In the [previous part](/blog/automations-support/) we built support. The database now holds leads, payments and tickets, and every morning we can get a picture of the business out of them without asking anyone to put it together. The article shows only the key pieces of code; the full code of the series, tests included, is in the [repository](https://github.com/balkhaev/balkhaev.com/tree/main/examples/automations).

## What exactly we are replacing

In a small company the analyst is usually the owner, opening the CRM, the payment dashboard and the inbox every morning, or an employee who builds a spreadsheet once a week. The report is stale by the time it's done, and trouble gets noticed when a client calls to complain.

| A person used to | Now the system |
|---|---|
| gather yesterday's numbers from three places | a digest in Telegram at 9:00 |
| compare with a normal week | the 7-day average and ▲ ▼ arrows |
| skim leads and tickets to see what people write about | up to three observations from Claude |
| notice that the website form broke | an alert "no leads for 10 hours, though usually there would be 20" |
| notice that support is falling behind | an alert when five tickets wait over 4 hours |
| realize the problem is over | a "✅ back to normal" message with the duration |

::news{topic="automation llm-api"}

## The main rule: SQL does the numbers

A language model is good at noticing patterns in text and bad at counting. Give it raw leads and ask "how many came in yesterday", and it will almost always answer correctly, but "almost always" isn't good enough for a report. So the split is strict:

- **SQL computes every number**, and code prints it, not the model;
- **the model gets ready-made numbers** plus short summaries of leads and tickets that it wrote itself in the sales and support parts, and answers only "what's worth noticing here";
- **the model may not compute new numbers**, and its text goes in a separate block below the numbers;
- **if the model is unavailable, the digest still goes out**, just without the commentary.

## How it works

```mermaid
flowchart TD
  sched(["Schedule"])
  digest["<b>digest.daily</b>, 9:00"]
  checks["<b>alerts.check</b>, every 15 minutes"]
  db[("leads, orders, tickets, jobs")]
  sqlm["<b>metrics.ts</b><br/>yesterday and the weekly average"]
  claude["<b>Claude</b><br/>up to three observations"]
  card["Digest in Telegram"]
  rules["<b>runChecks</b><br/>silence, backlog, lag"]
  state[("alerts<br/>what is firing now")]
  alertchat["Alert chat<br/>🚨 started, ✅ ended"]
  sched --> digest
  sched --> checks
  digest --> sqlm
  db --> sqlm
  sqlm -- ready numbers --> claude
  sqlm --> card
  claude -. commentary, if it answered .-> card
  checks --> rules
  db --> rules
  rules --> state
  state -- only when the state changes --> alertchat
```

## Step 1. The alerts table and indexes

The migration creates a table of firing alerts and time indexes: `leads (created_at)`, `orders (paid_at)`, `tickets (created_at)` and `tickets (answered_at)`.

```sql
-- migrations/006_alerts.sql: the alerts firing right now
create table alerts (
  name text primary key,
  text text not null,
  since timestamptz not null default now()
);
```

The `alerts` table holds the alerts that are firing right now. The indexes are needed because the digest and the checks filter leads, payments and tickets by time every day. With thousands of rows you won't see a difference, but in a year every report would read whole tables without them.

## Step 2. Metrics

The `metrics.ts` module computes one day of the business with `dayStats(from, to)`: leads (total, hot, spam, untaken, median time to take), invoiced and paid orders with sums, tickets, answers with the median answer time and the share of drafts sent unedited, failed jobs. Each group is one SQL query, for example leads:

```sql
-- Leads for a day: how many, how many hot, and how fast they were taken (median)
select
  count(*)::int as leads,
  count(*) filter (where qualification->>'temperature' = 'hot')::int as hot,
  percentile_cont(0.5) within group (
    order by extract(epoch from taken_at - created_at) / 60
  ) filter (where status = 'taken') as take_minutes
from leads where created_at >= ${from} and created_at < ${to}
```

A few decisions worth explaining.

**The median, not the mean.** "A lead was taken in 47 minutes on average" may mean everyone took leads within five minutes and one evening lead was taken the next morning. The median ignores such an outlier and shows what usually happens. In Postgres it's `percentile_cont(0.5) within group (order by ...)`.

**Day boundaries in the server's time zone.** "Yesterday" starts at midnight Moscow time, not UTC. The app's time zone was set in `compose.yml` back in the second part (`TZ: Europe/Moscow`), and `startOfDay` computes midnight in it. The boundaries go into SQL as parameters, so the database's time zone doesn't matter.

**A 7-day average, not the day before.** Comparing yesterday with the day before is pointless: a Monday almost always differs from a Sunday. A week smooths out weekdays and random spikes.

**The current state separately.** Debts older than 14 days and open tickets aren't events of a day but what exists right now. `currentState` computes them. And `yesterdayVsWeek` calls `dayStats` for yesterday and for each of the seven days before it, and averages them.

## Step 3. The digest

The digest is built by `digest.ts`. The `trend` function adds ▲ or ▼ when yesterday's number differs from the weekly average by more than 30%. `renderDigest` lays the numbers out in three lines: leads, payments, support. For the commentary the model gets JSON with the numbers plus summaries of yesterday's leads and tickets, which it wrote itself in the earlier parts, and returns an array of at most three strings by schema. Its whole prompt:

```ts
const SYSTEM = `You help the owner of a small web studio read the morning digest.
You get yesterday's numbers, the average day of the previous week, and short
summaries of yesterday's leads and support tickets.
Name up to three things worth the owner's attention: a change against the week,
a pattern in what clients ask for, a risk. Each one sentence.
Use only the numbers given; never calculate new ones. If nothing stands out,
return an empty list. Write in English.`;
```

Things to note:

- **An arrow only above 30%.** Otherwise every line gets an arrow every day, and people stop noticing them. `Math.max(average, 1)` prevents division by zero when something didn't happen at all during the week.
- **The model gets only aggregates and summaries.** No names, phones or emails: they aren't needed for an observation like "three hot leads about online stores before New Year". Spam stays out of the summaries.
- **A model error doesn't take the digest down.** The commentary is wrapped in `try`, and on any error the digest goes out without it. If the Telegram send itself fails, the queue retries the whole job, which is safe: the message hasn't gone out yet.
- **`effort: "low"`.** Finding three notable things in a couple dozen lines is easy for the model.

Here's what the digest looks like in the chat:

```text
📊 Yesterday, Tue 3 Nov

Leads: 12 (avg 8.4) ▲ · 🔥 3 · spam 2
taken in a median of 6 min · not taken: 1
Payments: 5 for 75 000 ₽ (avg 52 000 ₽) ▲
invoiced: 7 for 98 000 ₽ · overdue over 14 days: 2 for 30 000 ₽
Support: 9 tickets (avg 6.1) ▲ · answered 8, median 42 min
drafts sent as is: 6 of 8 · open now: 1

What stands out:
• Three of the hot leads ask for an online store before the New Year sales.
• Payments are up by almost half against the week.
```

## Step 4. Alerts

The digest answers "how did yesterday go". Alerts answer a different question: "is something broken right now". The nastiest breakages are silent. The website form stopped submitting after a layout change, the payment webhook address changed, and there are no errors anywhere. There are just no leads.

In `alerts.ts` each check returns a name, a "firing" flag and a text. `runChecks` builds four checks from four short queries, and `evaluate` turns them into messages:

```ts
// evaluate: one message when a problem starts and one when it ends
if (check.firing) {
  const [started] = await sql`
    insert into alerts (name, text) values (${check.name}, ${check.text})
    on conflict (name) do nothing
    returning name
  `;
  if (started) await alert(`🚨 ${check.text}`);
} else {
  const [ended] = await sql`delete from alerts where name = ${check.name} returning since, text`;
  if (ended) await alert(`✅ Back to normal: ${ended.text}`);
}
```

**The silence rule.** Take the average number of leads per hour over the last two weeks and multiply it by the hours since the last one. That gives how many leads "should have" arrived. If it's five or more and not a single one came, it's almost certainly a breakage rather than chance: with five expected, the chance of getting none by accident is under one percent. The same rule works for payments.

The rule has a weak spot: the average covers all hours, nights and weekends included. If almost all your leads arrive on weekday afternoons, the alert may fire for nothing on Monday morning after a quiet weekend. Then raise the `expected` threshold or average over working hours only.

**An alert is a state, not a message.** Checks run every 15 minutes, and if each one sent a message, a breakage would produce 30 identical messages overnight, and the alert chat would get muted. So a firing alert is written to the `alerts` table, and a message goes out only when the row appears or disappears. `insert ... on conflict do nothing returning` and `delete ... returning` make this safe even if a check accidentally runs twice.

**What we check:**

- silence in leads and payments;
- five or more tickets waiting over 4 hours for an answer: support can't keep up;
- jobs in the queue overdue by more than 10 minutes: the worker can't keep up.

What these checks won't catch: if the worker dies completely, nobody runs them, since the worker runs them itself. That needs an outside watcher, which we cover in the [operations part](/blog/automations-ops/).

## Step 5. Hooking into the schedule

The handlers are short; all the logic already lives in the modules: `digest.daily` calls `sendDigest()`, and `alerts.check` calls `evaluate(await runChecks())`. The schedule gets two lines: `{ kind: "digest.daily", dailyAt: "09:00" }` and `{ kind: "alerts.check", everyMinutes: 15 }`. The slot keys from the core part guarantee the digest goes out once a day, however many workers are running.

## Step 6. Tests

We check that metrics count only events inside the day, that arrows appear only for a noticeable change, that the digest goes out both with the commentary and without it when the model returns an error, and that the silence alert arrives once at the start and once at the end. The Claude stub from the previous part learned to return an error. For silence the test inserts two weeks of leads at two an hour, then ten hours of nothing, and runs the checks twice in a row: exactly one alert must arrive, and after a new lead, one "✅ Back to normal".

In CI the `Tests` step gets `DIGEST_CHAT_ID: "-400"`.

## Step 7. Launch

1. Decide where the digest goes: the team chat or the owner's private chat. For a private chat, send the bot `/start` and get the chat id the same way as for the alert chat.
2. Append `DIGEST_CHAT_ID=...` to `.env` on the server.
3. Push the code: the `006_alerts.sql` migration runs during the deploy.
4. The first digest arrives the next morning at 9:00. The averages become meaningful after a week, and the silence checks start working once there is some history.

## Checking it

| What we did | What happened |
|---|---|
| Yesterday: two leads (one hot, one spam), a payment, a ticket | metrics: 2 leads, 🔥 1, spam 1, median take 8 min, 15,000 ₽ paid, median answer 40 min |
| A digest with an empty previous week | "Leads: 2 (avg 0) ▲" and the model's observation |
| What went to the model | the numbers and "lead: Store by December", no spam lead |
| The model answered 400 | the digest went out without the "What stands out" block |
| Two weeks of two leads an hour, then 10 hours of silence | one "🚨 No leads for 10 h…" alert over two checks in a row |
| A new lead arrived | one "✅ Back to normal after … min" over two checks |
| A job overdue by 20 minutes | `queue.lag` fires |

## What we have

- Every morning the picture of yesterday arrives by itself, compared with a normal week.
- All the numbers are exact, because SQL computes them. The model only suggests where to look.
- Silent breakages like a dead form show up within hours, not a week later.
- Alerts don't spam: one message when a problem starts and one when it ends.
- The digest doesn't depend on the model and goes out even when the API is down.

That completes the "Replacing …" parts. Sales, payments, support and analytics run by themselves, and people make the decisions. One part is left, ["Operations"](/blog/automations-ops/): how to watch the system itself, back it up off the server, keep secrets and what it all costs.
