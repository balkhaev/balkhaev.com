// src/pay.ts
import { payRedirect } from "./orders";

/** GET /pay/:id, the link from invoices and reminders. */
export async function pay(req: Request & { params: { id: string } }) {
  try {
    const url = await payRedirect(req.params.id);
    if (!url) {
      return new Response("Invoice not found", { status: 404 });
    }
    return Response.redirect(url, 303);
  } catch (error) {
    // YooKassa is down or slow: ask the client to retry, the order is safe
    console.error("pay link failed", error);
    return new Response("Payment is temporarily unavailable, please try again in a minute", {
      status: 503,
    });
  }
}
