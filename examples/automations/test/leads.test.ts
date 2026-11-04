// test/leads.test.ts: needs DATABASE_URL and the stub API addresses (see stubs.ts)
import { beforeEach, expect, test } from "bun:test";
import { sql } from "../src/db";
import { handlers } from "../src/handlers";
import { keyboard, type Lead, renderCard } from "../src/leads";
import type { Job } from "../src/queue";
import { calls, reset } from "./stubs";

const job = {} as Job;
const lead: Lead = {
  id: "l1",
  name: "Anna <script>",
  contact: "anna@example.com",
  message: "Need a store & a blog",
  status: "new",
  qualification: null,
  manager: null,
  telegram_message_id: null,
  crm_id: null,
};

beforeEach(async () => {
  reset();
  await sql`truncate leads, jobs restart identity cascade`;
});

test("the card escapes HTML and shows buttons only while new", () => {
  const card = renderCard(lead);
  expect(card).toContain("Anna &lt;script&gt;");
  expect(card).toContain("store &amp; a blog");
  expect(keyboard(lead).inline_keyboard).toHaveLength(1);
  expect(keyboard({ ...lead, status: "taken" }).inline_keyboard).toHaveLength(0);
});

test("a form becomes a lead with notify, qualify, crm and reminder jobs, once", async () => {
  const form = { id: "f1", name: "Anna", contact: "+79001234567", message: "Hi" };
  await handlers["site.form"](form, job);
  await handlers["site.form"](form, job); // a retry must not duplicate anything
  const jobs = await sql`select kind from jobs order by kind`;
  expect(jobs.map((j: { kind: string }) => j.kind)).toEqual([
    "lead.crm",
    "lead.notify",
    "lead.qualify",
    "lead.remind",
  ]);
});

test("the card is sent once even if notify runs twice", async () => {
  await handlers["site.form"]({ id: "f2", name: "B", contact: "b@x.io", message: "" }, job);
  await handlers["lead.notify"]({ id: "f2" }, job);
  await handlers["lead.notify"]({ id: "f2" }, job);
  expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
  const [row] = await sql`select telegram_message_id from leads where id = 'f2'`;
  expect(Number(row.telegram_message_id)).toBe(777);
});

test("when two managers press at once, one gets the lead", async () => {
  await handlers["site.form"]({ id: "f3", name: "C", contact: "c@x.io", message: "" }, job);
  const press = (username: string, queryId: string) =>
    handlers["telegram.callback"](
      { id: queryId, data: "take:f3", from: { username, first_name: username } },
      job
    );
  await Promise.all([press("ivan", "q1"), press("olga", "q2")]);
  const [row] = await sql`select status, manager from leads where id = 'f3'`;
  expect(row.status).toBe("taken");
  const answers = calls.filter((c) => c.method === "answerCallbackQuery");
  const texts = answers.map((a) => a.body.text).sort();
  expect(texts).toEqual(["Done", "Someone was faster"]);
  expect(answers.find((a) => a.body.text === "Done")!.body.callback_query_id).toBe(
    row.manager === "@ivan" ? "q1" : "q2"
  );
});

test("a lead nobody took gets a reminder and then an escalation", async () => {
  await handlers["site.form"]({ id: "f4", name: "D", contact: "d@x.io", message: "" }, job);
  await handlers["lead.remind"]({ id: "f4", step: 1 }, job);
  expect(calls.at(-1)!.body.text).toContain("15 minutes");
  const [next] = await sql`select key from jobs where key = 'lead.remind:f4:2'`;
  expect(next).toBeDefined();

  await sql`update leads set status = 'taken' where id = 'f4'`;
  reset();
  await handlers["lead.remind"]({ id: "f4", step: 2 }, job);
  expect(calls).toHaveLength(0); // taken: nobody is bothered
});
