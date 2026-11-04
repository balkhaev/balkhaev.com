// src/handlers.ts
import { evaluate, runChecks } from "./alerts";
import { billingHandlers, invoiceCommand } from "./billing";
import { config } from "./config";
import { createCrmLead } from "./crm";
import { check } from "./errors";
import { sql } from "./db";
import { sendDigest } from "./digest";
import { getLead, keyboard, renderCard, updateCard } from "./leads";
import { qualify } from "./qualify";
import { enqueue, type Job } from "./queue";
import { supportCallback, supportHandlers, supportMessage } from "./support";
import { alert, sendMessage, tg } from "./telegram";

type Handler = (payload: any, job: Job) => Promise<void>;

const MINUTE = 60_000;

export const handlers: Record<string, Handler> = {
  // A form came in: save the lead and plan everything that follows
  "site.form": async (form) => {
    await sql`
      insert into leads (id, name, contact, message)
      values (${form.id}, ${form.name}, ${form.contact}, ${form.message})
      on conflict (id) do nothing
    `;
    const id = form.id;
    // Keys make every step happen once, even if this handler runs twice
    await enqueue({ kind: "lead.notify", payload: { id }, key: `lead.notify:${id}` });
    await enqueue({ kind: "lead.qualify", payload: { id }, key: `lead.qualify:${id}` });
    // CRM a bit later, so the qualification usually makes it into the comment
    await enqueue({
      kind: "lead.crm",
      payload: { id },
      key: `lead.crm:${id}`,
      runAt: new Date(Date.now() + 2 * MINUTE),
    });
    await enqueue({
      kind: "lead.remind",
      payload: { id, step: 1 },
      key: `lead.remind:${id}:1`,
      runAt: new Date(Date.now() + 15 * MINUTE),
    });
  },

  // First the card, right away, without waiting for the model
  "lead.notify": async ({ id }) => {
    const lead = await getLead(id);
    if (lead.telegram_message_id) {
      return; // already sent on an earlier attempt
    }
    const message = await tg("sendMessage", {
      chat_id: config.leadsChatId,
      text: renderCard(lead),
      parse_mode: "HTML",
      reply_markup: keyboard(lead),
    });
    await sql`update leads set telegram_message_id = ${message.message_id} where id = ${id}`;
  },

  // Then the model reads the lead, and the card gets the summary
  "lead.qualify": async ({ id }) => {
    const lead = await getLead(id);
    if (!lead.qualification) {
      const qualification = await qualify(lead);
      await sql`update leads set qualification = ${qualification} where id = ${id}`;
    }
    await updateCard(id);
  },

  "lead.crm": async ({ id }) => {
    const lead = await getLead(id);
    if (!config.crmWebhookUrl || lead.crm_id) {
      return;
    }
    if (lead.status === "spam" || lead.qualification?.spam) {
      return;
    }
    const crmId = await createCrmLead(lead);
    await sql`update leads set crm_id = ${crmId} where id = ${id}`;
  },

  // Nobody took the lead: remind the managers, then tell the head of sales
  "lead.remind": async ({ id, step }) => {
    const lead = await getLead(id);
    if (lead.status !== "new" || lead.qualification?.spam) {
      return;
    }
    if (step === 1) {
      await tg("sendMessage", {
        chat_id: config.leadsChatId,
        text: `⏰ Nobody has taken the lead from ${lead.name} for 15 minutes`,
        reply_parameters: lead.telegram_message_id
          ? { message_id: lead.telegram_message_id }
          : undefined,
      });
      await enqueue({
        kind: "lead.remind",
        payload: { id, step: 2 },
        key: `lead.remind:${id}:2`,
        runAt: new Date(Date.now() + 15 * MINUTE),
      });
    } else {
      await alert(`Lead from ${lead.name} (${lead.contact}) has waited 30 minutes`);
    }
  },

  // A button under a lead card or a ticket card
  "telegram.callback": async (query) => {
    const [action, id] = String(query.data).split(":");
    let won: boolean;
    if (action === "send" || action === "close") {
      won = await supportCallback(query);
    } else {
      const who = query.from.username ? `@${query.from.username}` : query.from.first_name;
      const status = action === "take" ? "taken" : "spam";
      // "where status = 'new'": if two managers press at once, only one wins
      const rows = await sql`
        update leads set status = ${status}, manager = ${who}, taken_at = now()
        where id = ${id} and status = 'new'
        returning id
      `;
      won = rows.length > 0;
      await updateCard(id);
    }
    try {
      await tg("answerCallbackQuery", {
        callback_query_id: query.id,
        text: won ? "Done" : "Someone was faster",
      });
    } catch {
      // the button spinner times out on its own; not worth a retry
    }
  },

  "telegram.message": async (message) => {
    if (message.text === "/ping") {
      await sendMessage(message.chat.id, "pong");
    }
    if (message.text.startsWith("/invoice")) {
      await invoiceCommand(message);
    }
    await supportMessage(message);
  },

  // Every 5 minutes through the whole chain: schedule, queue, worker.
  // If the pings stop, Healthchecks raises the alarm from outside.
  heartbeat: async () => {
    if (config.heartbeatUrl) {
      const response = await fetch(config.heartbeatUrl, { signal: AbortSignal.timeout(10_000) });
      await check(response, "heartbeat");
    }
  },

  // Every morning: yesterday in numbers, with the model's commentary
  "digest.daily": () => sendDigest(),

  // Every 15 minutes: is anything unusually quiet or stuck
  "alerts.check": async () => {
    await evaluate(await runChecks());
  },

  ...billingHandlers,
  ...supportHandlers,
};
