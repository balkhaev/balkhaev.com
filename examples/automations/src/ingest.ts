// src/ingest.ts
import { sql } from "./db";
import { enqueue, type NewJob } from "./queue";
import type { Source } from "./sources";

/** Stores a verified event and its jobs in one transaction. */
export async function ingest(
  name: string,
  source: Source,
  headers: Headers,
  body: string
) {
  // Routing errors must not lose the event: store it anyway, without jobs
  let dedupKey: string | undefined;
  let jobs: NewJob[] = [];
  try {
    dedupKey = source.dedupKey(body);
    jobs = source.route(body);
  } catch (error) {
    console.error(`cannot route ${name} event`, error);
  }

  return await sql.begin(async (tx) => {
    const [event] = await tx`
      insert into events (source, headers, body, dedup_key)
      values (${name}, ${Object.fromEntries(headers)}, ${body}, ${dedupKey ?? null})
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
}
