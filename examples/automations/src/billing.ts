// src/billing.ts
import { config } from "./config";
import { sql } from "./db";
import { sendEmail } from "./email";
import {
  createOrder,
  getOrder,
  markPaid,
  money,
  parseInvoice,
  payLink,
} from "./orders";
import { enqueue, type Job } from "./queue";
import { sendMessage } from "./telegram";
import { getPayment } from "./yookassa";

type Handler = (payload: any, job: Job) => Promise<void>;

const DAY = 24 * 60 * 60 * 1000;
const REMIND_AFTER_DAYS = [3, 7, 14];

/** `/invoice email amount description`, only from the managers' chat. */
export async function invoiceCommand(message: any) {
  if (String(message.chat.id) !== String(config.leadsChatId)) {
    return;
  }
  const input = parseInvoice(message.text);
  if (!input) {
    await sendMessage(message.chat.id, "Usage: /invoice client@example.com 15000 What it is for");
    return;
  }
  const who = message.from.username ? `@${message.from.username}` : message.from.first_name;
  // The id comes from the message, so a retried job doesn't create a second order
  const id = await createOrder({
    ...input,
    id: `tg-${message.chat.id}-${message.message_id}`,
    createdBy: who,
  });
  await sendMessage(
    message.chat.id,
    `Invoice for ${money(input.amount)} sent to ${input.email}.\nPayment link: ${payLink({ id })}`
  );
}

export const billingHandlers: Record<string, Handler> = {
  "order.invoice": async ({ id }) => {
    const order = await getOrder(id);
    if (!order || order.status !== "pending") {
      return;
    }
    await sendEmail(
      order.email,
      `Invoice: ${order.description}`,
      `Hello!\n\nHere is your invoice for "${order.description}", ${money(order.amount)}.\n` +
        `Pay by card here: ${payLink(order)}\n\nThe link does not expire.`
    );
  },

  // From a notification or reconciliation: ask YooKassa what really happened
  "payment.check": async ({ paymentId }) => {
    const payment = await getPayment(paymentId);
    if (!payment) {
      console.warn(`payment ${paymentId} does not exist`); // a forged notification
      return;
    }
    if (payment.status === "succeeded" && payment.metadata?.order_id) {
      await markPaid(payment.metadata.order_id, payment);
    }
    // canceled: nothing to do, the /pay link creates a new payment on the next click
  },

  // Paid: grant access once, then tell the client and the team
  "order.fulfill": async ({ id }) => {
    const token = crypto.randomUUID();
    await sql`
      insert into accesses (order_id, token) values (${id}, ${token})
      on conflict (order_id) do nothing
    `;
    await enqueue({ kind: "order.access_email", payload: { id }, key: `order.access_email:${id}` });
    await enqueue({ kind: "order.paid_notice", payload: { id }, key: `order.paid_notice:${id}` });
  },

  "order.access_email": async ({ id }) => {
    const order = await getOrder(id);
    const [access] = await sql`select token from accesses where order_id = ${id}`;
    await sendEmail(
      order!.email,
      `Payment received: ${order!.description}`,
      `Thank you! We have received ${money(order!.amount)}.\n` +
        `Your access: ${config.accessUrl}${access.token}`
    );
  },

  "order.paid_notice": async ({ id }) => {
    const order = await getOrder(id);
    await sendMessage(
      config.leadsChatId,
      `💰 Paid ${money(order!.amount)}: ${order!.description} (${order!.email})`
    );
  },

  // Every morning: who should get a reminder today
  "invoices.remind": async () => {
    const orders = await sql`
      select id, reminders, created_at from orders where status = 'pending'
    `;
    for (const order of orders) {
      const step = order.reminders;
      const age = Date.now() - new Date(order.created_at).getTime();
      if (step < REMIND_AFTER_DAYS.length && age >= REMIND_AFTER_DAYS[step] * DAY) {
        const n = step + 1;
        await enqueue({
          kind: "order.remind",
          payload: { id: order.id, n },
          key: `order.remind:${order.id}:${n}`,
        });
      }
    }
  },

  "order.remind": async ({ id, n }) => {
    const order = await getOrder(id);
    if (!order || order.status !== "pending") {
      return; // paid in the meantime: the chain stops by itself
    }
    await sendEmail(
      order.email,
      `Reminder: invoice for ${order.description}`,
      `Hello! A gentle reminder about the invoice for "${order.description}", ` +
        `${money(order.amount)}.\nPay here: ${payLink(order)}\n\n` +
        "If you have already paid or something is wrong, just reply to this email."
    );
    await sql`update orders set reminders = greatest(reminders, ${n}) where id = ${id}`;
    if (n === REMIND_AFTER_DAYS.length) {
      await sendMessage(
        config.leadsChatId,
        `📞 ${order.email} has not paid "${order.description}" for ${REMIND_AFTER_DAYS.at(-1)} days. Worth a call.`
      );
    }
  },

  // Every hour: catch payments whose notification never arrived
  "payments.reconcile": async () => {
    const orders = await sql`
      select payment_id from orders
      where status = 'pending' and payment_id is not null
        and created_at > now() - interval '30 days'
    `;
    for (const order of orders) {
      await enqueue({ kind: "payment.check", payload: { paymentId: order.payment_id } });
    }
  },
};
