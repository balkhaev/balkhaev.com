---
title: "Company knowledge: searching documents"
description: Index the company wiki, write a full-text search MCP server, and teach the agent to search documents the way a person does.
date: 2026-11-04
series: company-agent
part: 5
tags: [agents, search, rag, mcp]
---

:::tldr
We split documents into chunks at headings and put them into SQLite's full-text index (FTS5 with BM25 ranking). On top of the index sits an MCP server with two tools: `search` finds chunks, `read` returns a whole document. The model decides what to search for, rephrases queries and combines what it finds with data from the database. Vector search comes later, once we can see where keywords fall short.
:::

In [the previous part](/blog/agent-mcp/) the agent learned to answer from tables. Tables hold numbers, though, and most of a company's knowledge lives in text: policies, contracts, incident reviews, meeting notes. SQL cannot answer "what are the payment terms in our contract with this client".

## Classic RAG and agentic search

The standard recipe, called RAG (retrieval-augmented generation), goes like this: split documents into chunks, turn each chunk into an embedding vector, and at question time find the nearest chunks and paste them into the prompt. The model answers from whatever it was given.

That recipe gets one attempt. If the first search brings back the wrong chunks, the model answers from them or says it does not know. It cannot ask again.

We already have an agent loop, so search becomes just another tool. The model writes the query, looks at the results, searches again with other words if needed, opens a whole document and checks it against the database. That is exactly how a person searches. Coding agents like Claude Code search files with plain `grep`, no vectors at all, and do well: what matters more is that the model can search many times.

So we start with something simple and proven: full-text search ranked with BM25. Vectors come once we see specific misses.

## Step 1. Documents

For the example we use a `wiki/` folder of markdown files: vacation, business travel, a client contract, an incident review, the compensation policy, a newcomer guide. In a real company this is an export from Confluence, Notion or Google Drive, but it pays to bring it into the same shape: a title, text, metadata.

```markdown
---
title: "Contract: Northern Steel Service"
access: [sales, management]
---

## Payment terms

Payment in stages: 30% upfront on signing, 50% after launch at the first plant,
20% after acceptance at all three. Invoices are due within 30 calendar days.
```

Note the `access` field: who may see the document. In this part we only store it; we check it in the next one, once the agent knows who is asking. Store permissions with the index from the very start: adding them to a live index later is harder than it looks.

## Step 2. Indexing

```ts
// index.ts
import { Database } from "bun:sqlite";
import { readdir } from "node:fs/promises";
import { YAML } from "bun";

const WIKI = process.argv[2] ?? "wiki";
const MAX_CHUNK = 1500; // characters: about half a page

const db = new Database("wiki.db");
db.exec(`
  DROP TABLE IF EXISTS docs;
  DROP TABLE IF EXISTS chunks;
  CREATE TABLE docs (path TEXT PRIMARY KEY, title TEXT, access TEXT, body TEXT);
  CREATE VIRTUAL TABLE chunks USING fts5(
    path UNINDEXED, title, heading, body,
    tokenize = 'porter unicode61'
  );
`);

// Split the document at second-level headings, and long sections at paragraphs
function split(body: string) {
  const chunks: { heading: string; text: string }[] = [];
  for (const section of body.split(/^## /m)) {
    const [first, ...rest] = section.split("\n");
    const heading = rest.length ? first.trim() : "";
    const text = rest.length ? rest.join("\n") : section;
    let current = "";
    for (const paragraph of text.split(/\n\s*\n/)) {
      if (current && current.length + paragraph.length > MAX_CHUNK) {
        chunks.push({ heading, text: current.trim() });
        current = "";
      }
      current += `${paragraph}\n\n`;
    }
    if (current.trim()) chunks.push({ heading, text: current.trim() });
  }
  return chunks;
}

let count = 0;
for (const file of await readdir(WIKI)) {
  if (!file.endsWith(".md")) continue;
  const source = await Bun.file(`${WIKI}/${file}`).text();
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    console.error(`${file}: no frontmatter, skipping`);
    continue;
  }
  const meta = YAML.parse(match[1]) as { title: string; access?: string[] };
  const body = match[2];
  db.run("INSERT INTO docs VALUES (?, ?, ?, ?)", [
    file,
    meta.title,
    JSON.stringify(meta.access ?? ["all"]),
    body,
  ]);
  for (const chunk of split(body)) {
    db.run("INSERT INTO chunks VALUES (?, ?, ?, ?)", [file, meta.title, chunk.heading, chunk.text]);
    count++;
  }
}
console.log(`indexed ${count} chunks`);
```

```bash
bun index.ts wiki
```

**Chunks follow headings.** We split at `##` because a section of a document is usually one complete thought. Long sections are further split at paragraphs so a chunk is about half a page. Chunks that are too small lose context; chunks that are too large blur the ranking and eat the model's context.

**Document and section titles are stored separately.** The chunk "Invoices are due within 30 days" does not say which client it is about. The document title "Contract: Northern Steel Service" next to it fixes that, and in search we give titles more weight.

**A full rebuild.** For a hundred documents it takes a fraction of a second. Once there are thousands, move to incremental updates: store a content hash and reindex only the files that changed, learning about changes from Confluence or Notion webhooks.

## Step 3. The search MCP server

```ts
// wiki-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Database } from "bun:sqlite";
import { z } from "zod";

const db = new Database(process.env.WIKI_DB ?? "wiki.db", { readonly: true });

// The porter tokenizer stems English words, so "payments" finds "payment".
// OR keeps recall high; bm25 ranks chunks that match more words first
function toFtsQuery(text: string) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words
    .filter((w) => w.length > 2)
    .map((w) => `"${w}"`)
    .join(" OR ");
}

const server = new McpServer({ name: "wiki", version: "1.0.0" });

server.registerTool(
  "search",
  {
    description:
      "Full-text search over the company wiki: policies, contracts, incident reviews. " +
      "Returns chunks with the document path. Search with short keyword queries " +
      "and rephrase if nothing is found. Call read to see a whole document.",
    inputSchema: {
      query: z.string().describe("Keywords, for example \"per diem abroad\""),
      limit: z.number().int().min(1).max(20).default(8),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, limit }) => {
    const fts = toFtsQuery(query);
    if (!fts) return { isError: true, content: [{ type: "text", text: "Empty query" }] };
    const rows = db
      .query(
        `SELECT path, title, heading,
                snippet(chunks, 3, '[', ']', '…', 32) AS snippet
         FROM chunks WHERE chunks MATCH ?
         ORDER BY bm25(chunks, 0, 5, 3, 1) LIMIT ?`,
      )
      .all(fts, limit) as { path: string; title: string; heading: string; snippet: string }[];
    if (!rows.length) {
      return { content: [{ type: "text", text: "Nothing found. Try other words." }] };
    }
    const text = rows
      .map((r, i) => `[${i + 1}] ${r.path} · ${r.title}${r.heading ? ` › ${r.heading}` : ""}\n${r.snippet}`)
      .join("\n\n");
    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "read",
  {
    description: "Read a whole wiki document by a path from the search results.",
    inputSchema: { path: z.string().describe("For example, travel.md") },
    annotations: { readOnlyHint: true },
  },
  async ({ path }) => {
    const doc = db.query("SELECT title, body FROM docs WHERE path = ?").get(path) as
      | { title: string; body: string }
      | null;
    if (!doc) return { isError: true, content: [{ type: "text", text: `No document ${path}` }] };
    return { content: [{ type: "text", text: `# ${doc.title}\n\n${doc.body}` }] };
  },
);

await server.connect(new StdioServerTransport());
```

**`search` and `read` together.** Search returns short chunks so the model can skim a dozen candidates without spending its whole context. If a chunk looks right, the model opens the whole document with `read` and reads the surrounding sections. A person does the same: look at the results, then open the page.

**Weighted BM25.** `bm25(chunks, 0, 5, 3, 1)` gives each column a weight: a match in the document title counts five times as much as a match in the text, in the section heading three times. This simple rule improves the results noticeably.

**Stemming.** The `porter` tokenizer reduces English words to stems, so "payments" finds "payment". For other languages SQLite has no stemmer; the Russian version of this post truncates word endings by hand, and in production you would use Postgres full-text search with the right language configuration or OpenSearch with a proper analyzer.

**`OR` rather than `AND`.** The query "payment terms northern steel" finds chunks containing at least one word, and BM25 ranks those that match more of them higher. Strict `AND` returns nothing more often, and an empty result is worse than a long one.

**The tool description teaches the model how to search.** The sentence "search with short keyword queries and rephrase if nothing is found" really changes behaviour: without it the model tends to send the user's whole question to search.

## Step 4. Plugging it into the agent

The agent from the previous part stays the same; just add the server to `mcp.json`:

```json
{
  "db": { "command": "bun", "args": ["db-server.ts"], "env": { "DB_PATH": "company.db" } },
  "wiki": { "command": "bun", "args": ["wiki-server.ts"], "env": { "WIKI_DB": "wiki.db" } }
}
```

And one line in the system prompt: "Cite wiki documents by path, for example travel.md". An answer with a citation can be checked; without one it is not trusted.

## Trying it

Ask something that needs both sources: "what are Northern Steel Service's payment terms and how much have we earned from them this year?". The agent finds the contract in the wiki, reads the payment section, then queries the database for the total of won deals and puts together an answer with both sources.

More questions to try: "what is the per diem abroad?", "why did the payment service go down, and has this happened before?". On the second, the agent finds the mention of a similar problem in March in the incident review and says honestly that the wiki has no details on the March case.

And the control question again: "what average raise is budgeted for 2026?". The agent answers from the compensation policy, even though its `access` field limits it to HR and management. We fix that in the next part.

## When you need vectors

Full-text search finds what is named with the same words. It misses when the user and the document say the same thing differently: "time off" and "unpaid leave", "quit" and "termination of employment", a question in English about a document in Russian. The agent partly makes up for it by rephrasing, but does not always guess right.

That is when you add vector search: at indexing time each chunk becomes an embedding (through an API such as Voyage, or a local model such as multilingual-e5), stored in pgvector or a separate vector database, and search looks for the nearest ones. A hybrid works best: run both searches and merge the lists with Reciprocal Rank Fusion. It does not need to compare BM25 scores with cosine similarity, which are not comparable; it only needs positions in the lists:

```ts
// Each list is sorted by relevance, best first; items are chunk ids
function rrf(lists: string[][], k = 60) {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
```

A chunk that ranks high in both lists rises to the top, and one found by only one method still makes it into the results.

Start with full-text search and record the questions the agent failed to answer even though the document existed. Once there is a noticeable number of them, it becomes clear whether you need vectors and which ones.

## Next

The agent knows the database and the wiki, but it answers everyone the same way and shows everything. The next part adds what matters most for a company agent: sign-in through the company SSO, OAuth, and an agent that calls systems on behalf of a specific employee and sees only what that employee sees.
