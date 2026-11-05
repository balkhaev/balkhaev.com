---
title: "Fine-tuning: a model for your own task"
description: How to fine-tune an open model on your own data without wasting a month. When you need it, building a dataset, LoRA on a rented GPU, evaluation, DPO and GRPO, distillation and shipping to production.
plan:
  - "Concept: when to fine-tune and when a prompt or RAG is enough"
  - "Data: where to get examples and how to clean them"
  - "First run: LoRA on one rented GPU"
  - "Evaluation: how to tell the model got better"
  - "Preferences: DPO from human edits and GRPO with a checkable reward"
  - "Distillation: a small model learns from a big one"
  - "To production: an adapter in vLLM, shadow mode and retraining"
---

Once you run your own model, the next question comes naturally: can it be made better at my particular task? It can. Fine-tuning turns a general open model into a narrow specialist that answers in your format and your tone, without a long prompt full of examples. A small fine-tuned model often beats a big general one on its task, at a fraction of the cost.

But fine-tuning is easy to make pointless. The usual mistakes: teaching the model facts that belonged in search, training on dirty data, not measuring quality before and after, and then not knowing whether things got better or worse. This series walks the path without those mistakes.

The running example is support ticket triage from the [automations series](/blog/series/automations/). There, Claude reads every incoming ticket. Here we teach a small open model to do the same on our own GPU, check that it does no worse, and carefully switch traffic over to it.

There is little code in the series: only the excerpts that carry the idea. The substance is in the decisions: what to collect, how to train, how to measure and when to stop. Tool versions are as of early November 2026, and each post has a news feed on the topic next to it.
