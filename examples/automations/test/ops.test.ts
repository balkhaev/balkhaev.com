// test/ops.test.ts
import { beforeEach, expect, test } from "bun:test";
import { evaluate, runChecks } from "../src/alerts";
import { askJson, cost } from "../src/claude";
import { config } from "../src/config";
import { sql } from "../src/db";
import { handlers } from "../src/handlers";
import type { Job } from "../src/queue";
import { calls, claude, reset } from "./stubs";

beforeEach(async () => {
  reset();
  await sql`truncate llm_usage, alerts, jobs restart identity cascade`;
});

test("the cost counts cached input at the cache price", () => {
  const usage = {
    input_tokens: 1_000,
    cache_read_input_tokens: 10_000,
    cache_creation_input_tokens: 0,
    output_tokens: 500,
  } as any;
  // 1000 × $4 + 10 000 × $0.20 + 500 × $20, per million tokens
  expect(cost(usage)).toBeCloseTo(0.016, 6);
});

test("every model request is recorded with its tokens and cost", async () => {
  claude.answer = { ok: true };
  await askJson({ task: "test", system: "s", content: "c", schema: { type: "object" }, effort: "low" });
  const [row] = await sql`select task, model, input_tokens, output_tokens, cost::float8 from llm_usage`;
  // The stub answers with 1000 input and 100 output tokens
  expect(row).toEqual({ task: "test", model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 100, cost: 0.006 });
});

test("spending over the daily limit raises one alert", async () => {
  await sql`
    insert into llm_usage (task, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost)
    values ('x', 'm', 0, 0, 0, 0, ${config.llmDailyLimit + 1})
  `;
  await evaluate(await runChecks());
  await evaluate(await runChecks());
  const alerts = calls.filter((c) => c.method === "sendMessage" && String(c.body.text).includes("Claude has cost"));
  expect(alerts).toHaveLength(1);
});

test("the heartbeat pings the monitoring URL and fails loudly if it can't", async () => {
  config.heartbeatUrl = "http://localhost:3995/ping/abc"; // the email stub records any request
  await handlers.heartbeat({}, {} as Job);
  expect(calls.filter((c) => c.api === "email" && c.method === "abc")).toHaveLength(1);

  config.heartbeatUrl = "http://localhost:1/unreachable";
  await expect(handlers.heartbeat({}, {} as Job)).rejects.toThrow();
  config.heartbeatUrl = "";
});
