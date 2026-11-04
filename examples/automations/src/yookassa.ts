// src/yookassa.ts
import { config } from "./config";
import { check } from "./errors";

export interface Payment {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  amount: { value: string; currency: string };
  confirmation?: { confirmation_url?: string };
  metadata?: { order_id?: string };
}

const auth = `Basic ${btoa(`${config.yookassaShopId}:${config.yookassaSecretKey}`)}`;

/** Kopecks to the "15000.00" string the API expects. */
export const rubles = (kopecks: number) => (kopecks / 100).toFixed(2);

/** The payment as YooKassa sees it, or undefined if there is no such payment. */
export async function getPayment(id: string): Promise<Payment | undefined> {
  const response = await fetch(`${config.yookassaApi}/payments/${encodeURIComponent(id)}`, {
    headers: { authorization: auth },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) {
    return undefined;
  }
  await check(response, "yookassa get payment");
  return response.json();
}

/**
 * Creates a payment. The Idempotence-Key makes a repeated request with the
 * same key return the same payment instead of creating a second one.
 */
export async function createPayment(params: {
  idempotenceKey: string;
  orderId: string;
  amount: number;
  description: string;
  returnUrl: string;
}): Promise<Payment> {
  const response = await fetch(`${config.yookassaApi}/payments`, {
    method: "POST",
    headers: {
      authorization: auth,
      "content-type": "application/json",
      "idempotence-key": params.idempotenceKey,
    },
    body: JSON.stringify({
      amount: { value: rubles(params.amount), currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: params.returnUrl },
      description: params.description.slice(0, 128),
      metadata: { order_id: params.orderId },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  await check(response, "yookassa create payment");
  return response.json();
}
