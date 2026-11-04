// src/telegram.ts
import { config } from "./config";
import { check } from "./errors";

/** Calls a Bot API method and returns its `result`. */
export async function tg(method: string, params: Record<string, unknown>) {
  const response = await fetch(
    `${config.telegramApi}/bot${config.telegramToken}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10_000),
    }
  );
  await check(response, `telegram ${method}`);
  const data = await response.json();
  return data.result;
}

export function sendMessage(chatId: number | string, text: string) {
  return tg("sendMessage", { chat_id: chatId, text });
}

/** Message to the team's alert chat. Never throws: an alert must not break the caller. */
export async function alert(text: string) {
  try {
    await sendMessage(config.alertChatId, text);
  } catch (error) {
    console.error("alert failed", error, text);
  }
}

/** Escapes text for parse_mode HTML. */
export function html(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
