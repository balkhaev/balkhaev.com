// test/stubs.ts: fake Telegram, YooKassa, email and Claude APIs for tests.
// Ports match TELEGRAM_API, YOOKASSA_API, EMAIL_API and ANTHROPIC_BASE_URL in the test environment.
export const calls: { api: string; method: string; body: any; headers: Headers }[] = [];
export const payments = new Map<string, any>();

function record(api: string) {
  return async (req: Request) => {
    const url = new URL(req.url);
    const body = req.method === "GET" ? null : await req.json();
    calls.push({ api, method: url.pathname.split("/").pop()!, body, headers: req.headers });
    return { url, body };
  };
}

const telegram = record("telegram");
Bun.serve({
  port: 3999,
  async fetch(req) {
    await telegram(req);
    return Response.json({ ok: true, result: { message_id: 777 } });
  },
});

// Remembers payments by Idempotence-Key, like YooKassa does
const byKey = new Map<string, any>();
const yookassa = record("yookassa");
Bun.serve({
  port: 3996,
  async fetch(req) {
    const { url, body } = await yookassa(req);
    if (req.method === "POST") {
      const key = req.headers.get("idempotence-key")!;
      if (!byKey.has(key)) {
        const id = `pay-${byKey.size + 1}`;
        const payment = {
          id,
          status: "pending",
          amount: body.amount,
          metadata: body.metadata,
          confirmation: { confirmation_url: `https://yoomoney.example/pay/${id}` },
        };
        byKey.set(key, payment);
        payments.set(id, payment);
      }
      return Response.json(byKey.get(key));
    }
    const payment = payments.get(url.pathname.split("/").pop()!);
    return payment ? Response.json(payment) : new Response("not found", { status: 404 });
  },
});

const email = record("email");
Bun.serve({
  port: 3995,
  async fetch(req) {
    await email(req);
    return Response.json({ id: "email-1" });
  },
});

// Answers every Messages API request with `claude.answer` as the JSON text,
// or with an error when `claude.status` is set
export const claude = { answer: {} as Record<string, unknown>, status: 200 };
const anthropic = record("claude");
Bun.serve({
  port: 3997,
  async fetch(req) {
    await anthropic(req);
    if (claude.status !== 200) {
      return Response.json({ type: "error", error: { type: "invalid_request_error", message: "test" } }, { status: claude.status });
    }
    return Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(claude.answer) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 100 },
    });
  },
});

export function reset() {
  calls.length = 0;
  claude.status = 200;
  payments.clear();
  byKey.clear();
}
