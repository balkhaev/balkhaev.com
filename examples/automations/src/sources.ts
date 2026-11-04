// src/sources.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import type { NewJob } from "./queue";

export interface Source {
  /** Checks that the request really comes from this source. */
  verify(headers: Headers, body: string): boolean;
  /** Event id from the sender: the same event delivered twice gets the same key. */
  dedupKey(body: string): string | undefined;
  /** Which jobs the event produces. */
  route(body: string): NewJob[];
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Header `x-signature: sha256=<hex HMAC of the body>`, as GitHub and many others do it. */
export function hmacValid(secret: string, body: string, header: string | null) {
  if (!header) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return safeEqual(expected, header);
}

export const sources: Record<string, Source> = {
  // Our website's backend signs every request with a shared secret
  site: {
    verify: (headers, body) =>
      hmacValid(config.siteSecret, body, headers.get("x-signature")),
    dedupKey: (body) => JSON.parse(body).id,
    route: (body) => [{ kind: "site.form", payload: JSON.parse(body) }],
  },

  // YooKassa notifications carry no signature. We take only the payment id from
  // them and ask the API for the payment itself, so a forged one changes nothing.
  yookassa: {
    verify: () => true,
    dedupKey: (body) => {
      const note = JSON.parse(body);
      return `${note.event}:${note.object.id}`;
    },
    route: (body) => {
      const note = JSON.parse(body);
      if (typeof note.object?.id !== "string") {
        return [];
      }
      return [{ kind: "payment.check", payload: { paymentId: note.object.id } }];
    },
  },

  // Inbound email from Postmark. The webhook URL carries a login and password,
  // https://postmark:<secret>@auto.example.com/hooks/email, which arrive as Basic auth
  email: {
    verify: (headers) =>
      safeEqual(
        headers.get("authorization") ?? "",
        `Basic ${btoa(`postmark:${config.emailInboundSecret}`)}`
      ),
    dedupKey: (body) => JSON.parse(body).MessageID,
    route: (body) => {
      const { MessageID, From, FromName, Subject, TextBody, StrippedTextReply } = JSON.parse(body);
      // Only what we need: attachments would bloat the job's payload
      const payload = { MessageID, From, FromName, Subject, TextBody, StrippedTextReply };
      return [{ kind: "email.incoming", payload }];
    },
  },

  // Telegram sends the secret_token from setWebhook in this header
  telegram: {
    verify: (headers) =>
      safeEqual(
        headers.get("x-telegram-bot-api-secret-token") ?? "",
        config.telegramSecret
      ),
    dedupKey: (body) => String(JSON.parse(body).update_id),
    route: (body) => {
      const update = JSON.parse(body);
      // A press on an inline button under a lead card
      if (update.callback_query) {
        return [{ kind: "telegram.callback", payload: update.callback_query }];
      }
      if (!update.message?.text) {
        return [];
      }
      return [{ kind: "telegram.message", payload: update.message }];
    },
  },
};
