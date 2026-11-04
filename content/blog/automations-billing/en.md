---
title: "Replacing the accountant: payments, access and reminders to clients who owe"
description: An invoice from one Telegram command, payment through YooKassa, a pay link that never expires, access granted exactly once, payment reconciliation and polite reminders to clients who owe that stop by themselves.
date: 2024-06-25
updated: 2026-11-04
series: automations
part: 5
tags: [automation, payments, yookassa, idempotency]
---

:::tldr
A manager types `/invoice anna@example.com 15000 Landing page` in the chat, and the client gets an email with a pay link. The link points at our service, which sends the client to a live YooKassa payment. When a payment notification arrives, we don't take its word for it: we ask YooKassa ourselves, mark the order paid exactly once, grant access and post "💰" to the chat. Every hour we reconcile unpaid orders with YooKassa, and clients who owe get reminders on days 3, 7 and 14 that stop as soon as they pay.
:::

This is the fifth part of the series on commercial automations and the second of the "Replacing …" parts. In the [previous part](/blog/automations-sales/) we took lead sorting off the salesperson's plate. Now the deal is done, and the work with money begins. The article shows only the key pieces of code; the full code of the series, tests included, is in the [repository](https://github.com/balkhaev/balkhaev.com/tree/main/examples/automations).

## What exactly we are replacing

This is not accounting in the sense of taxes and reports. It's the routine around payments that in a small company usually falls on the accountant, the office manager or the salesperson themselves:

| A person used to | Now the system |
|---|---|
| issue an invoice and send it to the client | one command in the chat, the email goes out by itself |
| check the payment dashboard to see if the money arrived | a YooKassa notification plus an hourly reconciliation |
| grant access and send a "payment received" email | right after payment, at night and at weekends too |
| tell the team | "💰 Paid 15,000 ₽" in the chat |
| remember unpaid invoices and write to the client | reminders on days 3, 7 and 14 |
| figure out who needs a call | a chat message after the last reminder |

Refunds, disputes and anything else that needs a decision stay with a person. The system only reports them.

:::note
The example uses YooKassa, the most common payment provider in Russia. Outside Russia the same design works with Stripe: the differences are covered in the notes below.
:::

::news{topic="automation"}

## Why money needs a different approach

In the sales part we accepted a rare duplicate: if the CRM created a lead and the worker died, a second lead appears and a manager merges it. That won't do for money. Granting access twice is a loss, a "payment received" email without a payment is a scandal, and an unrecorded payment is a client who paid and got nothing.

So there are three rules here:

1. **The payment provider is the source of truth about a payment, not the notification.** A notification is only a reason to ask it.
2. **An order becomes paid in one place and with one conditional SQL statement.** However many times and from wherever the confirmation comes, the move from "pending" to "paid" happens once.
3. **Every external action is a separate job with a key.** Grant access, email the client, tell the team. If one fails, the others are not repeated.

## How it works

```mermaid
flowchart TD
  invoice(["/invoice in chat"])
  order["Order (pending)<br/>email with link /pay/&lt;id&gt;"]
  pay["<b>GET /pay/&lt;id&gt;</b><br/>live YooKassa payment? redirect to it<br/>none or canceled? create one (Idempotence-Key)"]
  client["Client pays in YooKassa"]
  notify[YooKassa notification]
  hourly[Hourly reconciliation]
  back[Client back on /pay]
  check["<b>payment.check</b><br/>GET /payments/&lt;id&gt;"]
  mark["<b>markPaid</b><br/>update … where status = 'pending'"]
  fulfill[order.fulfill]
  mail[Access email]
  chat["“💰” in chat"]
  invoice --> order
  order -- client clicks the link --> pay
  pay --> client
  client --> notify
  client --> back
  notify --> check
  hourly --> check
  back --> check
  check --> mark
  mark -- first time only --> fulfill
  fulfill --> mail
  fulfill --> chat
```

## Step 1. The tables

```sql
-- migrations/004_orders.sql
create table orders (
  id text primary key,
  email text not null,
  description text not null,
  amount integer not null check (amount > 0), -- in kopecks: no floats for money
  status text not null default 'pending'
    check (status in ('pending', 'paid')),
  payment_id text,
  paid_payment_id text,
  created_by text,
  reminders int not null default 0,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index orders_pending on orders (created_at) where status = 'pending';

create table accesses (
  order_id text primary key references orders (id),
  token text not null unique,
  created_at timestamptz not null default now()
);
```

The amount is stored in kopecks as an integer. Money is never stored as a float: in JavaScript `0.1 + 0.2` is `0.30000000000000004`, and sooner or later such an error shows up in a reconciliation.

`payment_id` is the current YooKassa payment the client can pay. `paid_payment_id` is the payment that actually paid the order. They differ when the client opened the link, didn't pay, came back a week later from a reminder and got a new payment.

Access lives in its own table with the order as the primary key: the database simply won't let a second access for the same order exist.

## Step 2. YooKassa

Register a shop with [YooKassa](https://yookassa.ru) and take the `shopId` and secret key from its settings. There is a test shop with test cards: start with it.

The YooKassa client is two functions. `getPayment(id)` calls `GET /payments/<id>` and returns the payment, or `undefined` if there is none. `createPayment` creates a payment that redirects to the payment page and carries the order id in `metadata`:

```ts
const response = await fetch(`${config.yookassaApi}/payments`, {
  method: "POST",
  headers: {
    authorization: auth, // Basic shopId:secretKey
    "content-type": "application/json",
    "idempotence-key": params.idempotenceKey,
  },
  body: JSON.stringify({
    amount: { value: rubles(params.amount), currency: "RUB" }, // "15000.00"
    capture: true,
    confirmation: { type: "redirect", return_url: params.returnUrl },
    metadata: { order_id: params.orderId },
  }),
});
```

Two important things.

**Idempotence-Key.** YooKassa requires this header on every request that creates something. If a request with the same key arrives again, it doesn't create a second payment but returns the first one. That's exactly what retries need: the network drops after YooKassa created the payment, we repeat the request with the same key and get the same payment.

**A 404 is not an error.** If there is no payment with that id, `getPayment` returns `undefined`. Below you'll see why: it lets us calmly discard forged notifications.

:::note
If the shop sends fiscal receipts through YooKassa, the payment creation request gets a `receipt` object with the client's email and the receipt items. The fields and VAT codes depend on your tax regime: take them from the YooKassa documentation and check them in the test shop.
:::

## Step 3. Orders and a link that never expires

The `orders.ts` module handles an order's life. `parseInvoice` parses the `/invoice email amount description` command and converts the amount to kopecks. `createOrder` inserts the order with `on conflict (id) do nothing` and enqueues sending the invoice. `payRedirect(id)` serves the link from the email: if the order is paid, it leads to the thank-you page; if the order has a live payment, to that payment; if the payment went through but the notification hasn't arrived yet, it records the payment; otherwise it creates a new payment with the key `<order>:<previous payment id or first>`. And `markPaid` records a payment, after checking its amount against the order's:

```ts
// markPaid: the only place where an order becomes paid
const [won] = await sql`
  update orders set status = 'paid', paid_at = now(), paid_payment_id = ${payment.id}
  where id = ${orderId} and status = 'pending'
  returning id
`;
if (won) {
  await enqueue({ kind: "order.fulfill", payload: { id: orderId }, key: `order.fulfill:${orderId}` });
} else if (order.paid_payment_id !== payment.id) {
  await alert(`Order ${orderId} paid twice: ${order.paid_payment_id} and ${payment.id}`);
}
```

Three ideas here.

**The link in the email points to us, not to YooKassa.** A direct payment link pasted into an email may stop working after a few days, since unpaid payments get canceled. Our `/pay/<id>` link finds a live payment or creates a new one on every click. So a reminder two weeks later works just like the first email.

**The new payment's key depends on the previous one.** `<order>:first` for the first, `<order>:<canceled id>` for the next. If the client clicks the link twice in a row, both requests compute the same key and YooKassa returns the same payment. After a cancellation the key differs, and a new payment is created.

**`markPaid` is the only place where an order becomes paid.** First it checks that the payment amount matches the order. Then `update ... where status = 'pending' returning id`: Postgres guarantees only the first statement gets the row back. That one schedules the fulfilment. Every later confirmation of the same payment does nothing. And if an order is paid by two different payments (the client opened two tabs and paid in both), the system doesn't refund on its own but posts to the alert chat: a refund is a person's decision.

The link is served by a new `GET /pay/:id` route that answers with a 303 redirect to wherever `payRedirect` points. If YooKassa is unavailable, the client sees "try again in a minute", and the order stays in the database. Nothing is lost.

## Step 4. Notifications without a signature

In the core part we promised to come back to payment providers that don't sign their notifications. YooKassa is one: its notifications carry no HMAC. You could check sender IP addresses against the list in the documentation, but there is a simpler and more reliable way: **don't trust the notification at all**. We take only the payment id from it and ask YooKassa what is really going on with that payment.

```ts
// src/sources.ts: YooKassa notifications aren't signed,
// so we take only the payment id from them
yookassa: {
  verify: () => true,
  dedupKey: (body) => {
    const note = JSON.parse(body);
    return `${note.event}:${note.object.id}`;
  },
  route: (body) => [
    { kind: "payment.check", payload: { paymentId: JSON.parse(body).object.id } },
  ],
},
```

A forged "payment pay-123 succeeded" notification leads to a request to YooKassa, which answers 404 or with the honest status. An attacker can't forge YooKassa's answer: we make that request over HTTPS with our own key.

In the YooKassa dashboard, under HTTP notifications, set the address `https://auto.example.com/hooks/yookassa` and the events `payment.succeeded` and `payment.canceled`.

:::note
Stripe and many other providers sign their webhooks: there you verify the signature as in the core part instead. Even with a signature it pays to re-check important events with an API request: that way you survive both a lost and a late notification. With Stripe the "link that never expires" is a Checkout Session created on each click of `/pay/<id>`, and its idempotency key works the same way.
:::

## Step 5. Email

Emails to clients need a transactional email service. Sending mail from your own server is a bad idea: it will almost certainly land in spam. The example uses [Resend](https://resend.com), but any service with an HTTP API works: Postmark, Amazon SES and others. Only one function changes: `sendEmail(to, subject, text)` makes a POST to `/emails` with the key in the `authorization` header and the sender address from the settings.

Verify the sender domain in the service (SPF and DKIM records in DNS), or your emails will go to spam.

## Step 6. The handlers

All the payment logic lives in its own file, `billing.ts`, and the common handler list just plugs it in and passes messages starting with `/invoice` to `invoiceCommand`. The jobs are:

- `order.invoice` emails the client a `/pay/<id>` link;
- `payment.check` asks YooKassa about the payment and, if it `succeeded`, calls `markPaid` for the order from `metadata`;
- `order.fulfill` grants access and enqueues two jobs: the client email and "💰" in the chat;
- `invoices.remind` picks unpaid orders that are 3, 7 or 14 days old every morning and enqueues `order.remind` with the key `order.remind:<order>:<number>`;
- `order.remind` checks the order is still unpaid, sends the email, and after the last reminder posts "📞 Time to call" in the chat;
- `payments.reconcile` enqueues `payment.check` for unpaid orders from the last 30 days every hour.

Granting access in full:

```ts
// Paid: grant access once, then tell the client and the team
"order.fulfill": async ({ id }) => {
  await sql`
    insert into accesses (order_id, token) values (${id}, ${crypto.randomUUID()})
    on conflict (order_id) do nothing
  `;
  await enqueue({ kind: "order.access_email", payload: { id }, key: `order.access_email:${id}` });
  await enqueue({ kind: "order.paid_notice", payload: { id }, key: `order.paid_notice:${id}` });
},
```

Things to note:

- **Only the managers' chat issues invoices.** The bot silently ignores the command from any other chat. Whoever is in that chat can issue invoices, so keep an eye on the group's members.
- **The order id comes from the message id.** If the `telegram.message` job fails after creating the order and runs again, no second order appears.
- **`order.fulfill` only grants access and schedules two jobs.** The client email and the chat message run separately. If the email service is down, the email keeps retrying while the chat message has already gone out, and nobody grants access twice.
- **Reminders never need cancelling.** Each one checks the order status when it is sent, and the morning job only picks unpaid orders. The client paid, and the chain stopped by itself.
- **A reminder's key contains its number.** If the morning job runs twice in a day, no second email goes out.

## Step 7. Reconciliation and the schedule

A notification may not arrive: YooKassa sent it while we were deploying, or it got lost on the way. YooKassa retries notifications, but relying on that alone won't do. Every hour `payments.reconcile` goes through unpaid orders from the last 30 days that have a payment and checks each one through the same `payment.check`. In the worst case the client gets access an hour later, not never.

Add two jobs to the schedule from the core part:

```ts
export const schedules: Schedule[] = [
  { kind: "heartbeat", everyMinutes: 60 },
  { kind: "invoices.remind", dailyAt: "10:00" },
  { kind: "payments.reconcile", everyMinutes: 60 },
];
```

## Step 8. Tests

Tests matter most for payments. We check that confirming one payment many times grants access once, that a double payment raises an alert, that a payment with the wrong amount doesn't count, that the link reuses a live payment, and that reminders follow the schedule and stop after payment.

The external API stubs moved into a shared `test/stubs.ts`: the YooKassa stub, like the real thing, remembers payments by Idempotence-Key. The tests call the handlers directly: three `payment.check` calls for one payment produce one `order.fulfill` job, two different payments for one order raise an alert, and for reminders the test "ages" the order by changing `created_at`.

In CI add the stub addresses to the `Tests` step: `YOOKASSA_API: http://localhost:3996/v3`, `EMAIL_API: http://localhost:3995` and test values for the other new variables.

## Step 9. Launch

1. Append to `.env` on the server:

```bash
YOOKASSA_SHOP_ID=123456
YOOKASSA_SECRET_KEY=test_...   # the test shop's key first
PUBLIC_URL=https://auto.example.com
ACCESS_URL=https://example.com/access/
EMAIL_API_KEY=re_...
EMAIL_FROM=Studio <hello@example.com>
```

2. Push the code: the `004_orders.sql` migration runs during the deploy.
3. Set the notification address `https://auto.example.com/hooks/yookassa` in YooKassa.
4. Invoice yourself for 1 ruble, pay with a test card and check that the access email and the chat message arrived.
5. Switch the keys to the live shop.

## Checking it

A run over HTTP with YooKassa, email and Telegram stubbed:

| What we did | What happened |
|---|---|
| `/invoice anna@example.com 15000 Studio landing page` in the managers' chat | order created, "Invoice for 15,000 ₽ sent" in the chat, an email with the link to the client |
| Opened `/pay/<id>` | a YooKassa payment for "15000.00" created, redirect to the payment page |
| Opened the link again | redirect to the same payment, no new one created |
| Opened `/pay/nope` | 404 |
| A `payment.succeeded` notification arrived, then its redelivery | the first processed, the second dropped as a duplicate |
| A forged notification for payment `forged` | YooKassa answered 404, the order untouched |
| After payment | order `paid`, one access email, one "💰 Paid 15,000 ₽" in the chat |
| Opened the link after payment | redirect to the "Thank you" page |
| Tests: three confirmations of one payment | access granted once |
| Tests: an order paid by two payments | a "paid twice, refund one" alert |
| Tests: a 1 ruble payment instead of 15,000 | the order stays unpaid, an alert |
| Tests: days 1, 3, 3, 8, payment, day 15 | reminders on days 3 and 8, none after payment |

## What we have

- An invoice takes one command, and the client gets the email within seconds.
- The pay link always works, even from a reminder two weeks later.
- A payment counts exactly once, however many confirmations arrive, and only with the right amount.
- A notification can't fake a payment: we check each one with YooKassa.
- A lost notification is picked up by the hourly reconciliation.
- Clients who owe get reminders, and when it's time to call, the chat hears about it.

Next is ["Replacing support"](/blog/automations-support/): we sort incoming emails and messages, draft answers to common questions from a knowledge base and leave the last word to a person.
