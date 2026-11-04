// src/leads.ts
import { config } from "./config";
import { sql } from "./db";
import type { Qualification } from "./qualify";
import { html, tg } from "./telegram";

export interface Lead {
  id: string;
  name: string;
  contact: string;
  message: string;
  status: "new" | "taken" | "spam";
  qualification: Qualification | null;
  manager: string | null;
  telegram_message_id: number | null;
  crm_id: string | null;
}

export async function getLead(id: string): Promise<Lead> {
  const [lead] = await sql`select * from leads where id = ${id}`;
  if (!lead) {
    throw new Error(`lead ${id} not found`);
  }
  return lead;
}

const HEAT = { hot: "🔥 Hot lead", warm: "🟡 Warm lead", cold: "🔵 Cold lead" };

/** The card managers see in Telegram, rebuilt from the lead on every change. */
export function renderCard(lead: Lead) {
  const q = lead.qualification;
  const title = q ? (q.spam ? "🗑 Looks like spam" : HEAT[q.temperature]) : "🆕 New lead";
  const lines = [
    `<b>${title}</b>`,
    `${html(lead.name)} · ${html(lead.contact)}`,
    "",
    `<blockquote>${html(lead.message.slice(0, 1000) || "(empty message)")}</blockquote>`,
  ];
  if (q) {
    lines.push(
      `<b>Summary:</b> ${html(q.summary)}`,
      `<b>Service:</b> ${html(q.service)}`,
      `<b>Budget:</b> ${html(q.budget)} · <b>Deadline:</b> ${html(q.deadline)}`
    );
  } else {
    lines.push("<i>Qualifying…</i>");
  }
  if (lead.status === "taken") {
    lines.push("", `✅ Taken by ${html(lead.manager ?? "")}`);
  }
  if (lead.status === "spam") {
    lines.push("", `🚫 Marked as spam by ${html(lead.manager ?? "")}`);
  }
  return lines.join("\n");
}

/** Buttons only while the lead is waiting for someone. */
export function keyboard(lead: Lead) {
  if (lead.status !== "new") {
    return { inline_keyboard: [] };
  }
  return {
    inline_keyboard: [
      [
        { text: "I'll take it", callback_data: `take:${lead.id}` },
        { text: "Spam", callback_data: `spam:${lead.id}` },
      ],
    ],
  };
}

/** Redraws the card after any change. Safe to call any number of times. */
export async function updateCard(id: string) {
  const lead = await getLead(id);
  if (!lead.telegram_message_id) {
    return; // the card isn't sent yet; it will be drawn fresh when it is
  }
  try {
    await tg("editMessageText", {
      chat_id: config.leadsChatId,
      message_id: lead.telegram_message_id,
      text: renderCard(lead),
      parse_mode: "HTML",
      reply_markup: keyboard(lead),
    });
  } catch (error) {
    // Telegram refuses an edit that changes nothing; that is fine
    if (!String(error).includes("message is not modified")) {
      throw error;
    }
  }
}
