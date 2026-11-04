// test/support.test.ts
import { beforeEach, expect, test } from "bun:test";
import { config } from "../src/config";
import { sql } from "../src/db";
import { handlers } from "../src/handlers";
import type { Job } from "../src/queue";
import { sources } from "../src/sources";
import { calls, claude, reset } from "./stubs";

const job = {} as Job;
const sent = (api: string, method?: string) =>
  calls.filter((c) => c.api === api && (!method || c.method === method));

const draft = {
  category: "billing",
  urgent: false,
  summary: "Paid but has no access",
  needs_human: false,
  reason: "",
  draft: "Hello! Access is on its way. Support team",
};

/** Runs the jobs of one kind that are waiting in the queue. */
async function run(kind: string) {
  const due = await sql`select id, payload from jobs where kind = ${kind} and status = 'pending'`;
  for (const { id, payload } of due) {
    await handlers[kind](payload, job);
    await sql`update jobs set status = 'done' where id = ${id}`;
  }
}

const privateMessage = (id: number, text: string) => ({
  message_id: id,
  chat: { id: 4242, type: "private" },
  from: { first_name: "Anna", username: "anna" },
  text,
});

beforeEach(async () => {
  reset();
  claude.answer = draft;
  await sql`truncate tickets, accesses, orders, jobs restart identity cascade`;
});

test("the email source checks the password and keeps only the fields it needs", () => {
  const auth = (secret: string) => new Headers({ authorization: `Basic ${btoa(`postmark:${secret}`)}` });
  const body = JSON.stringify({
    MessageID: "m1",
    From: "anna@example.com",
    Subject: "Hi",
    TextBody: "text",
    Attachments: [{ Content: "a".repeat(1000) }],
  });
  expect(sources.email.verify(auth(config.emailInboundSecret), body)).toBe(true);
  expect(sources.email.verify(auth("wrong"), body)).toBe(false);
  expect(sources.email.verify(new Headers(), body)).toBe(false);
  const [routed] = sources.email.route(body);
  expect(routed.kind).toBe("email.incoming");
  expect(routed.payload).not.toHaveProperty("Attachments");
});

test("a private message becomes one ticket with one card, however often it is processed", async () => {
  await handlers["telegram.message"](privateMessage(1, "/start"), job);
  await handlers["telegram.message"](privateMessage(2, "My site is down"), job);
  await handlers["telegram.message"](privateMessage(2, "My site is down"), job);
  await run("support.notify");
  await handlers["support.notify"]({ id: 1 }, job);

  const tickets = await sql`select customer, name from tickets`;
  expect(tickets).toEqual([{ customer: "4242", name: "Anna (@anna)" }]);
  expect(sent("telegram", "sendMessage")).toHaveLength(1);
});

test("triage sees the cached knowledge base and the client's orders, the card shows the draft", async () => {
  await sql`
    insert into orders (id, email, description, amount, status)
    values ('o1', 'anna@example.com', 'Landing page', 1500000, 'paid')
  `;
  await handlers["email.incoming"](
    { MessageID: "m1", From: "anna@example.com", FromName: "Anna", Subject: "No access", TextBody: "I paid" },
    job
  );
  await run("support.notify");
  await run("support.triage");

  const request = sent("claude")[0].body;
  expect(request.system[1].cache_control).toEqual({ type: "ephemeral" });
  expect(request.system[1].text).toContain("Refunds are decided by a manager");
  expect(request.messages[0].content).toContain("Landing page");
  expect(request.messages[0].content).toContain("I paid");

  const edit = sent("telegram", "editMessageText").at(-1)!.body;
  expect(edit.text).toContain("Access is on its way");
  expect(edit.reply_markup.inline_keyboard[0][0].callback_data).toBe("send:1");
});

test("when two agents press Send at once, the client gets one answer", async () => {
  await handlers["email.incoming"](
    { MessageID: "m2", From: "bob@example.com", FromName: "Bob", Subject: "Access", TextBody: "?" },
    job
  );
  await run("support.notify");
  await run("support.triage");
  const press = (username: string, id: string) =>
    handlers["telegram.callback"]({ id, data: "send:1", from: { username } }, job);
  await Promise.all([press("ivan", "q1"), press("olga", "q2")]);
  await run("support.send");

  const emails = sent("email");
  expect(emails).toHaveLength(1);
  expect(emails[0].body).toMatchObject({ to: "bob@example.com", subject: "Re: Access", text: draft.draft });
  const answers = sent("telegram", "answerCallbackQuery").map((c) => c.body.text).sort();
  expect(answers).toEqual(["Done", "Someone was faster"]);
  const [ticket] = await sql`select status, draft_used from tickets`;
  expect(ticket).toEqual({ status: "answered", draft_used: true });
});

test("an agent's reply to the card goes to the client instead of the draft", async () => {
  await handlers["telegram.message"](privateMessage(5, "How long does a fix take?"), job);
  await run("support.notify");
  await run("support.triage");
  await handlers["telegram.message"](
    {
      message_id: 900,
      chat: { id: Number(config.supportChatId), type: "supergroup" },
      from: { username: "olga" },
      reply_to_message: { message_id: 777 }, // the card's id from the Telegram stub
      text: "Up to 2 working days. Olga",
    },
    job
  );
  await run("support.send");

  const toClient = sent("telegram", "sendMessage").filter((c) => c.body.chat_id === "4242");
  expect(toClient.map((c) => c.body.text)).toEqual(["Up to 2 working days. Olga"]);
  const [ticket] = await sql`select agent, draft_used from tickets`;
  expect(ticket).toEqual({ agent: "@olga", draft_used: false });
});

test("the reminder fires only for a ticket nobody answered", async () => {
  await handlers["telegram.message"](privateMessage(6, "Hello?"), job);
  await handlers["telegram.message"](privateMessage(7, "Thanks, all good"), job);
  await handlers["telegram.callback"]({ id: "q", data: "close:2", from: { username: "ivan" } }, job);
  await run("support.remind");

  const reminders = sent("telegram", "sendMessage").filter((c) => String(c.body.text).startsWith("⏰"));
  expect(reminders.map((c) => c.body.text)).toEqual(["⏰ Ticket #1 from Anna (@anna) has waited an hour"]);
});
