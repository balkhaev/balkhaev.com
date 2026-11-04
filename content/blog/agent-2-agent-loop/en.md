---
title: "Build your own agent, part 2: the agent loop and tools"
description: Give the model tools for files and shell commands, and write the harness that turns a chat into an agent.
date: 2026-11-04
tags: [agents, practice, claude]
---

:::tldr
An agent is a chat where the model can ask you to call a function. We describe tools with a JSON schema, the model replies with a `tool_use` block, we run the function and send back a `tool_result`. The loop runs until the model says it is done. About 150 lines get us an agent that reads a project, edits files and runs the tests.
:::

This is part 2 of the build-your-own-agent series. In [part 1](/blog/agent-1-first-call/) we wrote a terminal chat. Now we teach the model to act.

## How a model calls a function

The model never runs code itself. It only asks: "call `read_file` with `src/main.ts`". Your program does the work, and only the work you allowed.

The exchange looks like this. The request carries a list of tools, each with a name, a description and a JSON schema for its arguments:

```json
{
  "name": "read_file",
  "description": "Read a whole text file.",
  "input_schema": {
    "type": "object",
    "properties": { "path": { "type": "string" } },
    "required": ["path"]
  }
}
```

If the model decides to use a tool, the reply comes back with `stop_reason: "tool_use"` and a block like this in `content`:

```json
{ "type": "tool_use", "id": "toolu_01A...", "name": "read_file", "input": { "path": "src/main.ts" } }
```

You run the function and send the next request, appending the model's reply and a user message with the result:

```json
{ "type": "tool_result", "tool_use_id": "toolu_01A...", "content": "import ..." }
```

The model reads the result and decides what comes next: another tool or an answer. That is the agent loop. Every coding agent, from Claude Code to Cursor, is built on top of it.

```text
user → model → tool_use → your code → tool_result → model → … → end_turn
```

## Step 1. Tools

The agent gets four tools: list a folder, read a file, write a file and run a command. The last two are dangerous, so the agent asks before using them.

We check the model's arguments with [zod](https://zod.dev). The model almost always sends valid JSON, but "almost" is not enough for code that writes files.

```bash
bun add zod
```

```ts
// tools.ts
import Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// The agent only works inside this folder
export const ROOT = path.resolve(process.argv[2] ?? process.cwd());

function safePath(p: string): string {
  const full = path.resolve(ROOT, p);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    throw new Error(`path ${p} is outside the working folder`);
  }
  return full;
}

type Tool = {
  definition: Anthropic.Tool;
  schema: z.ZodType;
  dangerous: boolean; // ask for confirmation first
  run: (input: any) => Promise<string>;
};

export const tools: Record<string, Tool> = {
  list_files: {
    definition: {
      name: "list_files",
      description: "List files and folders at a relative path.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string", description: "For example, src" } },
        required: ["path"],
      },
    },
    schema: z.object({ path: z.string() }),
    dangerous: false,
    async run({ path: p }) {
      const entries = await readdir(safePath(p), { withFileTypes: true });
      return entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join("\n");
    },
  },

  read_file: {
    definition: {
      name: "read_file",
      description: "Read a whole text file.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    schema: z.object({ path: z.string() }),
    dangerous: false,
    async run({ path: p }) {
      const text = await readFile(safePath(p), "utf8");
      return text.length > 50_000 ? text.slice(0, 50_000) + "\n…(truncated)" : text;
    },
  },

  write_file: {
    definition: {
      name: "write_file",
      description: "Create or overwrite a file. Replaces the whole file.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
    schema: z.object({ path: z.string(), content: z.string() }),
    dangerous: true,
    async run({ path: p, content }) {
      await writeFile(safePath(p), content);
      return `wrote ${content.length} characters to ${p}`;
    },
  },

  run_command: {
    definition: {
      name: "run_command",
      description:
        "Run a shell command in the working folder. Returns stdout, stderr and the exit code.",
      input_schema: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
    schema: z.object({ command: z.string() }),
    dangerous: true,
    async run({ command }) {
      const proc = Bun.spawn(["bash", "-c", command], {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      const timer = setTimeout(() => proc.kill(), 60_000);
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      clearTimeout(timer);
      return `exit ${code}\n--- stdout\n${stdout.slice(-20_000)}\n--- stderr\n${stderr.slice(-5_000)}`;
    },
  },
};
```

A few choices here matter.

- **`safePath`** keeps the agent inside the working folder. The path comes from the model, so it is untrusted input: the model may be wrong, or text in a file it read may have misled it.
- **Tool descriptions are prompts.** The model picks a tool by its `description`, so write them as you would for a colleague: what it does, what it returns, what its limits are.
- **Output is truncated.** Every character of a result stays in the history and is paid for on every later request. A 30,000-line `npm install` log can eat the whole budget.
- **Commands time out.** The model will happily start `bun run dev`, which never exits.

## Step 2. The loop

```ts
// agent.ts
import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";
import { ROOT, tools } from "./tools";

const client = new Anthropic();
const rl = createInterface({ input: process.stdin, output: process.stdout });

const system = `You are a coding agent. Working folder: ${ROOT}.
Look at the files before acting. Check your work by running commands.
When the task is done, briefly describe what you did.`;

const messages: Anthropic.MessageParam[] = [];
const MAX_STEPS = 30;

async function runTool(block: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
  const tool = tools[block.name];
  const fail = (text: string): Anthropic.ToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    content: text,
    is_error: true,
  });

  if (!tool) return fail(`no tool named ${block.name}`);

  const parsed = tool.schema.safeParse(block.input);
  if (!parsed.success) return fail(`invalid arguments: ${parsed.error.message}`);

  console.log(`\n🔧 ${block.name} ${JSON.stringify(parsed.data).slice(0, 200)}`);

  if (tool.dangerous) {
    const answer = await rl.question("   run it? [y/N] ");
    if (answer.trim().toLowerCase() !== "y") {
      return fail("the user declined this call");
    }
  }

  try {
    const output = await tool.run(parsed.data);
    return { type: "tool_result", tool_use_id: block.id, content: output };
  } catch (err) {
    return fail(String(err));
  }
}

async function agentTurn() {
  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = client.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      output_config: { effort: "medium" },
      system,
      tools: Object.values(tools).map((t) => t.definition),
      messages,
    });
    stream.on("text", (delta) => process.stdout.write(delta));
    const reply = await stream.finalMessage();

    messages.push({ role: "assistant", content: reply.content });

    if (reply.stop_reason === "tool_use") {
      const calls = reply.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) results.push(await runTool(call));
      // All results go in one message
      messages.push({ role: "user", content: results });
      continue;
    }

    if (reply.stop_reason === "max_tokens") {
      console.log("\n[the reply hit max_tokens]");
    } else if (reply.stop_reason === "refusal") {
      console.log("\n[the model declined to continue]");
    }
    return;
  }
  console.log(`\n[stopped after ${MAX_STEPS} steps]`);
}

while (true) {
  const input = (await rl.question("\n> ")).trim();
  if (!input || input === "/exit") break;
  messages.push({ role: "user", content: input });
  await agentTurn();
}

rl.close();
```

```bash
bun agent.ts ~/code/some-project
```

Give it a task in a small project: "find where the order total is computed and add a test for an empty cart". It looks at the structure, reads the files it needs, writes a test, asks permission to save the file and run the tests, and if they fail it reads the error and fixes it.

## Walkthrough

**The loop runs on `stop_reason`.** While the model answers `tool_use`, we run the tools and send the next request. Any other reason means the agent's turn is over and we can ask the user again.

**The model's whole reply goes into history.** `content` holds the `tool_use` blocks, and each `tool_result` refers to its `tool_use_id`. Keep only the text and the API rejects the next request.

**All results go in one message.** The model can ask for several tools at once, say three files to read. Send every result in a single `user` message. Split them across messages and the model gradually stops calling tools in parallel.

**An error is a result too.** Bad arguments, a missing file, a refusal from the user: all of it goes back to the model as a `tool_result` with `is_error: true`. Do not throw, and do not skip the call. The model reads the error and tries another way, which is one of the things it is best at.

**A refusal does not stop the agent.** Answer "n" to `rm -rf` and the model gets "the user declined this call", and will most likely ask how you want to proceed.

**`MAX_STEPS` protects your wallet.** An agent can loop: fix one test, break another, fix that, break the first. Thirty steps cover ordinary tasks; beyond that, ask a human.

:::warning
Confirming `run_command` protects against accidents, not inattention. Do not run the agent in a folder with secrets, and do not turn on auto-approve until it runs in a container. Isolation is covered in part 6.
:::

## How this differs from Claude Code

In essence it does not: Claude Code, Cursor and the other coding agents work the same way. The difference is in details that pile up over years: editing a file by fragment instead of rewriting it, code search, compacting history when it no longer fits, subagents for parallel work, hooks and permissions. We will add some of that in later parts.

The bigger takeaway is this: an agent is not magic inside the model, it is a few dozen lines of your code around it. That means you can understand, debug and change how it behaves.

## Next

The tools are hard-coded in the agent for now. In part 3 we connect **MCP**, the protocol that lets an agent get tools from external servers. We will plug in ready-made servers for GitHub and the file system and write our own.
