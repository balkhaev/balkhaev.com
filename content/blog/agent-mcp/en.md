---
title: "MCP: connecting internal systems"
description: Move the agent's tools into separate MCP servers, write our own server for the company database, and teach the agent to connect to any server from a config.
date: 2026-11-04
series: company-agent
part: 4
tags: [agents, mcp, practice]
---

:::tldr
MCP is the standard way to give an agent tools. Each company system gets a small server of its own that describes its tools and runs them. The agent connects to the servers listed in a config, collects their tools and hands them to the model. In this part we write an MCP server for the company database (read-only) and turn the agent into an MCP client. About 200 lines, and everything runs locally.
:::

In [the previous part](/blog/agent-loop/) the agent's tools lived inside its code. That is fine for a teaching agent, not for a company one. A company has dozens of systems, each with its own access, its own team and its own pace of change. Wire them all into one service and it becomes a monolith nobody dares to touch.

## What MCP is

The [Model Context Protocol](https://modelcontextprotocol.io) is an open protocol between an agent and the things that provide tools. Anthropic created it; Claude, ChatGPT, Cursor, VS Code and most agent frameworks now support it.

It is simple:

- An **MCP server** knows one system: a database, a wiki, an issue tracker. It returns a list of tools with descriptions and JSON schemas and runs them on request.
- An **MCP client** lives inside the agent. It connects to servers, fetches their tool lists, shows them to the model and forwards the calls.
- There are two **transports**: `stdio`, where the client starts the server as a child process and talks over stdin/stdout, and HTTP, where the server runs on its own and is reached over the network. Today we use `stdio`; HTTP comes up in the permissions part.

We use the current protocol revision, [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28), and version 2 of the TypeScript SDK. It splits the SDK into `@modelcontextprotocol/server` and `@modelcontextprotocol/client`, and the protocol itself is now stateless: every request carries the protocol version and client details, so a server scales like an ordinary HTTP service. The client negotiates the version itself and can still talk to older 2025-era servers.

Besides tools, a server can expose resources (documents to read) and ready-made prompts, but for an agent tools are what matters.

What this buys us:

- **Separation.** The database server is written and maintained by the team that knows the database. The agent does not need to know how each system works.
- **Ready-made servers.** GitHub, Jira, Confluence, Notion, Slack, Postgres and Google Drive already have MCP servers, official or community-built.
- **Reuse.** The same server plugs into Claude Desktop, Claude Code or Cursor. Employees can use it without our agent.
- **Isolation.** Only the MCP server process knows the database password, not the agent and certainly not the model.

::news{topic="mcp agents"}

## Step 1. A demo company database

To keep everything runnable without real infrastructure we use SQLite, which is built into Bun. Three tables: employees, clients and deals. In a real company this is Postgres or ClickHouse, and the server code barely changes.

```ts
// seed.ts
import { Database } from "bun:sqlite";

const db = new Database("company.db");
db.exec(`
  DROP TABLE IF EXISTS deals; DROP TABLE IF EXISTS clients; DROP TABLE IF EXISTS employees;
  CREATE TABLE employees (
    id INTEGER PRIMARY KEY, name TEXT, department TEXT, position TEXT, salary INTEGER
  );
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY, name TEXT, region TEXT, industry TEXT
  );
  CREATE TABLE deals (
    id INTEGER PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id),
    owner_id INTEGER REFERENCES employees(id),
    amount INTEGER,           -- in dollars
    stage TEXT,               -- lead | negotiation | won | lost
    closed_at TEXT            -- close date, YYYY-MM-DD, NULL while open
  );
`);

const employees = [
  ["Anna Peters", "Sales", "Head of sales", 9500],
  ["Ian Smith", "Sales", "Account manager", 5500],
  ["Oliver Kim", "Sales", "Account manager", 5200],
  ["Maria Orlova", "Engineering", "Team lead", 11000],
  ["Dennis Wolf", "Engineering", "Backend developer", 8500],
];
for (const e of employees) {
  db.run("INSERT INTO employees (name, department, position, salary) VALUES (?, ?, ?, ?)", e);
}

const clients = [
  ["Northern Steel Service", "North-West", "Manufacturing"],
  ["Fresh Corner", "Capital", "Retail"],
  ["TransLogistics", "Central", "Logistics"],
  ["MedTech", "Capital", "Healthcare"],
  ["Lakeside Tours", "East", "Tourism"],
];
for (const c of clients) {
  db.run("INSERT INTO clients (name, region, industry) VALUES (?, ?, ?)", c);
}

// A deterministic generator, so everyone gets the same data
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const stages = ["lead", "negotiation", "won", "won", "lost"];
for (let i = 0; i < 60; i++) {
  const stage = stages[Math.floor(rand() * stages.length)];
  const month = 7 + Math.floor(rand() * 4); // July to October
  const day = 1 + Math.floor(rand() * 28);
  const closed =
    stage === "won" || stage === "lost"
      ? `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : null;
  db.run(
    "INSERT INTO deals (client_id, owner_id, amount, stage, closed_at) VALUES (?, ?, ?, ?, ?)",
    [1 + Math.floor(rand() * 5), 1 + Math.floor(rand() * 3), 1_000 * (1 + Math.floor(rand() * 40)), stage, closed],
  );
}
console.log("company.db is ready");
```

```bash
bun add @modelcontextprotocol/server @modelcontextprotocol/client zod
bun seed.ts
```

## Step 2. An MCP server for the database

The server offers two tools: `describe_schema` returns a description of the tables, `query` runs a single `SELECT`.

```ts
// db-server.ts
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Database } from "bun:sqlite";
import { z } from "zod";

// Read-only: even if the model sends a DELETE, the database will not run it
const db = new Database(process.env.DB_PATH ?? "company.db", { readonly: true });
const MAX_ROWS = 200;

// Column descriptions matter more than the names: they are how the model understands the data
const DOCS = `Company database tables:

employees: id, name, department, position, salary (monthly, in dollars)
clients: id, name, region, industry
deals: id, client_id → clients.id, owner_id → employees.id (account manager),
  amount (in dollars), stage (lead | negotiation | won | lost),
  closed_at (close date YYYY-MM-DD, NULL for open deals)

SQLite dialect. Month of a date: strftime('%Y-%m', closed_at).`;

function buildServer() {
  const server = new McpServer({ name: "company-db", version: "1.0.0" });

  server.registerTool(
    "describe_schema",
    {
      description: "Describes the tables and columns of the company database. Call it before the first query.",
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: "text", text: DOCS }] }),
  );

  server.registerTool(
    "query",
    {
      description: `Run one SELECT against the company database (SQLite, read-only). Returns up to ${MAX_ROWS} rows as JSON.`,
      inputSchema: z.object({ sql: z.string().describe("One SELECT or WITH ... SELECT query") }),
      annotations: { readOnlyHint: true },
    },
    async ({ sql }) => {
      const text = sql.trim().replace(/;$/, "");
      if (!/^(select|with)\b/i.test(text) || text.includes(";")) {
        return {
          isError: true,
          content: [{ type: "text", text: "Only a single SELECT query is allowed" }],
        };
      }
      try {
        const rows = db.query(text).all();
        const shown = rows.slice(0, MAX_ROWS);
        const note = rows.length > MAX_ROWS ? `\n(showing ${MAX_ROWS} of ${rows.length})` : "";
        return { content: [{ type: "text", text: JSON.stringify(shown) + note }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    },
  );

  return server;
}

// One server per connection: serveStdio calls the factory when the agent starts the process
serveStdio(buildServer);
```

Why it is built this way.

**The schema description is written by hand.** We could hand the model the `CREATE TABLE` statements, but column names rarely explain meaning. That `amount` is in dollars, that open deals have an empty `closed_at`, that `stage` takes four values: the model learns this only from the description. In a real database with a hundred tables this is the most valuable part of the server, and it is worth writing together with the people who know the data.

**Read-only at two levels.** Checking for `SELECT` catches obvious mistakes, but it is easy to get around: `WITH x AS (SELECT 1) DELETE FROM deals` starts with `WITH`. The real protection is that the database is opened `readonly`, so that query fails with `attempt to write a readonly database`. In Postgres you do the same with a role that only has `SELECT` and `default_transaction_read_only = on`. Never rely on checking the query text alone.

**A row limit.** The model does not need a hundred thousand rows; it needs aggregates. The limit protects the context and your wallet, and the note "showing 200 of 5000" nudges the model to rewrite the query with `GROUP BY`.

**Errors are returned, not thrown.** `isError: true` with SQLite's error text lets the model read what is wrong with the query and fix it. In practice the model often gets a column name wrong on the first try and fixes the query on the second.

**A factory, not a single server.** `serveStdio` takes a function that builds the server and calls it for each connection. The HTTP version in [part 6](/blog/agent-auth/) works the same way: there the server is built per request for a specific employee.

**`readOnlyHint`.** The annotation tells the client the tool changes nothing. Our agent asks for confirmation only for tools without it.

:::warning
A `stdio` server must not write to `console.log`: stdout carries the protocol, and any stray line breaks the exchange. Use `console.error` for debugging.
:::

You can test the server without the agent in MCP Inspector, a web UI for calling tools by hand:

```bash
npx @modelcontextprotocol/inspector bun db-server.ts
```

## Step 3. The agent as an MCP client

Now we teach the agent to connect to servers. The server list lives in `mcp.json`, in the same format as Claude Desktop and Cursor, so configs carry over between them.

```json
{
  "db": { "command": "bun", "args": ["db-server.ts"], "env": { "DB_PATH": "company.db" } }
}
```

The client connects to every server, fetches its tool list and turns each tool into the same `Tool` shape our local tools had. Export the `Tool` type from the previous part's `tools.ts`.

```ts
// mcp.ts
import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import type { Tool } from "./tools";

type ServerConfig = { command: string; args?: string[]; env?: Record<string, string> };

// Connects to every server in the config and turns its tools
// into the same shape as our local tools from the previous part
export async function connectMcp(config: Record<string, ServerConfig>) {
  const tools: Record<string, Tool> = {};
  const clients: Client[] = [];

  for (const [serverName, params] of Object.entries(config)) {
    // auto: speak the 2026-07-28 revision, fall back to the 2025 protocol for older servers
    const client = new Client(
      { name: "company-agent", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(new StdioClientTransport({ ...params, stderr: "inherit" }));
    clients.push(client);

    const { tools: list } = await client.listTools();
    for (const tool of list) {
      const name = `${serverName}__${tool.name}`; // db__query, wiki__search
      tools[name] = {
        definition: {
          name,
          description: tool.description ?? "",
          input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
        },
        // The server validates arguments against its own schema
        schema: z.record(z.string(), z.unknown()),
        // Anything the server did not mark read-only needs confirmation
        dangerous: tool.annotations?.readOnlyHint !== true,
        async run(input) {
          const result = await client.callTool({ name: tool.name, arguments: input });
          const text = (result.content as { type: string; text?: string }[])
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
          if (result.isError) throw new Error(text);
          return text;
        },
      };
    }
    console.log(`MCP ${serverName}: ${list.map((t) => t.name).join(", ")}`);
  }

  return { tools, close: () => Promise.all(clients.map((c) => c.close())) };
}
```

Tool names get the server as a prefix: `db__query`, `wiki__search`. Without it, two servers that both have a `search` tool would collide.

In `agent.ts` only the top changes: the tools now come from MCP and the system prompt is about the company. `runTool` and `agentTurn` stay as in the previous part. Add `await mcp.close()` at the end of the file so the server child processes exit with the agent.

```ts
// agent.ts, the top
import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";
import { connectMcp } from "./mcp";

const client = new Anthropic();
const mcp = await connectMcp(await Bun.file("mcp.json").json());
const tools = mcp.tools;
const rl = createInterface({ input: process.stdin, output: process.stdout });

const system = `You are an assistant for the company's employees. You answer questions about company data
using tools. Never make numbers up: everything you state must come from a tool.
If the data is not enough, say so. Keep answers short and end with where the data came from.`;
```

The company agent does not need the file tools from the previous part. If it ever does, they can be plugged in as an MCP server too: the official `@modelcontextprotocol/server-filesystem` is one line in `mcp.json`.

## Trying it

```bash
bun agent.ts
```

Ask something that needs the database: "what was revenue from won deals in October, by region?". The model first calls `db__describe_schema`, then writes a query with `JOIN` and `GROUP BY`, and if it gets the syntax wrong it reads the error and fixes it. Try a provocation too: "delete all lost deals". The model will most likely refuse on its own, and if it does try, the database returns an error.

Now ask "what is Maria Orlova's salary?". The agent answers without hesitation, because the whole `employees` table is open. Fine for a demo, not for a company: HR sees salaries, not everyone. That is exactly the problem the permissions part solves: the agent will query the database on behalf of a specific person.

## Why SQL and not ready-made functions

We let the model write arbitrary SQL. The alternative is narrow tools: `get_sales_by_region(month)`, `get_client(name)` and so on. Both have their place.

- **Arbitrary SQL** answers questions nobody anticipated. The price: the model can write a heavy query or misread the data. You need a replica or a separate analytics database, timeouts and a good schema description.
- **Narrow tools** are predictable, fast and easy to verify. The price: every new question needs a new tool.

In practice a mix works well: narrow tools for frequent and important questions (the metrics decisions are made on must be computed the same way every time) and SQL for everything else.

## Next

The agent can now answer questions about structured data. But most of a company's knowledge is not in tables, it is in text: the wiki, policies, contracts, meeting notes. In [the next part](/blog/agent-search/) we teach the agent to search documents.
