// src/crm.ts
import { config } from "./config";
import { check, PermanentError } from "./errors";
import type { Lead } from "./leads";

/** Creates a lead in Bitrix24 via an incoming webhook. Returns its id. */
export async function createCrmLead(lead: Lead): Promise<string> {
  const contactField = lead.contact.includes("@") ? "EMAIL" : "PHONE";
  const q = lead.qualification;
  const comments = [lead.message, q ? `\n${q.summary} (${q.temperature})` : ""].join("");

  const response = await fetch(`${config.crmWebhookUrl}crm.lead.add.json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fields: {
        TITLE: `Website lead: ${lead.name}`,
        NAME: lead.name,
        [contactField]: [{ VALUE: lead.contact, VALUE_TYPE: "WORK" }],
        COMMENTS: comments,
        SOURCE_ID: "WEB",
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  await check(response, "bitrix24 crm.lead.add");
  const data = await response.json();
  if (!data.result) {
    throw new PermanentError(`bitrix24: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return String(data.result);
}
