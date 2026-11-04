---
title: "The interface: a web chat and a Slack bot"
description: We take the agent out of the terminal. Company SSO sign-in, a web chat with streaming and conversation history, and a Slack bot that knows who is writing and answers only in direct messages.
date: 2026-11-04
series: company-agent
part: 8
tags: [agents, oauth, slack, web]
---

:::tldr
The agent core moves into a module that knows nothing about the interface and reports progress through three callbacks. The web chat: SSO sign-in with authorization code and PKCE, the refresh token encrypted in the database, the answer streamed to the browser over SSE, and conversation history stored as is and append-only. The Slack bot: checks the signature of every request, links a Slack account to an SSO account only when the emails match, and answers only in direct messages, because the answer is built on the asker's permissions.
:::

In earlier parts the agent lived in a terminal and took the employee's token from an environment variable. Employees will not work like that. In this part we build two entry points: a web chat and a bot in the team chat. A thin layer, as promised in the [concept](/blog/agent-concept/), but with a few places where it is easy to get security wrong.

## What the interface needs

- **Know who is asking.** Sign-in through the company SSO, after which the agent works with that person's token, as in [part 6](/blog/agent-auth/).
- **Not lose access in the middle of the day.** An access token lives for an hour; an employee works for eight. You need a refresh token, and it must be stored carefully.
- **Show the answer as it is written.** An answer with three tool calls can take half a minute. A blank screen all that time looks like a hang.
- **Remember conversations.** Close the tab, open it tomorrow, carry on.
- **Ask for confirmation** of dangerous actions from [part 3](/blog/agent-loop/), now with a button instead of the terminal.

## The design

```mermaid
flowchart TD
  browser([Browser])
  sso[SSO]
  slack([Slack])
  web["<b>web.ts</b><br/>sign-in, sessions, /api/chat (SSE)<br/>slack.ts: /slack/events"]
  core["<b>agent-core.ts</b><br/>loop, cache, limits (parts 3–7)"]
  mcp["MCP: wiki, database"]
  store[("store.db<br/>accounts, conversations")]
  browser -- "/login, /callback" --> sso
  browser -- "cookie sid" --> web
  slack -- events --> web
  web -- replies --> slack
  web -- "ask(user, conversation, text, events)" --> core
  core --> mcp
  core --> store
```

## The core, separate from the interface

The loop from [part 7](/blog/agent-cost/) printed to the console and asked for confirmation through `readline`. Now it has two consumers, so everything about output goes into three callbacks:

```ts
// agent-core.ts
import Anthropic from "@anthropic-ai/sdk";
import { connectMcp } from "./mcp";
import { userToken } from "./oidc";
import { type Conversation, type User, saveConversation } from "./store";
import { DAILY_LIMIT_USD, record, spentToday, tally } from "./usage";

type Message = Anthropic.Beta.BetaMessageParam;

// Where the agent reports progress. The web chat and the bot implement it their own way
export type Events = {
  text: (delta: string) => void;
  tool: (name: string, input: unknown) => void;
  confirm: (name: string, input: unknown) => Promise<boolean>;
};
```

`createAgent(user, token)` assembles what `agent.ts` did in the previous part: it connects MCP servers with the employee's token, fixes the tool order, sets the cache markers and counts the money. The `turn(messages, events)` function is the loop from part 7, with `process.stdout.write` replaced by `events.text`, the tool-call printout by `events.tool`, and the terminal question by `await events.confirm(...)`. The new code around it:

```ts
export type Agent = Awaited<ReturnType<typeof createAgent>>;

// One agent per employee: MCP connections are too costly to open for every question
const agents = new Map<string, Promise<Agent>>();

export function agentFor(user: User, token: () => Promise<string>) {
  let agent = agents.get(user.login);
  if (!agent) {
    agent = createAgent(user, token);
    agent.catch(() => agents.delete(user.login));
    agents.set(user.login, agent);
  }
  return agent;
}

// The human-visible part of the history: questions and answer text, without service blocks
export function transcript(messages: Message[]) {
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const m of messages) {
    if (m.role === "system" || !m.content) continue;
    if (typeof m.content === "string") {
      out.push({ role: m.role, text: m.content });
      continue;
    }
    const text = m.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    if (text) out.push({ role: m.role, text });
  }
  return out;
}

const running = new Set<string>();

// A question in a conversation: one turn at a time; on failure the history rolls back to the start of the turn
export async function ask(user: User, conv: Conversation, text: string, events: Events) {
  if (running.has(conv.id)) return { usd: 0, note: "The agent is still answering the previous question." };
  running.add(conv.id);
  const before = conv.messages.length;
  try {
    const agent = await agentFor(user, userToken(user));
    conv.messages.push({ role: "user", content: text });
    const result = await agent.turn(conv.messages, events);
    saveConversation(conv);
    return result;
  } catch (err) {
    // An unfinished turn (say, a tool call without a result) would break the next request
    conv.messages.length = before;
    throw err;
  } finally {
    running.delete(conv.id);
  }
}
```

Three decisions here are worth explaining.

**An agent per employee, not per request.** Connecting to MCP servers costs several requests, and there is no reason to do it for every question. The token is passed as a function rather than a string: the access token refreshes every hour, and connections must pick up the fresh one.

**One turn at a time.** If an employee sends a second question while the agent is answering the first, both turns would append to the same history and it would get scrambled. A simple lock on the conversation id rules that out.

**Rollback on failure.** If something fails mid-turn, the history may be left with a tool call that has no result, and the next API request would return an error. So on failure we cut off everything this turn appended. This is not a history edit in the sense of [part 7](/blog/agent-cost/): only the tail is removed, and the beginning of the conversation does not change.

## Signing in through SSO

For a web application with a server, the standard way to sign in is the OAuth authorization code flow with PKCE:

1. The employee opens `/login`. The server generates a random `state` and `verifier`, remembers them and sends the browser to the provider's sign-in page, putting `state` and a hash of `verifier` into the URL.
2. The employee signs in the way they sign in to any company system: password, second factor. The provider sends the browser back to our `/callback` with a one-time code and the same `state`.
3. The server checks that `state` matches the one issued to this browser and exchanges the code for tokens, attaching the original `verifier`. The provider checks it against the hash from step one.

`state` protects against forged sign-ins: without it an attacker could slip an employee a link with the attacker's own code, and the employee would end up working in someone else's account. PKCE protects the code: even an intercepted code is useless without the `verifier`, which never left our server.

The teaching provider from part 6 has learned this. It gains registered clients, a sign-in page and two new kinds of exchange in `/token`:

```ts
// idp.ts, new parts
// Registered clients and where they may send the user back to
const CLIENTS: Record<string, string[]> = {
  "company-agent": ["http://localhost:8080/callback"],
};

type Code = { user: string; clientId: string; redirectUri: string; challenge: string; expires: number };
const codes = new Map<string, Code>();
const refreshTokens = new Map<string, { user: string; expires: number }>();

async function sha256url(text: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Buffer.from(hash).toString("base64url");
}

async function sessionTokens(user: string) {
  const refresh = crypto.randomUUID();
  refreshTokens.set(refresh, { user, expires: Date.now() + 30 * 24 * 3600_000 });
  return Response.json({
    access_token: await issue(user, "company-agent", "1h"),
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: 3600,
  });
}

// inside fetch():
    // Sign-in page. A real provider asks for a password and a second factor; we let you pick an employee
    if (url.pathname === "/authorize" && req.method === "GET") {
      const p = url.searchParams;
      if (!CLIENTS[p.get("client_id") ?? ""]?.includes(p.get("redirect_uri") ?? "")) {
        return new Response("unknown client or redirect_uri", { status: 400 });
      }
      const hidden = ["client_id", "redirect_uri", "state", "code_challenge"]
        .map((k) => `<input type="hidden" name="${k}" value="${Bun.escapeHTML(p.get(k) ?? "")}">`)
        .join("");
      const buttons = Object.entries(USERS)
        .map(([id, u]) => `<button name="user" value="${id}">${Bun.escapeHTML(u.name)}</button>`)
        .join(" ");
      return new Response(`<form method="post">${hidden}<p>Sign in as:</p>${buttons}</form>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/authorize" && req.method === "POST") {
      const f = await req.formData();
      const clientId = String(f.get("client_id"));
      const redirectUri = String(f.get("redirect_uri"));
      const user = String(f.get("user"));
      if (!CLIENTS[clientId]?.includes(redirectUri) || !USERS[user]) return fail("invalid_request");
      const code = crypto.randomUUID();
      codes.set(code, {
        user, clientId, redirectUri,
        challenge: String(f.get("code_challenge")),
        expires: Date.now() + 60_000,
      });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", String(f.get("state")));
      return Response.redirect(back.toString(), 302);
    }

    if (url.pathname === "/token" && req.method === "POST") {
      const form = await req.formData();
      const grant = form.get("grant_type");

      // Exchange the code from the redirect for tokens. PKCE: the code is useless without the verifier,
      // which only the server that started the sign-in knows
      if (grant === "authorization_code") {
        const code = codes.get(String(form.get("code")));
        codes.delete(String(form.get("code")));
        if (!code || code.expires < Date.now()) return fail("invalid_grant");
        if (code.clientId !== form.get("client_id") || code.redirectUri !== form.get("redirect_uri")) {
          return fail("invalid_grant");
        }
        if ((await sha256url(String(form.get("code_verifier")))) !== code.challenge) return fail("invalid_grant");
        return sessionTokens(code.user);
      }

      // The refresh token is single-use: every refresh issues a new one and revokes the old one
      if (grant === "refresh_token") {
        const old = String(form.get("refresh_token"));
        const entry = refreshTokens.get(old);
        refreshTokens.delete(old);
        if (!entry || entry.expires < Date.now()) return fail("invalid_grant");
        return sessionTokens(entry.user);
      }
      // ... token exchange as in part 6
```

The refresh token here is single-use: every refresh issues a new one and revokes the old. In Keycloak and Okta this is turned on with the rotation setting, and it is worth turning on. A stolen refresh token then works only until the first refresh. If the thief refreshes first, the real owner's next refresh fails and they are sent back to the sign-in page, which gets noticed.

The client side of sign-in:

```ts
// oidc.ts
import { decodeJwt } from "jose";
import { type User, refreshTokenOf, saveUser } from "./store";

const ISSUER = process.env.ISSUER ?? "http://localhost:4000";
const CLIENT_ID = "company-agent";
export const PUBLIC_URL = process.env.PUBLIC_URL ?? "http://localhost:8080";
const REDIRECT_URI = `${PUBLIC_URL}/callback`;

const base64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(new Uint8Array(bytes)).toString("base64url");

// Start of sign-in: a random state against forged redirects, and a PKCE verifier
export async function startLogin() {
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const url = new URL(`${ISSUER}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), state, verifier };
}

type Tokens = { access_token: string; refresh_token: string; expires_in: number };

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${ISSUER}/token`, { method: "POST", body: new URLSearchParams(params) });
  if (!res.ok) throw new Error(`SSO: ${res.status} ${await res.text()}`);
  return (await res.json()) as Tokens;
}

// The employee's tokens live in memory, the refresh token also in the database.
// The access token refreshes itself a minute before it expires
const sessions = new Map<string, { access: string; expires: number; pending?: Promise<string> }>();

function remember(user: string, t: Tokens) {
  sessions.set(user, { access: t.access_token, expires: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

export async function finishLogin(code: string, verifier: string): Promise<User> {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
  });
  const claims = decodeJwt(tokens.access_token) as { sub: string; name: string; email: string };
  const user = { login: claims.sub, name: claims.name, email: claims.email };
  await saveUser(user, tokens.refresh_token);
  remember(user.login, tokens);
  return user;
}

export function userToken(user: User) {
  return async () => {
    const s = sessions.get(user.login);
    if (s && s.expires > Date.now() + 60_000) return s.access;
    // The refresh token is single-use: two parallel refreshes would cancel each other out
    if (s?.pending) return s.pending;
    const pending = (async () => {
      const refresh = await refreshTokenOf(user.login);
      if (!refresh) throw new Error("sign in through SSO again");
      const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh, client_id: CLIENT_ID });
      await saveUser(user, tokens.refresh_token);
      return remember(user.login, tokens);
    })();
    sessions.set(user.login, { access: s?.access ?? "", expires: 0, pending });
    try {
      return await pending;
    } catch (err) {
      sessions.delete(user.login);
      throw err;
    }
  };
}
```

The subtlest part is `userToken`. If two requests see at the same moment that the token is expiring and both go to refresh it, the first gets a new refresh token, the second arrives with the old, already revoked one, and the employee is logged out. So there is a single refresh per user, and the rest wait for its result.

In a real provider the web application is registered as a confidential client with a secret, and the secret is added to requests to `/token`. The `offline_access` scope is needed for the provider to issue a refresh token at all.

## Where to keep tokens and conversations

```ts
// store.ts
import type Anthropic from "@anthropic-ai/sdk";
import { Database } from "bun:sqlite";

const db = new Database(process.env.STORE_DB ?? "store.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    login TEXT PRIMARY KEY, name TEXT, email TEXT,
    refresh_token TEXT,           -- encrypted, see seal()
    slack_id TEXT UNIQUE
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, login TEXT NOT NULL, title TEXT,
    messages TEXT NOT NULL,       -- history for the API as is, append-only
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// A refresh token gives access to the employee's data for weeks ahead,
// so it is stored in the database encrypted with a key from the environment
const key = await crypto.subtle.importKey(
  "raw",
  Buffer.from(process.env.TOKEN_KEY ?? "", "base64"),
  "AES-GCM",
  false,
  ["encrypt", "decrypt"],
);

async function seal(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(data).toString("base64")}`;
}

async function open(sealed: string) {
  const [iv, data] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data));
}

export type User = { login: string; name: string; email: string };

export async function saveUser(user: User, refreshToken: string) {
  db.run(
    `INSERT INTO users (login, name, email, refresh_token) VALUES (?, ?, ?, ?)
     ON CONFLICT (login) DO UPDATE SET name = excluded.name, email = excluded.email,
       refresh_token = excluded.refresh_token`,
    [user.login, user.name, user.email, await seal(refreshToken)],
  );
}

export async function refreshTokenOf(login: string) {
  const row = db.query("SELECT refresh_token FROM users WHERE login = ?").get(login) as
    | { refresh_token: string | null }
    | null;
  return row?.refresh_token ? open(row.refresh_token) : null;
}

export function linkSlack(login: string, slackId: string) {
  db.run("UPDATE users SET slack_id = NULL WHERE slack_id = ?", [slackId]);
  db.run("UPDATE users SET slack_id = ? WHERE login = ?", [slackId, login]);
}

export function userBySlack(slackId: string) {
  return db.query("SELECT login, name, email FROM users WHERE slack_id = ?").get(slackId) as User | null;
}

export function getUser(login: string) {
  return db.query("SELECT login, name, email FROM users WHERE login = ?").get(login) as User | null;
}

export type Conversation = { id: string; login: string; title: string; messages: Anthropic.Beta.BetaMessageParam[] };

export function loadConversation(id: string, login: string): Conversation | null {
  // The login in the condition: someone else's conversation will not open by a known id
  const row = db.query("SELECT * FROM conversations WHERE id = ? AND login = ?").get(id, login) as
    | (Omit<Conversation, "messages"> & { messages: string })
    | null;
  return row ? { ...row, messages: JSON.parse(row.messages) } : null;
}

export function saveConversation(c: Conversation) {
  db.run(
    `INSERT INTO conversations (id, login, title, messages) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET messages = excluded.messages, updated_at = CURRENT_TIMESTAMP`,
    [c.id, c.login, c.title, JSON.stringify(c.messages)],
  );
}

export function listConversations(login: string) {
  return db
    .query("SELECT id, title, updated_at FROM conversations WHERE login = ? ORDER BY updated_at DESC LIMIT 50")
    .all(login) as { id: string; title: string; updated_at: string }[];
}
```

**The refresh token is encrypted.** It gives access to the employee's data for weeks ahead, and sooner or later the database file ends up in a backup, on a developer's laptop or in a support ticket. The key lives in an environment variable, separate from the database. To generate one: `openssl rand -base64 32`.

**The conversation is stored as is.** The `messages` column holds exactly the array that goes to the API, with all tool calls, thinking blocks and `compaction` blocks. If you stored only the text of questions and answers, you could not continue the conversation tomorrow: the model would not see what it had already found. The human sees a digest of this array through `transcript`.

**The login is in every conversation query.** `loadConversation(id, login)` looks up by both fields. Without that, any employee who learned the id of someone else's conversation could read it, and it contains answers built on someone else's permissions.

## The web server

```ts
// web.ts
import { type Events, ask, transcript } from "./agent-core";
import { PUBLIC_URL, finishLogin, startLogin } from "./oidc";
import { handleSlack, slackEmail, takeLinkToken } from "./slack";
import { type User, getUser, linkSlack, listConversations, loadConversation } from "./store";

const SECURE = PUBLIC_URL.startsWith("https://") ? "; Secure" : "";
const SESSION_HOURS = 12;

// Browser sessions: a random id in the cookie, the login on the server
const sessions = new Map<string, { login: string; expires: number }>();
// Sign-ins in progress: state from the redirect -> verifier and, for a sign-in from Slack, whom to link
const logins = new Map<string, { verifier: string; slackId?: string; expires: number }>();
// Dangerous calls awaiting confirmation
const confirms = new Map<string, (ok: boolean) => void>();

function cookie(req: Request, name: string) {
  const match = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1];
}

function currentUser(req: Request): User | null {
  const session = sessions.get(cookie(req, "sid") ?? "");
  if (!session || session.expires < Date.now()) return null;
  return getUser(session.login);
}

async function login(url: URL) {
  const slackId = takeLinkToken(url.searchParams.get("slack") ?? "");
  const { url: authorize, state, verifier } = await startLogin();
  logins.set(state, { verifier, slackId, expires: Date.now() + 10 * 60_000 });
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize,
      "set-cookie": `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${SECURE}`,
    },
  });
}

async function callback(req: Request, url: URL) {
  const state = url.searchParams.get("state") ?? "";
  const pending = logins.get(state);
  logins.delete(state);
  // The state in the URL must match the one we put in this browser's cookie
  if (!pending || pending.expires < Date.now() || cookie(req, "oauth_state") !== state) {
    return new Response("sign-in expired, start again", { status: 400 });
  }
  const user = await finishLogin(url.searchParams.get("code") ?? "", pending.verifier);

  let note = "";
  if (pending.slackId) {
    // Link Slack only if the email in Slack matches the email in SSO.
    // Otherwise someone else's link would bind your sign-in to their Slack account
    const email = await slackEmail(pending.slackId).catch(() => undefined);
    if (email && email === user.email) linkSlack(user.login, pending.slackId);
    else note = "?slack=mismatch";
  }

  const sid = crypto.randomUUID();
  sessions.set(sid, { login: user.login, expires: Date.now() + SESSION_HOURS * 3600_000 });
  return new Response(null, {
    status: 302,
    headers: [
      ["location", `/${note}`],
      ["set-cookie", `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${SECURE}`],
      ["set-cookie", "oauth_state=; Path=/; Max-Age=0"],
    ],
  });
}

function chat(req: Request, user: User, body: { conversationId?: string; text: string }) {
  const text = body.text?.trim();
  if (!text) return new Response("empty question", { status: 400 });
  const conv = body.conversationId
    ? loadConversation(body.conversationId, user.login)
    : { id: crypto.randomUUID(), login: user.login, title: text.slice(0, 60), messages: [] };
  if (!conv) return new Response("no such conversation", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false; // the browser closed the tab; we still finish and save the answer
        }
      };
      // While the model thinks there is no data. An event every 15 seconds keeps the connection open
      const ping = setInterval(() => send("ping", {}), 15_000);

      const events: Events = {
        text: (delta) => send("text", delta),
        tool: (name, input) => send("tool", { name, input }),
        // A dangerous call waits two minutes for the human, then counts as declined
        confirm: (name, input) =>
          new Promise<boolean>((resolve) => {
            const id = crypto.randomUUID();
            const key = `${user.login}:${id}`;
            confirms.set(key, resolve);
            send("confirm", { id, name, input });
            setTimeout(() => {
              confirms.delete(key);
              resolve(false);
            }, 120_000);
          }),
      };

      send("conversation", { id: conv.id, title: conv.title });
      try {
        const result = await ask(user, conv, text, events);
        send("done", result);
      } catch (err) {
        console.error(err);
        send("error", "Could not answer, please try again.");
      } finally {
        clearInterval(ping);
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

Bun.serve({
  port: 8080,
  idleTimeout: 60, // seconds without data before the connection drops; pings come more often
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (pathname === "/login") return login(url);
    if (pathname === "/callback") return callback(req, url);
    if (pathname === "/slack/events" && req.method === "POST") return handleSlack(req);

    const user = currentUser(req);
    if (!user) {
      return pathname.startsWith("/api/")
        ? new Response("unauthorized", { status: 401 })
        : new Response(null, { status: 302, headers: { location: "/login" } });
    }

    if (pathname === "/") return new Response(Bun.file("public/index.html"));
    if (pathname === "/logout" && req.method === "POST") {
      sessions.delete(cookie(req, "sid") ?? "");
      return new Response(null, { status: 303, headers: { location: "/login", "set-cookie": "sid=; Path=/; Max-Age=0" } });
    }
    if (pathname === "/api/me") return Response.json({ name: user.name });
    if (pathname === "/api/conversations") return Response.json(listConversations(user.login));
    if (pathname.startsWith("/api/conversations/")) {
      const conv = loadConversation(pathname.split("/").pop() ?? "", user.login);
      return conv ? Response.json(transcript(conv.messages)) : new Response("not found", { status: 404 });
    }
    // JSON only: a plain form on another site cannot send it, and a SameSite=Lax cookie does not go with another site's fetch
    if (req.method === "POST" && req.headers.get("content-type") !== "application/json") {
      return new Response("unsupported media type", { status: 415 });
    }
    if (pathname === "/api/chat" && req.method === "POST") return chat(req, user, await req.json());
    if (pathname === "/api/confirm" && req.method === "POST") {
      const { id, ok } = (await req.json()) as { id: string; ok: boolean };
      const key = `${user.login}:${id}`;
      confirms.get(key)?.(ok === true);
      confirms.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`web chat at ${PUBLIC_URL}`);
```

What matters for security here:

- **The session cookie** is `HttpOnly` (a script on the page cannot read it), `SameSite=Lax` (it is not sent with requests started by another site) and `Secure` over HTTPS. The cookie holds only a random id; everything else is on the server.
- **JSON only in POST.** An HTML form on another site cannot send `application/json`, so a question cannot be forged on an employee's behalf through a form.
- **Someone else's conversation returns 404**, not 403, for the same reason as the wiki in part 6: we do not confirm that the conversation exists.

And a few details about streaming:

- **SSE over POST.** The classic `EventSource` only does GET, and it is more convenient to send the question in the request body. So the response is a plain `text/event-stream`, and the browser reads it with `fetch` and a `ReadableStream`.
- **Pings.** While the model is thinking or waiting for a tool, there is no data. Bun closes a connection after 10 seconds of silence by default, and so do proxies along the way. An empty event every 15 seconds keeps the connection alive, and `idleTimeout` is raised to a minute.
- **A closed tab does not lose the answer.** If the browser disconnects, `send` simply stops writing, while the turn runs to the end and is saved. The employee opens the conversation and sees the answer.
- **Confirmation of a dangerous call** arrives in the browser as a `confirm` event, and the employee's answer goes back as a separate request to `/api/confirm`. The turn waits meanwhile, but for no more than two minutes.

## The page

The whole page is one HTML file with no build step. I am skipping the styles; the important part is the script:

```html
<script>
let conversationId = null;
const log = document.getElementById("log");

// textContent only: the model's answer may contain text from documents,
// and it must never be inserted as HTML
function add(cls, text) {
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.textContent = text;
  log.append(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

async function loadList() {
  const list = await (await fetch("/api/conversations")).json();
  const box = document.getElementById("list");
  box.replaceChildren(...list.map((c) => {
    const b = document.createElement("button");
    b.textContent = c.title;
    b.className = c.id === conversationId ? "active" : "";
    b.onclick = () => open(c.id);
    return b;
  }));
}

async function open(id) {
  conversationId = id;
  log.replaceChildren();
  for (const m of await (await fetch(`/api/conversations/${id}`)).json()) add(m.role, m.text);
  loadList();
}

document.getElementById("new").onclick = () => { conversationId = null; log.replaceChildren(); loadList(); };

document.getElementById("form").onsubmit = async (ev) => {
  ev.preventDefault();
  const input = document.getElementById("input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  add("user", text);
  let answer = null;

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId, text }),
  });
  if (!res.ok) return add("note", await res.text());

  // Read the SSE event stream from the response body
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop();
    for (const chunk of chunks) {
      const event = chunk.match(/^event: (.*)$/m)?.[1];
      const data = JSON.parse(chunk.match(/^data: (.*)$/m)?.[1] ?? "null");
      if (event === "conversation") conversationId = data.id;
      if (event === "text") (answer ??= add("assistant", "")).textContent += data;
      if (event === "tool") { add("tool", `🔧 ${data.name}`); answer = null; }
      if (event === "confirm") {
        const ok = confirm(`The agent wants to run ${data.name}:\n${JSON.stringify(data.input, null, 2)}`);
        fetch("/api/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: data.id, ok }) });
      }
      if (event === "done" && data.note) add("note", data.note);
      if (event === "error") add("note", data);
    }
  }
  loadList();
};

if (new URLSearchParams(location.search).get("slack") === "mismatch") {
  add("note", "Could not link Slack: the email in Slack does not match the company email.");
}
loadList();
</script>
```

One rule matters more than the rest: the model's answer is inserted with `textContent`, never `innerHTML`. The agent reads documents that anyone could have written and retells them. If a document contains `<img src=x onerror=...>` and the page inserts the answer as HTML, the script runs in the employee's session. If you want nice Markdown, render it with a library and pass the result through a sanitizer such as DOMPurify.

## The Slack bot

First the Slack app: create an app on api.slack.com, and under Event Subscriptions set the URL `https://agent.company.com/slack/events` and the `message.im` and `app_mention` events. Bot scopes: `chat:write`, `im:history`, `app_mentions:read`, `users:read`, `users:read.email`. From the settings you will need the Bot Token and the Signing Secret.

```ts
// slack.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { ask } from "./agent-core";
import { PUBLIC_URL } from "./oidc";
import { loadConversation, userBySlack } from "./store";

const SLACK_API = process.env.SLACK_API ?? "https://slack.com/api";
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "";
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";

async function slack(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${BOT_TOKEN}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; error?: string; [key: string]: unknown };
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
  return data;
}

// The request really comes from Slack: an HMAC signature with the app secret and a fresh timestamp
function verify(req: Request, raw: string) {
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature") ?? "";
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = `v0=${createHmac("sha256", SIGNING_SECRET).update(`v0:${ts}:${raw}`).digest("hex")}`;
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Single-use links for binding Slack to the SSO account
const linkTokens = new Map<string, { slackId: string; expires: number }>();

export function takeLinkToken(token: string) {
  const entry = linkTokens.get(token);
  linkTokens.delete(token);
  return entry && entry.expires > Date.now() ? entry.slackId : undefined;
}

export async function slackEmail(slackId: string) {
  const data = await slack("users.info", { user: slackId });
  return (data.user as { profile: { email?: string } }).profile.email;
}

type SlackEvent = {
  type: string; channel: string; channel_type?: string; user: string;
  text: string; ts: string; thread_ts?: string; bot_id?: string; subtype?: string;
};

export async function handleSlack(req: Request) {
  const raw = await req.text();
  if (!verify(req, raw)) return new Response("bad signature", { status: 401 });
  const body = JSON.parse(raw);
  if (body.type === "url_verification") return Response.json({ challenge: body.challenge });
  // Slack repeats an event if it gets no response within 3 seconds. We are already preparing the answer
  if (req.headers.get("x-slack-retry-num")) return new Response("ok");

  const e = body.event as SlackEvent | undefined;
  if (body.type === "event_callback" && e && !e.bot_id && !e.subtype) {
    if (e.type === "message" && e.channel_type === "im") answer(e).catch((err) => console.error(err));
    if (e.type === "app_mention") {
      // The answer is built on the asker's permissions, and everyone in the channel would see it
      slack("chat.postEphemeral", {
        channel: e.channel,
        user: e.user,
        text: "I only answer in direct messages: answers are built on your access rights, and everyone in the channel would see them.",
      }).catch((err) => console.error(err));
    }
  }
  return new Response("ok");
}

async function answer(e: SlackEvent) {
  const user = userBySlack(e.user);
  if (!user) {
    const token = crypto.randomUUID();
    linkTokens.set(token, { slackId: e.user, expires: Date.now() + 10 * 60_000 });
    await slack("chat.postMessage", {
      channel: e.channel,
      text: `First sign in through the company sign-in so I know which data I may show you: ${PUBLIC_URL}/login?slack=${token}`,
    });
    return;
  }

  // A Slack thread is a conversation: the history continues while replies stay in the same thread
  const threadTs = e.thread_ts ?? e.ts;
  const id = `slack:${e.channel}:${threadTs}`;
  const text = e.text.trim();
  const conv = loadConversation(id, user.login) ?? { id, login: user.login, title: text.slice(0, 60), messages: [] };

  const msg = await slack("chat.postMessage", { channel: e.channel, thread_ts: threadTs, text: "Thinking…" });
  const tools: string[] = [];
  let reply = "";
  let dirty = false;
  // Slack dislikes frequent message edits: update every second and a half
  const flush = async () => {
    if (!dirty) return;
    dirty = false;
    const shown = [tools.join("\n"), reply].filter(Boolean).join("\n\n");
    await slack("chat.update", { channel: e.channel, ts: msg.ts, text: shown || "Thinking…" });
  };
  const timer = setInterval(() => flush().catch((err) => console.error(err)), 1500);

  try {
    const result = await ask(user, conv, text, {
      text: (delta) => {
        reply += delta;
        dirty = true;
      },
      tool: (name) => {
        tools.push(`_🔧 ${name}_`);
        dirty = true;
      },
      // The bot has no confirmation buttons: dangerous actions only from the web chat
      confirm: async () => false,
    });
    if (result.note) reply += `\n\n_${result.note}_`;
  } catch (err) {
    console.error(err);
    reply = "Could not answer, please try again.";
  } finally {
    clearInterval(timer);
    dirty = true;
    await flush();
  }
}
```

**The signature.** The `/slack/events` URL is open to the internet, and without a check anyone could send an event saying "user U1 is asking about salaries". Slack signs every request with the app secret, and the timestamp prevents replaying an old signed request.

**Three seconds.** Slack waits three seconds for a response to an event, then retries it. The agent's answer takes longer, so we reply `ok` at once and start the work without `await`. Retries with the `x-slack-retry-num` header are skipped, otherwise the agent would answer one question twice.

**Who is writing.** Slack reports the user's Slack id, but the agent needs an SSO account with a token. On the first message the bot sends a sign-in link, and after sign-in we remember the binding. The link is single-use and lives for ten minutes.

There is a trap here. Without the email check, an attacker could message the bot themselves, get a link for binding their own Slack account, and forward it to a colleague saying "check out this new portal". The colleague signs in through SSO, and the attacker's Slack account ends up bound to the colleague's account, with all of its permissions. So after sign-in we compare the email from SSO with the email on the Slack profile and bind only if they match.

**Direct messages only.** The answer is built on the permissions of whoever asked. If the HR director asks about salaries in a public channel, everyone sees the answer. So to a mention in a channel the bot replies with a message visible only to the asker, asking them to write in a DM. A thread in the DM is one conversation: as long as you reply in the same thread, the agent remembers the context.

**Streaming by editing.** The bot immediately writes "Thinking…" and then edits that message as the answer arrives. Slack has rate limits on API calls, and an edit per text fragment would hit them quickly, so the accumulated text is sent every second and a half. Slack also has dedicated methods for streaming AI app replies: `chat.startStream`, `chat.appendStream` and `chat.stopStream`. Editing a message works in any workspace and shows the idea without extra dependencies. If your app is set up as a Slack AI assistant, the streaming methods give smoother output.

**No confirmations.** Slack buttons need a separate interactivity handler. To keep things simple, dangerous tools are always declined from the bot, and the model says the action is available in the web chat. All the tools from our parts only read, so nothing changes for them.

Almost all of this is the same for Mattermost, Microsoft Teams and other messengers: verify the signature, respond to the event quickly, bind the account with a check, answer only in direct messages.

## Running it

```bash
export TOKEN_KEY=$(openssl rand -base64 32)
export SLACK_BOT_TOKEN=xoxb-... SLACK_SIGNING_SECRET=...
export PUBLIC_URL=http://localhost:8080

bun idp.ts            # teaching SSO, :4000
bun wiki-server.ts    # :3001
bun db-server.ts      # :3002
bun web.ts            # web chat and Slack webhook, :8080
```

Open `http://localhost:8080`, get redirected to the sign-in page, pick an employee and land in the chat. For Slack to reach a local machine you need a tunnel (ngrok, cloudflared) or a test environment.

We checked the whole chain with stubs for the model and Slack:

- Igor signs in, asks about deals and sees only his two. RLS from part 6 works through the web exactly as it did in the terminal.
- A second question in the same conversation continues the history.
- Without a cookie the API returns 401, a form POST returns 415, and Olga requesting Igor's conversation by id gets 404.
- A Slack signature with the wrong secret gives 401. The first message from an unknown user leads to a sign-in link. After sign-in the account is bound, and reusing the same link binds nothing. A Slack user with a different email is not bound.
- After a server restart the bot answers Igor without a new sign-in: the access token is obtained again from the refresh token in the database.

## Before production

- **Sessions and locks in memory.** This works while there is a single server instance. For several instances, sessions, pending confirmations and conversation locks move to Redis or the database.
- **A rate limit per employee.** The daily money limit from part 7 is there, but it is worth limiting questions per minute too, so a script with a stolen cookie cannot flood the queue.
- **Formatting.** The model writes Markdown, while Slack has its own mrkdwn syntax: links and bold are written differently. A simple converter of a few regular expressions solves most of it. Long answers should be split into several messages.
- **Offboarding.** When an employee leaves, their account is disabled in SSO, and the next token refresh fails. But the access token lives for up to an hour. If you need faster, delete the refresh token and sessions on an event from the employee directory.

## Next

The agent has an interface and can be used. [One part remains](/blog/agent-prod/): taking it to production. Deploying inside the company perimeter, building a proper audit log, checking answer quality with a set of questions and reference answers, and defending against prompt injection in the documents the agent reads.
