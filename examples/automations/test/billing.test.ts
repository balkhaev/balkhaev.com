// test/billing.test.ts
import { beforeEach, expect, test } from "bun:test";
import { config } from "../src/config";
import { sql } from "../src/db";
import { handlers } from "../src/handlers";
import { markPaid, parseInvoice, payRedirect } from "../src/orders";
import type { Job } from "../src/queue";
import { calls, payments, reset } from "./stubs";

const job = {} as Job;
const DAY = 24 * 60 * 60 * 1000;
const sent = (api: string) => calls.filter((c) => c.api === api);

async function invoice(messageId = 1, text = "/invoice anna@example.com 15000 Landing page") {
  await handlers["telegram.message"](
    { message_id: messageId, chat: { id: Number(config.leadsChatId) }, from: { username: "ivan" }, text },
    job
  );
  return `tg-${config.leadsChatId}-${messageId}`;
}

beforeEach(async () => {
  reset();
  await sql`truncate accesses, orders, jobs restart identity cascade`;
});

test("the invoice command is parsed in rubles and kopecks", () => {
  expect(parseInvoice("/invoice a@b.co 15000 Site")).toEqual({
    email: "a@b.co",
    amount: 1_500_000,
    description: "Site",
  });
  expect(parseInvoice("/invoice@MyBot a@b.co 99,90 Fix")?.amount).toBe(9990);
  expect(parseInvoice("/invoice nonsense")).toBeUndefined();
});

test("a retried command creates one order, and only the managers' chat may invoice", async () => {
  await invoice(1);
  await invoice(1);
  await handlers["telegram.message"](
    { message_id: 2, chat: { id: 555 }, from: { username: "x" }, text: "/invoice a@b.co 1 X" },
    job
  );
  const orders = await sql`select id, amount, status from orders`;
  expect(orders).toEqual([{ id: `tg-${config.leadsChatId}-1`, amount: 1_500_000, status: "pending" }]);
});

test("the pay link reuses a live payment and replaces a canceled one", async () => {
  const id = await invoice();
  const first = await payRedirect(id);
  expect(await payRedirect(id)).toBe(first); // same payment on a second click
  expect(sent("yookassa").filter((c) => c.method === "payments")).toHaveLength(1);

  payments.get("pay-1").status = "canceled";
  const second = await payRedirect(id);
  expect(second).not.toBe(first);
  const [order] = await sql`select payment_id from orders where id = ${id}`;
  expect(order.payment_id).toBe("pay-2");
});

test("a payment confirmed many times fulfils the order once", async () => {
  const id = await invoice();
  await payRedirect(id);
  payments.get("pay-1").status = "succeeded";

  // A webhook, its redelivery and a reconciliation all report the same payment
  await handlers["payment.check"]({ paymentId: "pay-1" }, job);
  await handlers["payment.check"]({ paymentId: "pay-1" }, job);
  await handlers["payment.check"]({ paymentId: "pay-1" }, job);

  const fulfil = await sql`select count(*)::int as n from jobs where kind = 'order.fulfill'`;
  expect(fulfil[0].n).toBe(1);
  await handlers["order.fulfill"]({ id }, job);
  await handlers["order.fulfill"]({ id }, job);
  const [{ n }] = await sql`select count(*)::int as n from accesses`;
  expect(n).toBe(1);
});

test("a second, different payment for a paid order raises an alert", async () => {
  const id = await invoice();
  const payment = (pid: string) => ({
    id: pid,
    status: "succeeded" as const,
    amount: { value: "15000.00", currency: "RUB" },
    metadata: { order_id: id },
  });
  await markPaid(id, payment("pay-a"));
  await markPaid(id, payment("pay-b"));
  const alerts = sent("telegram").filter((c) => String(c.body.text).includes("paid twice"));
  expect(alerts).toHaveLength(1);
});

test("a payment with the wrong amount does not mark the order paid", async () => {
  const id = await invoice();
  await markPaid(id, {
    id: "pay-x",
    status: "succeeded",
    amount: { value: "1.00", currency: "RUB" },
    metadata: { order_id: id },
  });
  const [order] = await sql`select status from orders where id = ${id}`;
  expect(order.status).toBe("pending");
});

test("reminders go out on days 3, 7 and 14 and stop after payment", async () => {
  const id = await invoice();
  const age = async (days: number) => {
    await sql`update orders set created_at = ${new Date(Date.now() - days * DAY)} where id = ${id}`;
    await handlers["invoices.remind"]({}, job);
    const due = await sql`select payload from jobs where kind = 'order.remind' and status = 'pending'`;
    for (const { payload } of due) {
      await handlers["order.remind"](payload, job);
      await sql`update jobs set status = 'done' where kind = 'order.remind'`;
    }
  };
  await age(1);
  await age(3);
  await age(3); // the same day again: no second reminder
  await age(8);
  expect(sent("email").filter((c) => c.body.subject.startsWith("Reminder"))).toHaveLength(2);

  await sql`update orders set status = 'paid' where id = ${id}`;
  await age(15);
  expect(sent("email").filter((c) => c.body.subject.startsWith("Reminder"))).toHaveLength(2);
});
