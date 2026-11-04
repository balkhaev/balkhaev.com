---
title: The company AI agent
description: Building an agent that knows a company's data and answers employees within their permissions. From concept to a running service, step by step, with code.
plan:
  - "Concept: an agent that knows the company"
  - Talking to a model
  - The agent loop and tools
  - "MCP: connecting internal systems"
  - "Company knowledge: searching documents"
  - "Permissions: SSO, OAuth and acting on behalf of an employee"
  - Context and money
  - "The interface: a chat bot and a web chat"
  - "Production: deploying inside the perimeter, audit and quality checks"
---

In every company the answers employees need are scattered across the wiki, databases, the issue tracker, the CRM and chat history. In this series we build an agent that searches all of these systems, knows who is asking and shows only what that person is allowed to see.

The series goes from idea to implementation. First we work out what we are building and why it is built this way, then we write it layer by layer: the model, the agent loop, connecting systems over MCP, document search, permissions, the interface and production. Every part ends with code that runs, and the next part builds on it.

The stack has no frameworks: TypeScript, Bun, a commercial model over an API (Claude) and the open MCP protocol.
