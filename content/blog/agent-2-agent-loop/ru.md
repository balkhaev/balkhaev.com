---
title: "Свой агент, часть 2: агентный цикл и инструменты"
description: Даём модели инструменты для работы с файлами и командами и пишем harness, который превращает чат в агента.
date: 2026-11-04
tags: [agents, practice, claude]
---

:::tldr
Агент это чат, в котором модель может попросить вызвать функцию. Мы описываем инструменты JSON-схемой, модель отвечает блоком `tool_use`, мы выполняем функцию и возвращаем `tool_result`. Цикл крутится, пока модель не скажет, что закончила. Около 150 строк, и у нас агент, который читает проект, правит файлы и запускает тесты.
:::

Это вторая часть серии про своего агента. В [первой части](/blog/ru/agent-1-first-call/) мы написали чат в терминале. Теперь научим модель действовать.

## Как модель вызывает функцию

Модель не выполняет код сама. Она только просит: «вызови `read_file` с аргументом `src/main.ts`». Выполняет ваша программа, и только то, что вы разрешили.

Обмен выглядит так. В запросе вы передаёте список инструментов, каждый с названием, описанием и JSON-схемой аргументов:

```json
{
  "name": "read_file",
  "description": "Прочитать текстовый файл целиком.",
  "input_schema": {
    "type": "object",
    "properties": { "path": { "type": "string" } },
    "required": ["path"]
  }
}
```

Если модель решила воспользоваться инструментом, ответ придёт с `stop_reason: "tool_use"`, а в `content` будет блок:

```json
{ "type": "tool_use", "id": "toolu_01A...", "name": "read_file", "input": { "path": "src/main.ts" } }
```

Вы выполняете функцию и отправляете следующий запрос, добавив в историю ответ модели и сообщение пользователя с результатом:

```json
{ "type": "tool_result", "tool_use_id": "toolu_01A...", "content": "import ..." }
```

Модель читает результат и решает, что дальше: вызвать ещё инструмент или ответить. Это и есть агентный цикл. Всё остальное в агентах, от Claude Code до Cursor, надстройки над этой петлёй.

```text
пользователь → модель → tool_use → ваш код → tool_result → модель → … → end_turn
```

## Шаг 1. Инструменты

Дадим агенту четыре инструмента: посмотреть папку, прочитать файл, записать файл и выполнить команду. Последние два опасные, поэтому перед ними агент будет спрашивать разрешения.

Аргументы от модели проверяем через [zod](https://zod.dev): модель почти всегда присылает правильный JSON, но «почти» в коде, который пишет файлы, недостаточно.

```bash
bun add zod
```

```ts
// tools.ts
import Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// Агент работает только внутри этой папки
export const ROOT = path.resolve(process.argv[2] ?? process.cwd());

function safePath(p: string): string {
  const full = path.resolve(ROOT, p);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    throw new Error(`путь ${p} вне рабочей папки`);
  }
  return full;
}

type Tool = {
  definition: Anthropic.Tool;
  schema: z.ZodType;
  dangerous: boolean; // спрашивать ли подтверждение
  run: (input: any) => Promise<string>;
};

export const tools: Record<string, Tool> = {
  list_files: {
    definition: {
      name: "list_files",
      description: "Список файлов и папок по относительному пути.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string", description: "Например, src" } },
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
      description: "Прочитать текстовый файл целиком.",
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
      return text.length > 50_000 ? text.slice(0, 50_000) + "\n…(обрезано)" : text;
    },
  },

  write_file: {
    definition: {
      name: "write_file",
      description: "Создать или перезаписать файл. Перезаписывает целиком.",
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
      return `записано ${content.length} символов в ${p}`;
    },
  },

  run_command: {
    definition: {
      name: "run_command",
      description:
        "Выполнить shell-команду в рабочей папке. Вернёт stdout, stderr и код выхода.",
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

Несколько решений, которые здесь важны.

- **`safePath`** не даёт выйти за рабочую папку. Путь приходит от модели, а значит, это недоверенный ввод: модель могла ошибиться или её мог сбить текст из прочитанного файла.
- **Описания инструментов это промпт.** Модель выбирает инструмент по `description`, поэтому пишите их так, будто объясняете коллеге: что делает, что возвращает, какие ограничения.
- **Вывод обрезается.** Каждый символ результата уходит в историю и оплачивается во всех следующих запросах. `npm install` на 30 тысяч строк легко съест весь бюджет.
- **У команд есть таймаут.** Модель запросто запустит `bun run dev`, который никогда не завершится.

## Шаг 2. Цикл

```ts
// agent.ts
import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";
import { ROOT, tools } from "./tools";

const client = new Anthropic();
const rl = createInterface({ input: process.stdin, output: process.stdout });

const system = `Ты агент-программист. Рабочая папка: ${ROOT}.
Сначала изучи файлы, потом действуй. Проверяй результат командами.
Когда задача решена, коротко опиши, что сделал.`;

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

  if (!tool) return fail(`нет инструмента ${block.name}`);

  const parsed = tool.schema.safeParse(block.input);
  if (!parsed.success) return fail(`неверные аргументы: ${parsed.error.message}`);

  console.log(`\n🔧 ${block.name} ${JSON.stringify(parsed.data).slice(0, 200)}`);

  if (tool.dangerous) {
    const answer = await rl.question("   выполнить? [y/N] ");
    if (answer.trim().toLowerCase() !== "y") {
      return fail("пользователь отклонил вызов");
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
      // Все результаты одним сообщением
      messages.push({ role: "user", content: results });
      continue;
    }

    if (reply.stop_reason === "max_tokens") {
      console.log("\n[ответ упёрся в max_tokens]");
    } else if (reply.stop_reason === "refusal") {
      console.log("\n[модель отказалась продолжать]");
    }
    return;
  }
  console.log(`\n[остановлено после ${MAX_STEPS} шагов]`);
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

Попросите его что-нибудь сделать в небольшом проекте: «найди, где считается итоговая сумма, и добавь тест на пустую корзину». Он сам посмотрит структуру, прочитает нужные файлы, напишет тест, попросит разрешения записать файл и запустить тесты, а если тесты упадут, прочитает ошибку и исправит.

## Разбор

**Цикл крутится по `stop_reason`.** Пока модель отвечает `tool_use`, мы выполняем инструменты и отправляем следующий запрос. Любая другая причина означает, что ход агента закончен и можно снова спрашивать пользователя.

**Ответ модели кладём в историю целиком.** В `content` лежат блоки `tool_use`, и каждый `tool_result` ссылается на свой `tool_use_id`. Если сохранить только текст, API вернёт ошибку.

**Все результаты одним сообщением.** Модель может попросить несколько инструментов за раз, например прочитать три файла. Все результаты отправляем в одном сообщении `user`. Если разбить их на несколько сообщений, модель со временем перестанет вызывать инструменты параллельно.

**Ошибка это тоже результат.** Неверные аргументы, несуществующий файл, отказ пользователя: всё возвращается модели как `tool_result` с `is_error: true`. Не бросайте исключение и не пропускайте вызов. Модель прочитает ошибку и попробует иначе, это одно из главных её умений.

**Отказ пользователя не останавливает агента.** Если вы ответили «n» на `rm -rf`, модель получит «пользователь отклонил вызов» и, скорее всего, спросит, как действовать дальше.

**`MAX_STEPS` защищает кошелёк.** Агент может зациклиться: чинит тест, ломает другой, чинит его, ломает первый. Тридцати шагов хватает на обычные задачи, а дальше лучше спросить человека.

:::warning
`run_command` с подтверждением спасает от случайностей, но не от невнимательности. Не запускайте агента в папке с секретами и не включайте автоподтверждение, пока не запустите его в контейнере. Об изоляции поговорим в шестой части.
:::

## Чем это отличается от Claude Code

По сути ничем: Claude Code, Cursor и прочие агенты для кода устроены так же. Разница в деталях, которые копятся годами: инструмент правки файла по фрагменту вместо перезаписи целиком, поиск по коду, сжатие истории, когда она перестаёт помещаться, субагенты для параллельной работы, хуки и права доступа. Часть этого мы добавим в следующих частях.

Важный вывод другой: агент это не магия внутри модели, а несколько десятков строк вашего кода вокруг неё. Значит, его поведение можно понять, отладить и изменить.

## Что дальше

Сейчас инструменты зашиты в код агента. В третьей части подключим **MCP**: протокол, через который агент получает инструменты от внешних серверов. Подключим готовые серверы для GitHub и файловой системы и напишем свой.
