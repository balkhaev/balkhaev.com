---
title: "What to run now: models and engines"
description: Which open models are worth running on a rented GPU in late 2026, how to choose for a task and budget, test before renting, and which engine to serve them with.
date: 2026-05-21
updated: 2026-11-04
series: inference
part: 3
tags: [inference, open-source, llm]
---

:::tldr
For a single GPU the best candidates right now are Qwen3.8-27B and Gemma 4 31B as dense general-purpose models, Qwen3.6-35B-A3B and Gemma 4 26B-A4B as fast MoE models for bulk work, and gpt-oss-120b if you need more knowledge on one 80 GB card. The strongest open models (Kimi K3, DeepSeek V4 Pro, GLM-5.3) need eight-GPU servers and are cheaper from a provider. Choose a model on your own examples through a per-token provider before renting a GPU. Serve it with vLLM almost always; for agents with a long shared context, look at SGLang.
:::

## How the open-model market works

So many open models come out that any list goes stale within a month. So first, how to find your way around, and then specific models as of early November 2026.

The main families come from a handful of companies, each with a line-up from small models to huge ones:

- **Qwen** (Alibaba): the widest range, from 0.8B to hundreds of billions, nearly all under Apache 2.0. Good with languages other than English.
- **DeepSeek**: huge MoE models under the MIT licence, strong at reasoning and code.
- **GLM** (Z.ai): strong models for code and agents; the flagship has its own licence, the lighter versions are MIT.
- **Kimi** (Moonshot AI): the largest open models, trillions of parameters.
- **Gemma** (Google): small and mid-sized models under Apache 2.0, good for a single GPU.
- **gpt-oss** (OpenAI): two MoE models under Apache 2.0, shipped directly in the compressed MXFP4 format.
- **Mistral**, **Llama** (Meta), **Nemotron** (NVIDIA), **MiniMax**, **Hunyuan** (Tencent) and others.

The news feed below is a handy way to follow fresh releases: it picks stories about open weights and inference.

::news{topic="open-models"}

## Licence first

"Open" means different things. Before building a product on a model, open its licence.

| Licence | Models | What matters |
|---|---|---|
| Apache 2.0, MIT | Qwen, Gemma 4, gpt-oss, DeepSeek, GLM-5.3-Flash | commercial use without special conditions |
| Custom licence with restrictions | Llama 4, GLM-5.3, Kimi K3, Mistral Large 4, Muse Spark Open | limits by company size or revenue, or a required attribution in the interface |
| Non-commercial | some image and video models | not suitable for a product without a separate agreement |

For your own product it is simplest to stick to Apache 2.0 and MIT; there are models of every size among them.

## What to run on different budgets

Below are models grouped by how much memory they need. Weight sizes are given in the format that is most convenient to run. How to count memory and choose a GPU is covered in [part two](/blog/inference-gpu/).

### One consumer GPU, 24 to 32 GB

| Model | Parameters | Strengths |
|---|---|---|
| Qwen3.6-35B-A3B | 35B, 3B active | very fast, good for labelling, data extraction and simple agents; fits 24 GB at 4 bits |
| Gemma 4 26B-A4B | 25B, about 4B active | same purpose, good with images; in FP8 it fits an RTX 5090 |
| gpt-oss-20b | 21B, 3.6B active | runs in 16 GB, can reason and call tools |
| Qwen3.8-27B at 4 bits | 27B | the best quality for this memory, but you will have to limit context |

### One server GPU, 80 to 141 GB

| Model | Parameters | Strengths |
|---|---|---|
| Qwen3.8-27B | 27B, dense | a strong general-purpose model; in FP8 it takes 27 GB and leaves plenty of memory for cache and parallel requests |
| Gemma 4 31B | 31B, dense | general-purpose, understands images, context up to 256 thousand tokens |
| gpt-oss-120b | 117B, 5.1B active | more knowledge at high speed; in MXFP4 it fits in 80 GB |
| Qwen3.6-35B-A3B in FP8 | 35B, 3B active | maximum throughput on bulk tasks |

This is the main segment for your own inference. One H100, H200 or RTX PRO 6000 with such a model covers most working tasks, and the hourly price still lets you keep it busy.

### A multi-GPU server, 300 to 600 GB

| Model | Parameters | What you need |
|---|---|---|
| GLM-5.3-Flash | 320B, 18B active | about 330 GB in FP8: 4 × H200 or 8 × H100 |
| Qwen3.5-397B-A17B | 397B, 17B active | about 400 GB in FP8: 4 × H200 |
| DeepSeek V4.1 Flash | 552B, up to 16B active | about 510 GB: 8 × H200 |

That is already 20 to 45 dollars an hour. It only makes sense with heavy steady load or for the duration of a batch job.

### Flagships, a terabyte and up

Kimi K3, DeepSeek V4 Pro, GLM-5.3, Mistral Large 4 and similar models weigh a terabyte or more and need large clusters. Use per-token providers for them: they keep such clusters busy and you only pay for your own requests.

## What to use for which task

**Bulk labelling and data extraction.** Classify tickets, pull fields out of documents, assign tags. You need speed and a strict answer format; depth of reasoning is secondary. Take small MoE models: Qwen3.6-35B-A3B or Gemma 4 26B-A4B. The engine will force the model to answer according to a JSON schema; more on that below.

**Knowledge-base answers and chat.** You need good text understanding, your users' language and long context. Take Qwen3.8-27B or Gemma 4 31B.

**Agents with tools.** The model has to call functions reliably and not get lost in long chains. On one GPU try Qwen3.8-27B and gpt-oss-120b; on a multi-GPU server, GLM-5.3-Flash.

**Search: embeddings and rerankers.** The most underrated case for your own inference. Embedding models are small (0.6B to 8B), but every company document and every query has to go through them. The Qwen3-Embedding and BGE families run on the cheapest GPU, and vLLM serves embeddings through the same OpenAI-compatible API. If you built document search from the [agent series](/blog/agent-search/), this is the first thing worth moving to your own GPU.

**Images, video and 3D.** This is a separate world with its own models and tools; [part six](/blog/inference-media/) is devoted to it.

## Test the model before renting a GPU

The most common mistake is to rent a GPU, spend half a day standing up a model, and only then discover it handles your task poorly. Do it the other way round.

1. Collect 50 to 100 real examples of your task with correct answers. Support tickets with the right category, documents with correctly extracted fields.
2. Run them through several candidate models at a per-token provider. On OpenRouter almost every open model is available through one key and one API, and such a run costs pennies.
3. Count the share of correct answers and look at the errors yourself.
4. Take the smallest model that copes. Every step down in size means a cheaper GPU or more requests on the same one.

Only then rent a GPU for the chosen model. While you are at it, compare its answers at the provider and on your own setup: if you run a more compressed version yourself, quality may differ slightly.

## Engines

A model by itself is just files of weights. To answer requests it needs an inference engine: it loads the weights onto the GPU, batches requests, manages the cache and serves an API.

| Engine | When to use it |
|---|---|
| [vLLM](https://docs.vllm.ai) | the default: supports almost every model and GPU, OpenAI-compatible API, good speed out of the box |
| [SGLang](https://docs.sglang.ai) | agents and multi-step dialogues with a long shared request prefix: it reuses the cache better |
| llama.cpp, Ollama | local use, Mac, CPU, GGUF, a single user; not for server load |
| TensorRT-LLM | maximum speed on NVIDIA at the cost of complex setup; worth it at large scale |

vLLM and SGLang have converged a lot over the last year: both do continuous batching, prefix caching, speculative decoding, structured output and multi-GPU serving, and both have an OpenAI-compatible API. As of early November 2026 the current versions are vLLM 0.33 and SGLang 0.5.23. The speed difference on typical tasks is usually within tens of percent and depends on the model, so if every cent matters, measure both on your own load. If not, take vLLM: it has more documentation, more ready-made images and day-one support for new models.

Hugging Face's Text Generation Inference, which used to be a common recommendation, has been put into maintenance mode. New projects don't use it.

A few engine features worth knowing in advance:

- **Structured output.** The engine can constrain generation to a JSON schema, and the model physically cannot answer with invalid JSON. For labelling and data extraction this matters more than model size.
- **Prefix caching.** If requests start the same way (a shared system prompt, the same knowledge base), the engine doesn't recompute that start. This speeds up answers and saves the GPU, much like prompt caching in commercial APIs.
- **Speculative decoding.** A small draft model guesses several tokens ahead and the big model checks them in one go. It speeds up generation for a single user by one and a half to two times, especially on code and boilerplate text.
- **LoRA adapters.** One running instance of a model can serve several fine-tuned adapters, picking the right one by the model name in the request.

## What's next

The model is chosen, and so is the engine. In the [next part](/blog/inference-clouds/) we go and get a GPU: we compare RunPod and Vast.ai and look at rental types, persistent disks and how not to pay for idle time.
