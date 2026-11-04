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
