---
title: "Your own inference: open models on rented GPUs"
description: How to run an open model on a rented GPU without overpaying. When it beats an API, how to pick a GPU, what to run right now, where to rent and what it costs.
plan:
  - "Concept: when your own model beats an API"
  - "Choosing a GPU: memory, speed and weight formats"
  - "What to run now: models and engines"
  - "RunPod and Vast.ai: where to rent without overpaying"
  - "Your own endpoint: vLLM, measuring speed and key-based access"
  - "Images and video: ComfyUI on a rented GPU"
  - "Money: the price of a million tokens, idle time and serverless"
---

Open models have caught up with commercial ones on many tasks, and an H100-class GPU rents for a couple of dollars an hour. That makes it tempting to run your own model and stop paying per token. Sometimes this really is cheaper and more convenient. Sometimes it is a way to pay three times as much for the same thing and get a server to look after as a bonus.

This series is about telling the two apart and doing it properly. First we work out when your own model makes sense at all. Then we learn to calculate which GPU a model needs, look at which models and engines are worth running right now, compare RunPod and Vast.ai, stand up our own endpoint with an OpenAI-compatible API, run image and video generation separately, and finally count the money.

There is little code in the series, only the commands you actually need to run. The substance is in the decisions: what to choose, why, and what it will cost. Prices and versions are as of early November 2026, and new open models come out every week, so the articles carry a feed of related releases.
