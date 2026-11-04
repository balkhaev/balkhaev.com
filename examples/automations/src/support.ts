// src/support.ts
import { config } from "./config";
import { sql } from "./db";
import { sendEmail } from "./email";
import { money } from "./orders";
import { enqueue, type Job } from "./queue";
import { html, tg } from "./telegram";
import { type Triage, triage } from "./triage";

type Handler = (payload: any, job: Job) => Promise<void>;

export interface Ticket {
  id: string;
  channel: "telegram" | "email";
  customer: string;
  name: string;
  subject: string;
  message: string;
  status: "new" | "answered" | "closed";
  triage: Triage | null;
  answer: string | null;
  agent: string | null;
  telegram_message_id: number | null;
  created_at: Date;
}

const HOUR = 60 * 60 * 1000;

export async function getTicket(id: string | number): Promise<Ticket> {
  const [ticket] = await sql`select * from tickets where id = ${id}`;
  if (!ticket) {
    throw new Error(`ticket ${id} not found`);
  }
  return ticket;
}

/** Saves an incoming message and plans the card, the triage and a reminder. */
export async function createTicket(input: {
  sourceId: string;
  channel: Ticket["channel"];
  customer: string;
  name: string;
  subject: string;
  message: string;
}) {
  await sql`
    insert into tickets (source_id, channel, customer, name, subject, message)
    values (${input.sourceId}, ${input.channel}, ${input.customer}, ${input.name},
            ${input.subject.slice(0, 300)}, ${input.message.slice(0, 20_000)})
    on conflict (source_id) do nothing
  `;
  const [{ id }] = await sql`select id from tickets where source_id = ${input.sourceId}`;
  await enqueue({ kind: "support.notify", payload: { id }, key: `support.notify:${id}` });
  await enqueue({ kind: "support.triage", payload: { id }, key: `support.triage:${id}` });
  await enqueue({
    kind: "support.remind",
    payload: { id },
    key: `support.remind:${id}`,
    runAt: new Date(Date.now() + HOUR),
  });
}

const CATEGORY = {
  question: "❓ Question",
  billing: "💳 Billing",
  bug: "🐞 Bug",
  refund: "↩️ Refund",
  complaint: "😠 Complaint",
  other: "📨 Other",
};

/** The card agents see in the support chat, rebuilt from the ticket on every change. */
export function renderCard(ticket: Ticket) {
  const t = ticket.triage;
  const from = ticket.channel === "email" ? "✉️" : "💬";
  const title = t ? `${t.urgent ? "🔴 " : ""}${CATEGORY[t.category]}` : "🆕 New ticket";
  const lines = [
    `<b>${title}</b> · #${ticket.id}`,
    `${from} ${html(ticket.name)} · ${html(ticket.customer)}`,
  ];
  if (ticket.subject) {
    lines.push(`<b>${html(ticket.subject)}</b>`);
  }
  lines.push(`<blockquote>${html(ticket.message.slice(0, 1500))}</blockquote>`);
  if (!t) {
    lines.push("<i>Reading…</i>");
  } else {
    lines.push(`<b>Summary:</b> ${html(t.summary)}`);
    if (t.needs_human) {
      lines.push(`⚠️ <b>Needs a person:</b> ${html(t.reason)}`);
    }
    if (t.draft && ticket.status === "new") {
      lines.push("", "<b>Draft:</b>", `<blockquote>${html(t.draft.slice(0, 1500))}</blockquote>`);
    }
  }
  if (ticket.status === "new") {
    lines.push("", "<i>Reply to this message to send your own answer.</i>");
  }
  if (ticket.status === "answered") {
    lines.push("", `✅ Answered by ${html(ticket.agent ?? "")}:`);
    lines.push(`<blockquote>${html((ticket.answer ?? "").slice(0, 1500))}</blockquote>`);
  }
  if (ticket.status === "closed") {
    lines.push("", `🙈 Closed without an answer by ${html(ticket.agent ?? "")}`);
  }
  return lines.join("\n");
}

export function keyboard(ticket: Ticket) {
  if (ticket.status !== "new") {
    return { inline_keyboard: [] };
  }
  const row = [{ text: "🙈 Close", callback_data: `close:${ticket.id}` }];
  if (ticket.triage?.draft) {
    row.unshift({ text: "✅ Send draft", callback_data: `send:${ticket.id}` });
  }
  return { inline_keyboard: [row] };
}

export async function updateCard(id: string | number) {
  const ticket = await getTicket(id);
  if (!ticket.telegram_message_id) {
    return;
  }
  try {
    await tg("editMessageText", {
      chat_id: config.supportChatId,
      message_id: ticket.telegram_message_id,
      text: renderCard(ticket),
      parse_mode: "HTML",
      reply_markup: keyboard(ticket),
    });
  } catch (error) {
    if (!String(error).includes("message is not modified")) {
      throw error;
    }
  }
}

/**
 * The only place a ticket gets an answer. "where status = 'new'" means that
 * two agents pressing at once, or a button press plus a reply, send one answer.
 */
export async function answer(id: string | number, text: string, agent: string, draftUsed: boolean) {
  const [won] = await sql`
    update tickets
    set status = 'answered', answer = ${text}, agent = ${agent},
        draft_used = ${draftUsed}, answered_at = now()
    where id = ${id} and status = 'new'
    returning id
  `;
  if (won) {
    await enqueue({ kind: "support.send", payload: { id }, key: `support.send:${id}` });
  }
  await updateCard(id);
  return Boolean(won);
}

/** What we know about the client: their orders from the payments part. */
async function clientContext(ticket: Ticket) {
  if (ticket.channel !== "email") {
    return "No data: the client wrote in Telegram.";
  }
  const orders = await sql`
    select description, amount, status, created_at, paid_at from orders
    where email = ${ticket.customer} order by created_at desc limit 10
  `;
  if (orders.length === 0) {
    return "No orders with this email.";
  }
  return orders
    .map(
      (o: any) =>
        `- ${o.description}: ${money(o.amount)}, ${o.status}, invoiced ${o.created_at.toISOString().slice(0, 10)}` +
        (o.paid_at ? `, paid ${o.paid_at.toISOString().slice(0, 10)}` : "")
    )
    .join("\n");
}

/** The client's previous tickets and our answers, so the model sees the thread. */
async function history(ticket: Ticket) {
  const earlier = await sql`
    select message, answer from tickets
    where customer = ${ticket.customer} and id < ${ticket.id}
    order by id desc limit 3
  `;
  if (earlier.length === 0) {
    return "No earlier tickets.";
  }
  return earlier
    .reverse()
    .map((t: any) => `Client: ${t.message.slice(0, 1000)}\nUs: ${t.answer ?? "(no answer)"}`)
    .join("\n\n");
}

/** Messages to the bot: a client writing in private, or an agent replying to a card. */
export async function supportMessage(message: any) {
  if (message.chat.type === "private") {
    if (message.text.startsWith("/")) {
      return; // /start and other commands are not tickets
    }
    const name = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");
    await createTicket({
      sourceId: `tg:${message.chat.id}:${message.message_id}`,
      channel: "telegram",
      customer: String(message.chat.id),
      name: message.from.username ? `${name} (@${message.from.username})` : name,
      subject: "",
      message: message.text,
    });
    return;
  }
  const cardId = message.reply_to_message?.message_id;
  if (String(message.chat.id) !== String(config.supportChatId) || !cardId) {
    return;
  }
  const [ticket] = await sql`
    select id from tickets where telegram_message_id = ${cardId}
  `;
  if (ticket) {
    const agent = message.from.username ? `@${message.from.username}` : message.from.first_name;
    await answer(ticket.id, message.text, agent, false);
  }
}

export const supportHandlers: Record<string, Handler> = {
  "email.incoming": async (email) => {
    await createTicket({
      sourceId: email.MessageID,
      channel: "email",
      customer: email.From,
      name: email.FromName ?? "",
      subject: email.Subject ?? "",
      // The new text without the quoted thread below it, when the service can tell
      message: email.StrippedTextReply || email.TextBody || "",
    });
  },

  "support.notify": async ({ id }) => {
    const ticket = await getTicket(id);
    if (ticket.telegram_message_id) {
      return;
    }
    const card = await tg("sendMessage", {
      chat_id: config.supportChatId,
      text: renderCard(ticket),
      parse_mode: "HTML",
      reply_markup: keyboard(ticket),
    });
    await sql`update tickets set telegram_message_id = ${card.message_id} where id = ${id}`;
  },

  "support.triage": async ({ id }) => {
    const ticket = await getTicket(id);
    if (!ticket.triage) {
      const result = await triage({
        subject: ticket.subject,
        message: ticket.message,
        history: await history(ticket),
        client: await clientContext(ticket),
      });
      await sql`update tickets set triage = ${result} where id = ${id}`;
    }
    await updateCard(id);
  },

  // The answer goes to the client the way they wrote to us
  "support.send": async ({ id }) => {
    const ticket = await getTicket(id);
    if (ticket.channel === "telegram") {
      await tg("sendMessage", { chat_id: ticket.customer, text: ticket.answer!.slice(0, 4096) });
    } else {
      const subject = ticket.subject.startsWith("Re:") ? ticket.subject : `Re: ${ticket.subject}`;
      await sendEmail(ticket.customer, subject, ticket.answer!);
    }
  },

  "support.remind": async ({ id }) => {
    const ticket = await getTicket(id);
    if (ticket.status !== "new") {
      return;
    }
    await tg("sendMessage", {
      chat_id: config.supportChatId,
      text: `⏰ Ticket #${ticket.id} from ${ticket.name || ticket.customer} has waited an hour`,
      reply_parameters: ticket.telegram_message_id
        ? { message_id: ticket.telegram_message_id }
        : undefined,
    });
  },
};

/** Buttons under a ticket card. */
export async function supportCallback(query: any) {
  const [action, id] = String(query.data).split(":");
  const agent = query.from.username ? `@${query.from.username}` : query.from.first_name;
  let done = false;
  if (action === "send") {
    const ticket = await getTicket(id);
    done = Boolean(ticket.triage?.draft) && (await answer(id, ticket.triage!.draft, agent, true));
  } else {
    const [won] = await sql`
      update tickets set status = 'closed', agent = ${agent}
      where id = ${id} and status = 'new'
      returning id
    `;
    done = Boolean(won);
    await updateCard(id);
  }
  return done;
}
