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
