---
title: Commercial automations
description: Automations that make or save money, from the foundation to production. Which ones are worth building and why, where to host them, how to deploy and which tools to use.
plan:
  - "Concept: which automations pay off"
  - "The foundation: a server, a database and deploy on push"
  - "The core: events, a queue and retries"
  - "Leads in a minute: the form, qualification, the manager"
  - "Money: payments, access and reminders about unpaid invoices"
  - "Support: triaging the inbox and drafting replies"
  - "Reports and alerts: the morning digest and anomalies"
  - "Operations: monitoring, backups, secrets and cost"
---

Every business has a dozen repetitive processes that quietly lose money: a lead waits three hours for a manager, nobody notices a failed payment, someone builds the weekly report by hand every Monday. Each of them can be automated in an evening and then cleaned up after for half a year: lost webhooks, double charges, a bot that died on Friday and stayed silent until Monday.

In this series we build automations properly, from the foundation up. First we work out which of them actually pay off, then we set up a server, a database and deploy on push, write a reliable core with a queue and retries, and only then build concrete automations on top of it: leads, payments, support and reports. The last part is about running all of this and what it costs.

The stack is simple and framework-free: TypeScript and Bun, Postgres as both the database and the queue, Docker Compose on a single VPS, Caddy for HTTPS, GitHub Actions for deploys, Telegram for notifications and Claude over the API wherever we need to understand text. Every part ends with code that runs, and the next part builds on it.
