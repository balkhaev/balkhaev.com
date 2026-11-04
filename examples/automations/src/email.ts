// src/email.ts
import { config } from "./config";
import { check } from "./errors";

export async function sendEmail(to: string, subject: string, text: string) {
  const response = await fetch(`${config.emailApi}/emails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.emailApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: config.emailFrom, to, subject, text }),
    signal: AbortSignal.timeout(15_000),
  });
  await check(response, "email");
}
