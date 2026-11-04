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
