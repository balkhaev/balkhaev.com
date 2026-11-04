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
