---
title: "MCP: connecting internal systems"
description: Move the agent's tools into separate MCP servers, write our own server for the company database, and teach the agent to connect to any server from a config.
date: 2025-04-22
updated: 2026-11-04
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

`seed.ts` creates these tables and fills them: five employees with salaries, five clients from different regions and 60 deals from July to October 2026 with random amounts and stages. Only the table layout matters here:

```sql
CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, position TEXT, salary INTEGER);
CREATE TABLE clients   (id INTEGER PRIMARY KEY, name TEXT, region TEXT, industry TEXT);
CREATE TABLE deals (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  owner_id  INTEGER REFERENCES employees(id),
  amount INTEGER,  -- in roubles
  stage TEXT,      -- lead | negotiation | won | lost
  closed_at TEXT   -- YYYY-MM-DD, NULL for open deals
);
```

```bash
bun add @modelcontextprotocol/server @modelcontextprotocol/client zod
bun seed.ts
```

## Step 2. An MCP server for the database

The server offers two tools: `describe_schema` returns a description of the tables, `query` runs a single `SELECT`.

Most of `db-server.ts` is registering the `query` tool:

```ts
const db = new Database("company.db", { readonly: true });

server.registerTool(
  "query",
  {
    description: "Run one SELECT against the company database (SQLite, read-only). Returns up to 200 rows as JSON.",
    inputSchema: z.object({ sql: z.string() }),
    annotations: { readOnlyHint: true },
  },
  async ({ sql }) => {
    try {
      const rows = db.query(sql).all();
      return { content: [{ type: "text", text: JSON.stringify(rows.slice(0, 200)) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: String(err) }] };
    }
  },
);
```

`describe_schema` is registered the same way and returns hand-written text: what each column means, what units the amounts are in, which stages exist. The server is built in a `buildServer()` function and started with one line, `serveStdio(buildServer)`.

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

The core of `mcp.ts` is these few lines for every server in the config:

```ts
const client = new Client({ name: "company-agent", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
await client.connect(new StdioClientTransport(params));

const { tools: list } = await client.listTools();
for (const tool of list) {
  tools[`${serverName}__${tool.name}`] = {
    definition: { name: `${serverName}__${tool.name}`, description: tool.description, input_schema: tool.inputSchema },
    dangerous: tool.annotations?.readOnlyHint !== true,
    run: (input) => client.callTool({ name: tool.name, arguments: input }),
  };
}
```

In the real file `run` also joins the text parts of the result into one string and throws when the server returns `isError`, and `runTool` from the previous part turns that into an error `tool_result`.

Tool names get the server as a prefix: `db__query`, `wiki__search`. Without it, two servers that both have a `search` tool would collide.

In `agent.ts` only the top changes: the tools now come from `connectMcp(mcp.json)`, and the system prompt is about the company: answer from tool data, never invent numbers, say so when data is missing, and name the source at the end. `runTool` and `agentTurn` stay as in the previous part. Add `await mcp.close()` at the end of the file so the server child processes exit with the agent.


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
