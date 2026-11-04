---
title: "The core: events, a queue and retries"
description: Verify webhook signatures, drop duplicate events, write a job queue on Postgres, a worker with retries and a schedule. The core every automation in the series runs on.
date: 2026-11-04
series: automations
part: 3
tags: [automation, postgres, webhooks, reliability]
---

:::tldr
The intake verifies the signature, stores the event and, in the same transaction, puts jobs into a queue. A separate worker takes jobs with `FOR UPDATE SKIP LOCKED`, retries them with a growing delay on failure and sends a Telegram alert after the last attempt. The schedule puts jobs into the same queue with an idempotency key, so each one runs exactly once. All of it is about 300 lines with no external dependencies.
:::

This is the third part of the series on commercial automations. In the [previous part](/blog/automations-foundation/) we set up a server, a database and deploys, and the service learned to store incoming events in a table. Now we teach it to process those events reliably. This is the most "infrastructural" part of the series, but after it every new automation takes a few dozen lines: an event source and a handler.

## What can go wrong

Before writing code, let's list what we are protecting against. All of it happens within the first month of any automation.

- **Forged requests.** A webhook URL is easy to find, and anyone can send a fake "payment".
- **Repeated delivery.** Payment providers and Telegram deliver events "at least once": if our answer got lost on the way, they send the same event again.
- **An external service is down.** The CRM is down, Telegram answered 502, the model API is overloaded. A minute later everything works.
- **The worker dies mid-job.** A deploy, running out of memory, a server reboot.
- **A bug in our code.** The job fails on every attempt until we fix the code.
- **Nobody notices.** The most dangerous one: an automation silently does nothing for a week.

## How it fits together

```text
  POST /hooks/:source
         |
         v
  check signature ---- bad ----> 401
         |
         v
  +-------------- one transaction ------------------+
  |  events: store (duplicate -> do nothing)        |
  |  jobs:   enqueue jobs                           |
  +-------------------------------------------------+
         |
         v
       202
                     worker (separate container)
                     +-------------------------------+
                     |  claim: take a job            |
                     |  handler: run it              |
                     |  ok      -> done              |
                     |  failure -> pending, later    |
                     |  give up -> failed + alert    |
                     +-------------------------------+
```

The key idea: the HTTP handler does nothing but write to the database. It is fast and almost never fails, so the sender always gets an answer, and all the slow, unreliable work moves into the worker, where it can be retried.

## Step 1. The jobs table

The second migration adds a deduplication key to events and creates the queue.

```sql
-- migrations/002_jobs.sql
alter table events add column dedup_key text;
create unique index events_source_dedup on events (source, dedup_key);

create table jobs (
  id bigint generated always as identity primary key,
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 8,
  run_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  key text unique,
  event_id bigint references events (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index jobs_due on jobs (run_at) where status in ('pending', 'running');
```

The fields all the reliability rests on:

- `status`: `pending` is waiting, `running` is in progress, `done` is finished, `failed` has failed for good;
- `run_at`: not before when to run. Both delayed jobs ("remind in 15 minutes") and the pauses between retries work through it;
- `locked_until`: until when the job counts as taken. If the worker died, another one picks the job up after this moment;
- `key`: the idempotency key. A second job with the same key is not created;
- `event_id`: which event the job grew out of. That answers "why did this happen".

`events` gets a unique index on `(source, dedup_key)`. In Postgres, `NULL` values in a unique index count as distinct, so events without a key are all stored, and events with a key only once.

## Step 2. The queue

```ts
// src/queue.ts
import type { SQL } from "bun";
import { sql } from "./db";

export interface NewJob {
  kind: string;
  payload?: unknown;
  /** Idempotency key: a second job with the same key is not created. */
  key?: string;
  runAt?: Date;
  eventId?: number;
  maxAttempts?: number;
}

export interface Job {
  id: number;
  kind: string;
  payload: any;
  attempts: number;
  max_attempts: number;
}

/** Adds a job. Pass `tx` to enqueue in the same transaction as other writes. */
export async function enqueue(job: NewJob, tx: SQL = sql) {
  await tx`
    insert into jobs (kind, payload, key, run_at, event_id, max_attempts)
    values (
      ${job.kind},
      ${job.payload ?? {}},
      ${job.key ?? null},
      ${job.runAt ?? new Date()},
      ${job.eventId ?? null},
      ${job.maxAttempts ?? 8}
    )
    on conflict (key) do nothing
  `;
}

const LOCK = "5 minutes";

/**
 * Takes one due job and marks it running. Jobs left "running" by a crashed
 * worker come back once their lock expires. SKIP LOCKED lets several workers
 * claim jobs at once without taking the same one.
 */
export async function claim(): Promise<Job | undefined> {
  const [job] = await sql`
    update jobs
    set status = 'running',
        attempts = attempts + 1,
        locked_until = now() + ${LOCK}::interval
    where id = (
      select id from jobs
      where (status = 'pending' and run_at <= now())
         or (status = 'running' and locked_until < now())
      order by run_at
      for update skip locked
      limit 1
    )
    returning id, kind, payload, attempts, max_attempts
  `;
  return job;
}

export async function complete(job: Job) {
  await sql`
    update jobs set status = 'done', finished_at = now(), last_error = null
    where id = ${job.id}
  `;
}

/** Delay before the next attempt: 10s, 20s, 40s... capped at an hour, with jitter. */
export function backoff(attempts: number): number {
  const base = Math.min(10_000 * 2 ** (attempts - 1), 3_600_000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** Records the error. Returns true if the job has failed for good. */
export async function fail(job: Job, error: string, permanent: boolean) {
  const final = permanent || job.attempts >= job.max_attempts;
  if (final) {
    await sql`
      update jobs set status = 'failed', finished_at = now(), last_error = ${error}
      where id = ${job.id}
    `;
  } else {
    const runAt = new Date(Date.now() + backoff(job.attempts));
    await sql`
      update jobs set status = 'pending', run_at = ${runAt}, last_error = ${error}
      where id = ${job.id}
    `;
  }
  return final;
}
```

The interesting bit is `claim`. The subquery picks one due job and locks its row, and `SKIP LOCKED` says: if another worker has already locked the row, don't wait, take the next one. So you can run ten workers and they will never take the same job twice. The outer `update` marks the job as taken right away and bumps the attempt counter.

The condition `status = 'running' and locked_until < now()` picks up stuck jobs: a worker took the job and died. Five minutes of lock should comfortably cover any job; if yours take longer, raise `LOCK`.

The delay between attempts doubles: 10 seconds, 20, 40 and so on up to an hour. The 20% random jitter keeps a hundred jobs that failed at once because of a CRM outage from hitting it again at once. Eight attempts by default stretch over about 40 minutes, and most temporary outages pass in that time.

## Step 3. Which errors to retry

Not everything is worth retrying. If the CRM answered 503, it may work in a minute. If it answered 400 "invalid phone number", it never will, and eight attempts only delay the alert by 40 minutes.

```ts
// src/errors.ts
/** An error that retrying will not fix: bad data, a rejected request. */
export class PermanentError extends Error {}

/** Throws a PermanentError for 4xx answers and a regular one for the rest. */
export async function check(response: Response, what: string) {
  if (response.ok) {
    return;
  }
  const text = await response.text();
  const message = `${what}: ${response.status} ${text.slice(0, 500)}`;
  // 429 means "too many requests": worth retrying later
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    throw new PermanentError(message);
  }
  throw new Error(message);
}
```

`check` comes in handy in every integration: call an external API, pass the response to `check`, and the error comes out with the right type. The exception is 429, "too many requests", where retrying later is exactly right.

## Step 4. Telegram for replies and alerts

First, the new settings. All of them are required, so the service won't start without them:

```ts
// src/config.ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  // Secrets for verifying incoming webhooks
  siteSecret: required("SITE_WEBHOOK_SECRET"),
  telegramSecret: required("TELEGRAM_WEBHOOK_SECRET"),
  // Bot for replies and alerts
  telegramToken: required("TELEGRAM_BOT_TOKEN"),
  telegramApi: process.env.TELEGRAM_API ?? "https://api.telegram.org",
  alertChatId: required("ALERT_CHAT_ID"),
};
```

And a tiny Telegram client:

```ts
// src/telegram.ts
import { config } from "./config";
import { check } from "./errors";

export async function sendMessage(chatId: number | string, text: string) {
  const response = await fetch(
    `${config.telegramApi}/bot${config.telegramToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    }
  );
  await check(response, "telegram sendMessage");
}

/** Message to the team's alert chat. Never throws: an alert must not break the caller. */
export async function alert(text: string) {
  try {
    await sendMessage(config.alertChatId, text);
  } catch (error) {
    console.error("alert failed", error, text);
  }
}
```

Every external request has a timeout. Without one, a hung service holds the worker forever and the queue stops. `alert` never throws: if the alert fails too, we log it, but we don't break the code that called it.

The API address is a setting, `TELEGRAM_API`, so tests can point it at a stub.

Create the bot with [@BotFather](https://t.me/BotFather), which gives you a token. The alert chat is an ordinary group the bot has been added to; the easiest way to find its id is to post a message in the group and open `https://api.telegram.org/bot<token>/getUpdates`.

## Step 5. Event sources

Each source describes three things: how to check that a request is genuine, how to get the event id for deduplication, and which jobs the event produces.

```ts
// src/sources.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import type { NewJob } from "./queue";

export interface Source {
  /** Checks that the request really comes from this source. */
  verify(headers: Headers, body: string): boolean;
  /** Event id from the sender: the same event delivered twice gets the same key. */
  dedupKey(body: string): string | undefined;
  /** Which jobs the event produces. */
  route(body: string): NewJob[];
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Header `x-signature: sha256=<hex HMAC of the body>`, as GitHub and many others do it. */
export function hmacValid(secret: string, body: string, header: string | null) {
  if (!header) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return safeEqual(expected, header);
}

export const sources: Record<string, Source> = {
  // Our website's backend signs every request with a shared secret
  site: {
    verify: (headers, body) =>
      hmacValid(config.siteSecret, body, headers.get("x-signature")),
    dedupKey: (body) => JSON.parse(body).id,
    route: (body) => [{ kind: "site.form", payload: JSON.parse(body) }],
  },

  // Telegram sends the secret_token from setWebhook in this header
  telegram: {
    verify: (headers) =>
      safeEqual(
        headers.get("x-telegram-bot-api-secret-token") ?? "",
        config.telegramSecret
      ),
    dedupKey: (body) => String(JSON.parse(body).update_id),
    route: (body) => {
      const update = JSON.parse(body);
      if (!update.message?.text) {
        return [];
      }
      return [{ kind: "telegram.message", payload: update.message }];
    },
  },
};
```

Two verification schemes cover almost every service:

**HMAC signature.** The sender and we share a secret. The sender computes HMAC-SHA256 of the request body and puts it in a header; we compute the same and compare. Without the secret the signature cannot be forged, and the body cannot be changed unnoticed. GitHub, Stripe and many other services work this way; only the header name and format differ. Some payment providers send no signature at all; they need a different check, which we cover in the payments part. That is why we store the body as text: the signature covers the exact bytes, and JSON that was parsed and serialized again will not pass.

**Secret in a header.** Simpler and weaker: the secret is sent as is. Telegram works this way: when registering the webhook we pass a `secret_token`, and Telegram sends it back in the `X-Telegram-Bot-Api-Secret-Token` header with every update.

In both cases we compare with `timingSafeEqual`, not `===`. A plain string comparison stops at the first mismatching character, and response timing can be used to guess the secret character by character.

We connect the `site` source to the form in the next part. A secret cannot live in the browser, so the request will be signed by the website's backend or a small function that receives the form.

## Step 6. The intake

```ts
// src/server.ts
import { config } from "./config";
import { sql } from "./db";
import { enqueue, type NewJob } from "./queue";
import { sources } from "./sources";

const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: 1024 * 1024, // 1 MB is plenty for a webhook
  routes: {
    "/health": async () => {
      await sql`select 1`;
      return Response.json({ ok: true });
    },
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

        // Routing errors must not lose the event: store it anyway, without jobs
        let dedupKey: string | undefined;
        let jobs: NewJob[] = [];
        try {
          dedupKey = source.dedupKey(body);
          jobs = source.route(body);
        } catch (error) {
          console.error(`cannot route ${name} event`, error);
        }

        const headers = Object.fromEntries(req.headers);
        const result = await sql.begin(async (tx) => {
          const [event] = await tx`
            insert into events (source, headers, body, dedup_key)
            values (${name}, ${headers}, ${body}, ${dedupKey ?? null})
            on conflict (source, dedup_key) do nothing
            returning id
          `;
          if (!event) {
            return { duplicate: true };
          }
          for (const job of jobs) {
            await enqueue({ ...job, eventId: event.id }, tx);
          }
          return { id: event.id, jobs: jobs.length };
        });
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
```

The order of operations:

1. An unknown source gets 404, a bad signature 401. Nothing is written to the database: this is junk.
2. Parse the event. If parsing fails, that is our bug rather than the sender's, so we still store the event, just without jobs. Once the code is fixed, it can be replayed.
3. The event and its jobs are written in one transaction. There is never an event without its jobs or jobs without their event.
4. If an event with this key already exists, `on conflict do nothing` inserts nothing and `returning` comes back empty. We answer 202 so the sender stops redelivering, and we don't create the jobs a second time.

The answer is always fast: a couple of inserts. That matters, because many services treat a slow answer as a failure and send the event again.

## Step 7. Handlers

A handler is a function that receives the job's `payload`. There are three for now; real automations appear here in the next parts.

```ts
// src/handlers.ts
import type { Job } from "./queue";
import { sendMessage } from "./telegram";

type Handler = (payload: any, job: Job) => Promise<void>;

export const handlers: Record<string, Handler> = {
  // For now just confirm we received the form. Part 4 turns this into lead handling.
  "site.form": async (form) => {
    console.log("form received", form.id);
  },

  "telegram.message": async (message) => {
    if (message.text === "/ping") {
      await sendMessage(message.chat.id, "pong");
    }
  },

  // Scheduled: proves the schedule and the queue are alive
  heartbeat: async () => {
    console.log("heartbeat", new Date().toISOString());
  },
};
```

The main rule for handlers: **running again must do no harm**. The worker can run the handler, send a message and die before it marks the job done. Then the job runs once more. For sending "pong" that's fine; for granting access or charging money you have to check whether it has already been done. We'll come back to this in the payments part.

## Step 8. The schedule

Classic cron on the server is a poor fit: if the service was down at run time, the run is lost, and with two workers the job runs twice. Let's build the schedule on the same queue.

```ts
// src/schedule.ts
import { enqueue } from "./queue";

export type Schedule =
  | { kind: string; everyMinutes: number }
  | { kind: string; dailyAt: string }; // "09:00" in the server's TZ

export const schedules: Schedule[] = [{ kind: "heartbeat", everyMinutes: 60 }];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The current run slot of a schedule, or null if it is not due yet.
 * The slot becomes the job key, so each slot runs once no matter how many
 * workers check it or how often.
 */
export function slot(schedule: Schedule, now: Date): string | null {
  if ("everyMinutes" in schedule) {
    const ms = schedule.everyMinutes * 60_000;
    return new Date(Math.floor(now.getTime() / ms) * ms).toISOString();
  }
  const [hours, minutes] = schedule.dailyAt.split(":").map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hours * 60 + minutes) {
    return null;
  }
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function enqueueDue(now = new Date()) {
  for (const schedule of schedules) {
    const current = slot(schedule, now);
    if (current) {
      await enqueue({ kind: schedule.kind, key: `${schedule.kind}:${current}` });
    }
  }
}
```

The idea is in the key. For an hourly job the key is the start of the current hour; for a daily one it is today's date. Every 30 seconds the worker tries to enqueue a job with that key, and the unique index lets only the first attempt through. This gives three useful properties:

- however many workers run, there is one job per slot;
- if the worker was down at 9:00 and came back at 9:40, the daily job still runs today;
- the `jobs` table shows when each slot actually ran and with what error.

Daily times are computed in the process's time zone, which we set with the `TZ` variable in the compose file.

## Step 9. The worker

```ts
// src/worker.ts
import { sql } from "./db";
import { PermanentError } from "./errors";
import { handlers } from "./handlers";
import { claim, complete, fail, type Job } from "./queue";
import { enqueueDue } from "./schedule";
import { alert } from "./telegram";

let running = true;
process.on("SIGTERM", () => {
  running = false;
});

async function run(job: Job) {
  const handler = handlers[job.kind];
  try {
    if (!handler) {
      throw new PermanentError(`no handler for ${job.kind}`);
    }
    await handler(job.payload, job);
    await complete(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await fail(job, message, error instanceof PermanentError);
    console.error(`job ${job.id} ${job.kind} attempt ${job.attempts}: ${message}`);
    if (failed) {
      await alert(`Job ${job.id} (${job.kind}) failed: ${message}`);
    }
  }
}

let lastScheduleCheck = 0;

while (running) {
  if (Date.now() - lastScheduleCheck > 30_000) {
    await enqueueDue();
    lastScheduleCheck = Date.now();
  }
  const job = await claim();
  if (job) {
    await run(job);
  } else {
    await Bun.sleep(1000);
  }
}

await sql.close();
console.log("worker stopped");
```

The loop is simple: check the schedule every 30 seconds, take a job, run it, and if there are no jobs, wait a second. A one-second delay on an empty queue is invisible to the business and puts no load on the database. If you ever need faster reactions, Postgres has `LISTEN/NOTIFY` for that, but our jobs don't need it.

On SIGTERM the worker doesn't abandon a job halfway: the `running` flag stops the loop after the current job.

If the database itself goes down, `claim` throws, the process exits, and Docker restarts it thanks to `restart: unless-stopped`. No special handling needed.

## Step 10. Manual controls

Jobs will fail, and you need a quick way to see the failed ones, retry them after a fix and replay an event.

```ts
// src/cli.ts: bun src/cli.ts failed | retry <job id> | replay <event id>
import { sql } from "./db";
import { enqueue } from "./queue";
import { sources } from "./sources";

const [command, id] = process.argv.slice(2);

if (command === "failed") {
  const rows = await sql`
    select id, kind, attempts, finished_at, last_error from jobs
    where status = 'failed' order by id desc limit 50
  `;
  console.table(rows);
} else if (command === "retry") {
  // Fresh attempts for a failed job, e.g. after fixing the bug
  await sql`
    update jobs set status = 'pending', attempts = 0, run_at = now(), last_error = null
    where id = ${Number(id)} and status = 'failed'
  `;
  console.log(`job ${id} queued again`);
} else if (command === "replay") {
  // Route a stored event again: new jobs, without waiting for the sender
  const [event] = await sql`select id, source, body from events where id = ${Number(id)}`;
  const jobs = sources[event.source].route(event.body);
  for (const job of jobs) {
    await enqueue({ ...job, eventId: event.id });
  }
  console.log(`event ${id}: ${jobs.length} jobs queued`);
} else {
  console.log("usage: bun src/cli.ts failed | retry <job id> | replay <event id>");
}

await sql.close();
```

On the server:

```bash
docker compose exec app bun src/cli.ts failed
docker compose exec app bun src/cli.ts retry 42
docker compose exec app bun src/cli.ts replay 1337
```

## Step 11. Tests

The queue is code that must always work, so its tests run against a real Postgres rather than mocks: everything interesting here happens in SQL.

```ts
// test/queue.test.ts: needs DATABASE_URL pointing at an empty test database
import { beforeEach, expect, test } from "bun:test";
import { sql } from "../src/db";
import { backoff, claim, complete, enqueue, fail } from "../src/queue";

beforeEach(async () => {
  await sql`truncate jobs restart identity cascade`;
});

test("a job with the same key is enqueued once", async () => {
  await enqueue({ kind: "a", key: "k1" });
  await enqueue({ kind: "a", key: "k1" });
  const [{ count }] = await sql`select count(*)::int as count from jobs`;
  expect(count).toBe(1);
});

test("parallel workers never take the same job", async () => {
  for (let i = 0; i < 20; i++) {
    await enqueue({ kind: "a", payload: { i } });
  }
  const claimed = await Promise.all(Array.from({ length: 30 }, () => claim()));
  const ids = claimed.filter(Boolean).map((job) => job!.id);
  expect(ids.length).toBe(20);
  expect(new Set(ids).size).toBe(20);
});

test("a failed attempt is retried later, then fails for good", async () => {
  await enqueue({ kind: "a", maxAttempts: 2 });
  const first = (await claim())!;
  expect(await fail(first, "boom", false)).toBe(false);
  expect(await claim()).toBeUndefined(); // waits for the backoff

  await sql`update jobs set run_at = now()`;
  const second = (await claim())!;
  expect(second.attempts).toBe(2);
  expect(await fail(second, "boom", false)).toBe(true);
  const [job] = await sql`select status, last_error from jobs`;
  expect(job).toEqual({ status: "failed", last_error: "boom" });
});

test("a job stuck in running comes back after its lock expires", async () => {
  await enqueue({ kind: "a" });
  const job = (await claim())!;
  await sql`update jobs set locked_until = now() - interval '1 second'`;
  const again = (await claim())!;
  expect(again.id).toBe(job.id);
  await complete(again);
  expect(await claim()).toBeUndefined();
});

test("backoff grows and is capped at an hour", () => {
  expect(backoff(1)).toBeLessThanOrEqual(12_000);
  expect(backoff(4)).toBeGreaterThanOrEqual(64_000);
  expect(backoff(30)).toBeLessThanOrEqual(3_600_000 * 1.2);
});
```

And quick schedule tests, no database needed:

```ts
// test/schedule.test.ts
import { expect, test } from "bun:test";
import { slot } from "../src/schedule";

test("hourly slot is the start of the hour", () => {
  const now = new Date("2026-11-04T10:42:00Z");
  expect(slot({ kind: "x", everyMinutes: 60 }, now)).toBe("2026-11-04T10:00:00.000Z");
});

test("daily slot appears only after the time", () => {
  const schedule = { kind: "digest", dailyAt: "09:00" };
  expect(slot(schedule, new Date(2026, 10, 4, 8, 59))).toBeNull();
  expect(slot(schedule, new Date(2026, 10, 4, 9, 0))).toBe("2026-11-04");
  expect(slot(schedule, new Date(2026, 10, 4, 23, 0))).toBe("2026-11-04");
});
```

Add the scripts `"worker": "bun src/worker.ts"` and `"test": "bun test"` to `package.json`, and the `test` folder to `include` in `tsconfig.json`.

Locally, tests run against a separate database:

```bash
docker exec pg createdb -U postgres app_test
DATABASE_URL=postgres://postgres:dev@localhost:5432/app_test bun src/migrate.ts
DATABASE_URL=postgres://postgres:dev@localhost:5432/app_test bun test
```

```text
 7 pass
 0 fail
```

## Step 12. Deploying

The worker runs from the same image as the server, just with a different command. To avoid repeating settings, the shared part moves into a YAML anchor:

```yaml
# compose.yml
x-app: &app
  image: ghcr.io/your-name/automations:${TAG:-latest}
  restart: unless-stopped
  env_file: .env
  environment:
    DATABASE_URL: postgres://app:${POSTGRES_PASSWORD}@db:5432/app
    TZ: Europe/Moscow
  depends_on:
    db:
      condition: service_healthy

services:
  app:
    <<: *app

  worker:
    <<: *app
    command: ["bun", "src/worker.ts"]
    stop_grace_period: 60s

  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      retries: 10

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  pgdata:
  caddy_data:
  caddy_config:
```

`stop_grace_period: 60s` gives the worker a minute to finish its current job during a deploy. In `deploy.sh`, pull both images: `docker compose pull app worker`.

In CI, add Postgres as a service and run the tests before building the image. If tests fail, there is no deploy:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run check
      - name: Tests
        env:
          DATABASE_URL: postgres://postgres:test@localhost:5432/postgres
          SITE_WEBHOOK_SECRET: test
          TELEGRAM_WEBHOOK_SECRET: test
          TELEGRAM_BOT_TOKEN: test
          ALERT_CHAT_ID: "0"
        run: |
          bun src/migrate.ts
          bun test
      # then build the image and deploy, as in the previous part
```

On the server, append the new secrets to `.env`. Webhook secrets are random:

```bash
cd /opt/automations
cat >> .env <<EOF
SITE_WEBHOOK_SECRET=$(openssl rand -hex 32)
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
TELEGRAM_BOT_TOKEN=token-from-botfather
ALERT_CHAT_ID=-100xxxxxxxxxx
EOF
```

After the deploy, register the webhook with Telegram:

```bash
curl https://api.telegram.org/bot<token>/setWebhook \
  -d url=https://auto.example.com/hooks/telegram \
  -d secret_token=<TELEGRAM_WEBHOOK_SECRET from .env>
```

Send the bot `/ping` and get `pong` back. That means the whole chain works: Telegram, Caddy, the secret check, the event in the database, the job in the queue, the worker, the reply through the API.

## Testing failures

The interesting part: making sure the system survives the things we built it for. Here is a local run against a Telegram API stub that answers the first request with 502:

| What we did | What happened |
|---|---|
| Sent the same Telegram update twice | first answer `{"id":"1","jobs":1}`, second `{"duplicate":true}`, one job |
| Sent it with a wrong secret | 401, nothing in the database |
| Telegram answered 502 to `sendMessage` | the job went back to `pending`, the second attempt ~10 seconds later succeeded, `attempts = 2` |
| Sent a non-JSON body to `site` with a valid signature | event stored, 0 jobs, error in the log |
| Enqueued a job of an unknown kind | `failed` on the first attempt, the alert chat got "Job 4 (nope) failed: no handler for nope" |
| Stopped the worker during a deploy | finished the current job and exited in a fraction of a second |

## What we have

- Webhooks are verified by signature or secret, duplicates are dropped by event id.
- The event and its jobs are stored atomically, before any external work.
- A queue on Postgres with no broker: parallel workers, delayed jobs, retries with growing delays, recovery of stuck jobs.
- Permanent errors are not retried in vain, final failures arrive as Telegram alerts.
- A schedule on the same queue: exactly one run per slot, catching up on missed ones.
- Queue tests against a real database in CI, before every deploy.

The foundation is done. In the [next part](/blog/automations-sales/) we build the first real automation: a form submission turns into a card for a manager in Telegram within a minute, the model pulls out of free text what the client needs, and if nobody takes the lead, the bot sends a reminder.
