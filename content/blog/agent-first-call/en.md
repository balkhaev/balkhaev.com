---
title: Talking to a model
description: Take a commercial model API and write a streaming terminal chat with history in 40 lines.
date: 2026-11-04
series: company-agent
part: 2
tags: [agents, practice, claude]
---

:::tldr
Every agent starts as a plain chat. In this part we get an API key, install the SDK and write `chat.ts`: a terminal chat that streams the reply, keeps the history and shows how many tokens each turn cost.
:::

This is part 2 of the series on building a company AI agent. [Part 1](/blog/agent-concept/) covered what we are building and what it is made of. Now we start writing code: no frameworks, TypeScript and [Bun](https://bun.sh), and every step runs.

## What an agent is

Strip the marketing away and an agent has three parts:

- a **model** that reads text and decides what to do next;
- **tools**, functions in your code that the model can ask you to call: read a file, run a command, hit an API;
- a **loop (the harness)** that sends the model the history, runs the tools it asks for, sends back the results and repeats until the task is done.

The model is the most expensive part and the easiest to swap. Everything interesting happens in the loop, and we will write it ourselves. First, though, we need to simply talk to a model.

## Step 1. The key

I will use Claude from Anthropic, but commercial APIs all look alike, and porting the code to another provider is not hard.

1. Sign up in the [Anthropic console](https://platform.claude.com) and add credit. You pay per token; the experiments in this series cost a few dollars.
2. Create a key under API Keys.
3. Put it in an environment variable:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

:::warning
Do not commit the key or paste it into code. The SDK reads `ANTHROPIC_API_KEY` from the environment on its own.
:::

## Step 2. The project

```bash
mkdir my-agent && cd my-agent
bun init -y
bun add @anthropic-ai/sdk
```

## Step 3. The first request

```ts
// hello.ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const reply = await client.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 16000,
  messages: [{ role: "user", content: "Explain what an agent is in one sentence." }],
});

for (const block of reply.content) {
  if (block.type === "text") console.log(block.text);
}
console.log(reply.stop_reason, reply.usage);
```

```bash
bun hello.ts
```

Three things in the reply matter.

- **`content` is an array of blocks**, not a string. Besides `text` it can hold reasoning (`thinking`) and tool calls (`tool_use`). The next part builds the whole agent on the latter.
- **`stop_reason`** says why the model stopped: `end_turn` (finished), `max_tokens` (hit the limit), `tool_use` (wants a tool), `refusal` (declined to answer).
- **`usage`** counts input and output tokens. That is what you pay for: Opus 5.5 costs 4 dollars per million input tokens and 20 per million output tokens.

## Step 4. History

The API does not store the conversation. Every request sends the whole history, and the model's "memory" is just the `messages` array you grow yourself:

```ts
const messages: Anthropic.MessageParam[] = [
  { role: "user", content: "My name is Mikhail." },
  { role: "assistant", content: "Hi, Mikhail!" },
  { role: "user", content: "What is my name?" },
];
```

Two consequences will matter later. Each request costs more than the last, because the history keeps growing. And you fully control what the model "remembers": you can cut, compress or replace anything. The part on context and money is about exactly that.

## Step 5. A streaming chat

A reply can take tens of seconds to generate. Rather than stare at an empty screen, we stream: text prints as it is generated, and `finalMessage()` returns the complete reply at the end.

The whole `chat.ts` is about 40 lines: a loop reads a line from the terminal, appends it to `messages` and sends the request. This is the part that matters:

```ts
const stream = client.messages.stream({
  model: "claude-opus-5-5",
  max_tokens: 16000,
  output_config: { effort: "low" },
  system,
  messages,
});
stream.on("text", (delta) => process.stdout.write(delta));
const reply = await stream.finalMessage();

// store the whole content in history, not just the text
messages.push({ role: "assistant", content: reply.content });
```

The rest is plumbing: quit on `/exit`, drop the last question from history when `stop_reason` is `"refusal"`, and print `reply.usage` after each answer.

```bash
bun chat.ts
```

Chat with it for a couple of minutes and watch the token counter: input grows with every message, because the whole history goes out with each request.

## Walkthrough

**`system`** sets the role and the rules. It is not a user message: the model treats it as the developer's instructions. In the agent this is where the working folder and the rules of conduct go.

**`effort`** controls how hard the model thinks before answering. `low` is enough for chat; for an agent that edits code we will use `medium` or `high`. Higher is slower and costs more, but is more accurate on hard tasks.

**The whole `reply.content` goes into history.** It is tempting to keep only the text, but `content` also carries other blocks, such as the model's reasoning, and the API expects them back unchanged. In the agent this becomes essential: `content` will hold tool calls, and without them the next request fails.

**`max_tokens`** is a ceiling, not a target. The model does not try to fill it. Set it too low and the reply stops mid-sentence with `stop_reason: "max_tokens"`.

:::note
Want to spend less while experimenting? Switch the model to `claude-haiku-5-5`: it is dozens of times cheaper and fine for chat. For an agent that solves multi-step tasks on its own, stay with Opus.
:::

## Next

We have a model that can only talk. In [the next part](/blog/agent-loop/) we give it hands: tools to read files and run commands, and a loop that turns the chat into an agent.
