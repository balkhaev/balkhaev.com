// src/orders.ts
import { config } from "./config";
import { sql } from "./db";
import { enqueue } from "./queue";
import { alert } from "./telegram";
import { createPayment, getPayment, type Payment } from "./yookassa";

export interface Order {
  id: string;
  email: string;
  description: string;
  amount: number;
  status: "pending" | "paid";
  payment_id: string | null;
  paid_payment_id: string | null;
  reminders: number;
  created_at: Date;
}

export async function getOrder(id: string): Promise<Order | undefined> {
  const [order] = await sql`select * from orders where id = ${id}`;
  return order;
}

export const payLink = (order: { id: string }) => `${config.publicUrl}/pay/${order.id}`;

/** "15 000 ₽" for messages. */
export const money = (kopecks: number) =>
  `${(kopecks / 100).toLocaleString("ru-RU")} ₽`;

/** `/invoice anna@example.com 15000 Landing page` from the managers' chat. */
export function parseInvoice(text: string) {
  const match = /^\/invoice(?:@\w+)?\s+(\S+@\S+)\s+(\d+(?:[.,]\d{1,2})?)\s+(.+)$/s.exec(
    text.trim()
  );
  if (!match) {
    return undefined;
  }
  const amount = Math.round(Number(match[2].replace(",", ".")) * 100);
  return { email: match[1], amount, description: match[3].trim() };
}

/** `id` comes from the caller so that a retried job creates the same order. */
export async function createOrder(input: {
  id: string;
  email: string;
  amount: number;
  description: string;
  createdBy: string;
}) {
  const { id } = input;
  await sql`
    insert into orders (id, email, amount, description, created_by)
    values (${id}, ${input.email}, ${input.amount}, ${input.description}, ${input.createdBy})
    on conflict (id) do nothing
  `;
  await enqueue({ kind: "order.invoice", payload: { id }, key: `order.invoice:${id}` });
  return id;
}

/**
 * The link in every email. It never expires: on each click we find a live
 * payment or create a new one, so a reminder sent two weeks later still works.
 */
export async function payRedirect(id: string): Promise<string | undefined> {
  const order = await getOrder(id);
  if (!order) {
    return undefined;
  }
  const thanks = `${config.publicUrl}/paid`;
  if (order.status === "paid") {
    return thanks;
  }
  if (order.payment_id) {
    const payment = await getPayment(order.payment_id);
    if (payment?.status === "succeeded") {
      await markPaid(order.id, payment); // the webhook hasn't arrived yet
      return thanks;
    }
    if (payment?.status === "pending" && payment.confirmation?.confirmation_url) {
      return payment.confirmation.confirmation_url;
    }
  }
  // No payment yet, or the previous one was canceled. Two clicks at once
  // compute the same key, so YooKassa returns the same payment to both.
  const payment = await createPayment({
    idempotenceKey: `${order.id}:${order.payment_id ?? "first"}`,
    orderId: order.id,
    amount: order.amount,
    description: order.description,
    returnUrl: thanks,
  });
  await sql`update orders set payment_id = ${payment.id} where id = ${order.id}`;
  return payment.confirmation!.confirmation_url!;
}

/**
 * The only place an order becomes paid. "where status = 'pending'" makes it
 * happen once, however many webhooks, reconciliations and clicks report it.
 */
export async function markPaid(orderId: string, payment: Payment) {
  const order = await getOrder(orderId);
  if (!order) {
    await alert(`Payment ${payment.id} for an unknown order ${orderId}`);
    return;
  }
  if (Math.round(Number(payment.amount.value) * 100) !== order.amount) {
    await alert(`Payment ${payment.id}: amount ${payment.amount.value} does not match order ${orderId}`);
    return;
  }
  const [won] = await sql`
    update orders set status = 'paid', paid_at = now(), paid_payment_id = ${payment.id}
    where id = ${orderId} and status = 'pending'
    returning id
  `;
  if (won) {
    await enqueue({ kind: "order.fulfill", payload: { id: orderId }, key: `order.fulfill:${orderId}` });
  } else if (order.paid_payment_id !== payment.id) {
    // Paid twice with two different payments: a person decides on the refund
    await alert(`Order ${orderId} was paid twice: ${order.paid_payment_id} and ${payment.id}. Refund one.`);
  }
}
