---
title: "Company knowledge: searching documents"
description: Index the company wiki, write a full-text search MCP server, and teach the agent to search documents the way a person does.
date: 2025-05-27
updated: 2026-11-04
series: company-agent
part: 5
tags: [agents, search, rag, mcp]
---

:::tldr
We split documents into chunks at headings and put them into SQLite's full-text index (FTS5 with BM25 ranking). On top of the index sits an MCP server with two tools: `search` finds chunks, `read` returns a whole document. The model decides what to search for, rephrases queries and combines what it finds with data from the database. Vectors aren't required for this: they are added next to full-text search when measurements show misses, not instead of it.
:::

In [the previous part](/blog/agent-mcp/) the agent learned to answer from tables. Tables hold numbers, though, and most of a company's knowledge lives in text: policies, contracts, incident reviews, meeting notes. SQL cannot answer "what are the payment terms in our contract with this client".

## What RAG is, and why it doesn't have to mean vectors

RAG (retrieval-augmented generation) means one thing only: before answering, find the right documents and give them to the model. The definition says nothing about how to search. But over the past few years RAG has almost become a synonym for one recipe: documents are cut into chunks, each chunk is turned into an embedding, and at question time the nearest vectors are found and pasted into the prompt.

That recipe has two weaknesses.

**One attempt.** If the first search brings back the wrong chunks, the model answers from them or says it doesn't know. It can't ask again.

**Vectors are bad at exact things.** An embedding captures the general meaning of a chunk, while work questions often hinge on an exact string: contract number 2026-041, a client's name, an error code, a surname. Full-text search finds these at once, while vector search may rank a chunk "about something similar" higher. On company documents full of names and terms, BM25 is usually no worse than embeddings, and the two work best together.

We already have an agent loop, so search becomes just another tool. The model writes the query itself, looks at the result, searches with other words, opens the whole document and checks it against the database. That's how a person searches. Coding agents work the same way: Claude Code searches a project with grep and by reading files, with no vector index. What makes the difference is that the model can search many times and check what it found.

So we start with full-text search ranked by BM25. It's cheap, easy to debug (you can see why a document matched), needs no re-embedding every time a document changes, and finds names and numbers exactly. We'll add vectors once we see concrete misses; more on that at the end of the article.

::news{topic="search"}

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

`index.ts` walks the folder, parses the frontmatter, splits every document into chunks and writes two tables: `docs` with whole documents (for reading) and the full-text `chunks` (for search):

```sql
CREATE TABLE docs (path TEXT PRIMARY KEY, title TEXT, access TEXT, body TEXT);
CREATE VIRTUAL TABLE chunks USING fts5(
  path UNINDEXED, title, heading, body,
  tokenize = 'porter unicode61'
);
```

It splits on `##` headings first, and a section longer than 1500 characters is split again on paragraphs.

```bash
bun index.ts wiki
```

**Chunks follow headings.** We split at `##` because a section of a document is usually one complete thought. Long sections are further split at paragraphs so a chunk is about half a page. Chunks that are too small lose context; chunks that are too large blur the ranking and eat the model's context.

**Document and section titles are stored separately.** The chunk "Invoices are due within 30 days" does not say which client it is about. The document title "Contract: Northern Steel Service" next to it fixes that, and in search we give titles more weight.

**A full rebuild.** For a hundred documents it takes a fraction of a second. Once there are thousands, move to incremental updates: store a content hash and reindex only the files that changed, learning about changes from Confluence or Notion webhooks.

## Step 3. The search MCP server

`wiki-server.ts` is built like the database server from the previous part, with two tools: `search` and `read`. `read` fetches a document from `docs` by path. All of `search` is one query:

```sql
SELECT path, title, heading, snippet(chunks, 3, '«', '»', '…', 32) AS snippet
FROM chunks WHERE chunks MATCH ?
ORDER BY bm25(chunks, 0, 5, 3, 1)
LIMIT 8
```

Before the query, the words of the question are joined with `OR`, so "payment terms northern steel" becomes `"payment" OR "terms" OR "northern" OR "steel"`. The tool description tells the model how to search: "Use short keyword queries, rephrase if nothing turns up. Call read to see a whole document."

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

## When to add vectors, and what to try first

Full-text search misses when the user and the document say the same thing in different words: "day off" and "unpaid leave", "quit" and "termination of the employment contract", a question in English and a document in Russian. The agent partly makes up for this by rephrasing the query, but it doesn't always guess.

Before a vector index, try the cheap steps:

- **Synonyms in the search tool.** A small dictionary of company terms ("day off" → "unpaid leave") expands the query before FTS. It's a couple of dozen lines, and its behaviour is completely predictable.
- **A hint in the tool description.** Ask the model to search with two or three phrasings, including the official terms. The model rephrases anyway, but an explicit instruction noticeably raises the share of successful searches.
- **Context on chunks.** A chunk saying "payment within 30 days" is useless without the contract's name. At indexing time each chunk gets a line saying where it came from: document, section, client. Anthropic described this technique as Contextual Retrieval, and it improves both full-text and vector search. Our index already stores the document title and section heading next to the text, which is the simplest version of the same idea.

If misses remain, vector search is added next to full-text search, not instead of it. Each chunk is turned into an embedding at indexing time (through an API such as Voyage, or a local model like multilingual-e5), stored in pgvector or a separate vector database, and both searches run for each question. The lists are merged with Reciprocal Rank Fusion. It doesn't need to compare incomparable BM25 and cosine scores; positions in the lists are enough:

```ts
// Each list is sorted by descending relevance; items are chunk ids
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

A chunk ranked high in both lists rises to the top, and one found by only one method still makes it into the results. If that's not enough, the next step is a reranker: a model that takes the question and 30–50 candidates from the hybrid search and re-sorts them by meaning. It's slower than search, so it only works on a short list.

Where vectors really win:

- questions in plain words against documents written in bureaucratese;
- a question in one language, documents in another;
- "find similar": similar incidents, contracts, customer requests;
- very large archives, where the agent can't afford a dozen searches per question.

Where they're not needed: exact numbers, names and codes, and a small wiki where a couple of queries are enough for the agent.

Decide by measurement, not fashion. Record the questions the agent failed to answer even though the document existed, and add them to the [check questions from part 9](/blog/agent-prod/#check-questions). Then you can see what each step bought you: synonyms, chunk context, vectors, a reranker.

## Next

The agent knows the database and the wiki, but it answers everyone the same way and shows everything. The [next part](/blog/agent-auth/) adds what matters most for a company agent: sign-in through the company SSO, OAuth, and an agent that calls systems on behalf of a specific employee and sees only what that employee sees.
