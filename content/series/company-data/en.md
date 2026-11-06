---
title: "Taming company data"
description: How to pull data scattered across accounting, CRM, spreadsheets and SaaS tools into one picture, agree on the numbers and put an AI assistant and automations on top. From a map of sources to answers in plain language.
plan:
  - "Concept: why data sprawls and what one picture means"
  - "Inventory: a map of sources, owners and questions"
  - "Ingest: copy data from every system into one warehouse"
  - "One story: reconcile customers, orders and money"
  - "Numbers everyone agrees on: metrics, glossary and checks"
  - "AI assistant: ask the data questions in plain language"
  - "Automation: data comes to people and systems by itself"
---

In a typical company of fifty to two hundred people, data lives everywhere. Orders in the accounting system, deals in the CRM, web orders in the site's database, the sales plan in a Google Sheet, tickets in the help desk, ads in ad accounts, and deals with big customers in someone's email and Telegram. Each system works on its own. Together they cannot answer even a simple question: how much did we earn from customers who came from ads last quarter, and which of them stopped ordering?

Usually a person with Excel answers it: exports, glues things together by hand, reconciles and three days later brings a number nobody trusts, because the CFO has a different one. This series is about replacing that manual work with a system: gather everything in one place, reconcile customers and orders into one story, agree on the numbers, and only then put an AI assistant on top that you can ask in plain language.

The running example is a wholesale and retail company of eighty people with an online store, a wholesale sales team and a warehouse. The stack is simple and current: Postgres 18 as the warehouse, dlt for loading, dbt for models, an MCP server and Claude Opus 5.5 for the assistant. None of it needs a data department: one engineer can build and run the whole system.

There is little code in the series: only the fragments that carry the idea. What matters is the decisions: what to collect, how to reconcile, what to agree on and where to stop. Tool versions are as of early November 2026, and each post has a news feed on the topic next to it.
