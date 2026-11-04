---
title: "MCP: подключаем внутренние системы"
description: Выносим инструменты агента в отдельные MCP-серверы, пишем свой сервер для базы компании и учим агента подключаться к любым серверам из конфига.
date: 2026-11-04
series: company-agent
part: 4
tags: [agents, mcp, practice]
---

:::tldr
MCP это стандартный способ дать агенту инструменты. Каждая система компании получает свой маленький сервер, который описывает инструменты и выполняет их. Агент подключается к серверам из конфига, собирает их инструменты и передаёт модели. В этой части пишем MCP-сервер для базы данных компании (только чтение) и переделываем агента в MCP-клиент. Около 200 строк, всё запускается локально.
:::

В [прошлой части](/blog/ru/agent-loop/) инструменты агента жили прямо в его коде. Для учебного агента это нормально, для корпоративного нет. Систем в компании десятки, у каждой свои доступы, своя команда и свой темп изменений. Если всё это зашить в один сервис, он превратится в монолит, который никто не решится трогать.

## Что такое MCP

[Model Context Protocol](https://modelcontextprotocol.io) это открытый протокол между агентом и источниками инструментов. Его придумали в Anthropic, а теперь поддерживают Claude, ChatGPT, Cursor, VS Code и большинство агентных фреймворков.

Устроено просто:

- **MCP-сервер** знает одну систему: базу данных, вики, трекер задач. Он отдаёт список инструментов с описаниями и JSON-схемами и выполняет их по запросу.
- **MCP-клиент** живёт внутри агента. Он подключается к серверам, забирает списки инструментов, показывает их модели и пересылает вызовы.
- **Транспорт** бывает двух видов: `stdio`, когда клиент запускает сервер как дочерний процесс и общается через stdin/stdout, и HTTP, когда сервер работает отдельно и к нему ходят по сети. Сегодня используем `stdio`, а HTTP понадобится в части про права доступа.

Кроме инструментов сервер может отдавать ресурсы (документы для чтения) и готовые промпты, но для агента главное именно инструменты.

Что это даёт нам:

- **Разделение.** Сервер для базы пишет и поддерживает команда, которая знает базу. Агенту не нужно знать, как устроена каждая система.
- **Готовые серверы.** Для GitHub, Jira, Confluence, Notion, Slack, Postgres, Google Drive уже есть MCP-серверы, официальные или от сообщества.
- **Переиспользование.** Тот же сервер подключается к Claude Desktop, Claude Code или Cursor. Сотрудники могут пользоваться им и без нашего агента.
- **Изоляция.** Пароль от базы знает только процесс MCP-сервера, а не агент и тем более не модель.

## Шаг 1. Демо-база компании

Чтобы всё запускалось без настоящей инфраструктуры, возьмём SQLite, который встроен в Bun. Три таблицы: сотрудники, клиенты и сделки. В реальной компании на этом месте будет Postgres или ClickHouse, код сервера поменяется минимально.

```ts
// seed.ts
import { Database } from "bun:sqlite";

const db = new Database("company.db");
db.exec(`
  DROP TABLE IF EXISTS deals; DROP TABLE IF EXISTS clients; DROP TABLE IF EXISTS employees;
  CREATE TABLE employees (
    id INTEGER PRIMARY KEY, name TEXT, department TEXT, position TEXT, salary INTEGER
  );
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY, name TEXT, region TEXT, industry TEXT
  );
  CREATE TABLE deals (
    id INTEGER PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id),
    owner_id INTEGER REFERENCES employees(id),
    amount INTEGER,           -- в рублях
    stage TEXT,               -- lead | negotiation | won | lost
    closed_at TEXT            -- дата закрытия, YYYY-MM-DD, NULL если открыта
  );
`);

const employees = [
  ["Анна Петрова", "Продажи", "Руководитель отдела", 320000],
  ["Игорь Смирнов", "Продажи", "Менеджер", 180000],
  ["Олег Ким", "Продажи", "Менеджер", 170000],
  ["Мария Орлова", "Разработка", "Тимлид", 380000],
  ["Денис Волков", "Разработка", "Backend-разработчик", 290000],
];
for (const e of employees) {
  db.run("INSERT INTO employees (name, department, position, salary) VALUES (?, ?, ?, ?)", e);
}

const clients = [
  ["Северсталь-Сервис", "Северо-Запад", "Промышленность"],
  ["Вкусно и рядом", "Москва", "Ритейл"],
  ["ТрансЛогистик", "Урал", "Логистика"],
  ["МедТех", "Москва", "Медицина"],
  ["Байкал Тур", "Сибирь", "Туризм"],
];
for (const c of clients) {
  db.run("INSERT INTO clients (name, region, industry) VALUES (?, ?, ?)", c);
}

// Детерминированный генератор, чтобы у всех получились одинаковые данные
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const stages = ["lead", "negotiation", "won", "won", "lost"];
for (let i = 0; i < 60; i++) {
  const stage = stages[Math.floor(rand() * stages.length)];
  const month = 7 + Math.floor(rand() * 4); // июль–октябрь
  const day = 1 + Math.floor(rand() * 28);
  const closed =
    stage === "won" || stage === "lost"
      ? `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : null;
  db.run(
    "INSERT INTO deals (client_id, owner_id, amount, stage, closed_at) VALUES (?, ?, ?, ?, ?)",
    [1 + Math.floor(rand() * 5), 1 + Math.floor(rand() * 3), 100_000 * (1 + Math.floor(rand() * 40)), stage, closed],
  );
}
console.log("company.db готова");
```

```bash
bun add @modelcontextprotocol/sdk zod
bun seed.ts
```

## Шаг 2. MCP-сервер для базы

Сервер даёт два инструмента: `describe_schema` возвращает описание таблиц, `query` выполняет один `SELECT`.

```ts
// db-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Database } from "bun:sqlite";
import { z } from "zod";

// Только чтение: даже если модель пришлёт DELETE, база его не выполнит
const db = new Database(process.env.DB_PATH ?? "company.db", { readonly: true });
const MAX_ROWS = 200;

// Описания колонок важнее самих названий: по ним модель понимает данные
const DOCS = `Таблицы базы компании:

employees — сотрудники: id, name, department (отдел), position, salary (оклад в рублях)
clients — клиенты: id, name, region, industry (отрасль)
deals — сделки: id, client_id → clients.id, owner_id → employees.id (менеджер),
  amount (сумма в рублях), stage (lead | negotiation | won | lost),
  closed_at (дата закрытия YYYY-MM-DD, NULL у открытых сделок)

Диалект SQLite. Месяц из даты: strftime('%Y-%m', closed_at).`;

const server = new McpServer({ name: "company-db", version: "1.0.0" });

server.registerTool(
  "describe_schema",
  {
    description: "Описание таблиц и колонок базы компании. Вызывай перед первым запросом.",
    annotations: { readOnlyHint: true },
  },
  async () => ({ content: [{ type: "text", text: DOCS }] }),
);

server.registerTool(
  "query",
  {
    description: `Выполнить один SELECT к базе компании (SQLite, только чтение). Вернёт до ${MAX_ROWS} строк в JSON.`,
    inputSchema: { sql: z.string().describe("Один запрос SELECT или WITH ... SELECT") },
    annotations: { readOnlyHint: true },
  },
  async ({ sql }) => {
    const text = sql.trim().replace(/;$/, "");
    if (!/^(select|with)\b/i.test(text) || text.includes(";")) {
      return {
        isError: true,
        content: [{ type: "text", text: "Разрешён только один запрос SELECT" }],
      };
    }
    try {
      const rows = db.query(text).all();
      const shown = rows.slice(0, MAX_ROWS);
      const note = rows.length > MAX_ROWS ? `\n(показано ${MAX_ROWS} из ${rows.length})` : "";
      return { content: [{ type: "text", text: JSON.stringify(shown) + note }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: String(err) }] };
    }
  },
);

await server.connect(new StdioServerTransport());
```

Почему именно так.

**Описание схемы написано руками.** Можно было бы отдавать модели `CREATE TABLE` из базы, но названия колонок редко объясняют смысл. Что `amount` в рублях, что у открытых сделок `closed_at` пустой, что `stage` принимает четыре значения, модель узнает только из описания. В настоящей базе с сотней таблиц это самая ценная часть сервера, и писать её стоит вместе с людьми, которые знают данные.

**Только чтение на двух уровнях.** Проверка на `SELECT` отсекает очевидные ошибки, но обойти её легко: `WITH x AS (SELECT 1) DELETE FROM deals` начинается с `WITH`. Настоящая защита в том, что база открыта в режиме `readonly`, и такой запрос упадёт с ошибкой `attempt to write a readonly database`. В Postgres то же самое делается отдельной ролью с правами только на `SELECT` и `default_transaction_read_only = on`. Никогда не полагайтесь только на проверку текста запроса.

**Лимит строк.** Модели не нужно сто тысяч строк, ей нужны агрегаты. Лимит защищает контекст и кошелёк, а пометка «показано 200 из 5000» подсказывает модели переписать запрос с `GROUP BY`.

**Ошибки возвращаются, а не бросаются.** `isError: true` вместе с текстом ошибки SQLite позволяет модели прочитать, что не так с запросом, и исправить его. На практике модель часто ошибается в названии колонки с первого раза и чинит запрос со второго.

**`readOnlyHint`.** Аннотация подсказывает клиенту, что инструмент ничего не меняет. Наш агент будет спрашивать подтверждение только у инструментов без этой пометки.

:::warning
В сервере на `stdio` нельзя писать в `console.log`: stdout занят протоколом, и любая лишняя строка сломает обмен. Для отладки пишите в `console.error`.
:::

Проверить сервер без агента можно в MCP Inspector, это веб-интерфейс для ручного вызова инструментов:

```bash
npx @modelcontextprotocol/inspector bun db-server.ts
```

## Шаг 3. Агент как MCP-клиент

Теперь научим агента подключаться к серверам. Список серверов храним в `mcp.json`, в том же формате, что у Claude Desktop и Cursor, поэтому конфиги можно переносить между ними.

```json
{
  "db": { "command": "bun", "args": ["db-server.ts"], "env": { "DB_PATH": "company.db" } }
}
```

Клиент подключается к каждому серверу, забирает список инструментов и превращает их в тот же формат `Tool`, что был у наших локальных инструментов. Тип `Tool` из `tools.ts` прошлой части нужно экспортировать.

```ts
// mcp.ts
import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import type { Tool } from "./tools";

type ServerConfig = { command: string; args?: string[]; env?: Record<string, string> };

// Подключается к каждому серверу из конфига и превращает его инструменты
// в тот же формат, что и наши локальные инструменты из прошлой части
export async function connectMcp(config: Record<string, ServerConfig>) {
  const tools: Record<string, Tool> = {};
  const clients: Client[] = [];

  for (const [serverName, params] of Object.entries(config)) {
    const client = new Client({ name: "company-agent", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ ...params, stderr: "inherit" }));
    clients.push(client);

    const { tools: list } = await client.listTools();
    for (const tool of list) {
      const name = `${serverName}__${tool.name}`; // db__query, wiki__search
      tools[name] = {
        definition: {
          name,
          description: tool.description ?? "",
          input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
        },
        // Аргументы проверяет сам сервер по своей схеме
        schema: z.record(z.string(), z.unknown()),
        // Всё, что сервер не пометил как «только чтение», требует подтверждения
        dangerous: tool.annotations?.readOnlyHint !== true,
        async run(input) {
          const result = await client.callTool({ name: tool.name, arguments: input });
          const text = (result.content as { type: string; text?: string }[])
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
          if (result.isError) throw new Error(text);
          return text;
        },
      };
    }
    console.log(`MCP ${serverName}: ${list.map((t) => t.name).join(", ")}`);
  }

  return { tools, close: () => Promise.all(clients.map((c) => c.close())) };
}
```

Имена инструментов получают префикс сервера: `db__query`, `wiki__search`. Без префикса два сервера с инструментом `search` перепутаются.

В `agent.ts` меняется только начало: вместо локальных инструментов берём инструменты из MCP, а системный промпт теперь про компанию. Функции `runTool` и `agentTurn` остаются как в прошлой части. В конце файла добавьте `await mcp.close()`, чтобы дочерние процессы серверов завершились вместе с агентом.

```ts
// agent.ts, начало
import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";
import { connectMcp } from "./mcp";

const client = new Anthropic();
const mcp = await connectMcp(await Bun.file("mcp.json").json());
const tools = mcp.tools;
const rl = createInterface({ input: process.stdin, output: process.stdout });

const system = `Ты ассистент сотрудников компании. Отвечаешь на вопросы по данным компании,
используя инструменты. Не выдумывай цифры: всё, что называешь, должно прийти из инструментов.
Если данных не хватает, так и скажи. Отвечай кратко, в конце укажи, откуда данные.`;
```

Файловые инструменты из прошлой части корпоративному агенту не нужны. Если понадобятся, их тоже можно подключить как MCP-сервер: есть официальный `@modelcontextprotocol/server-filesystem`, и это одна строка в `mcp.json`.

## Пробуем

```bash
bun agent.ts
```

Задайте вопрос, на который нужно сходить в базу: «какая выручка по выигранным сделкам за октябрь, по регионам?». Модель сначала вызовет `db__describe_schema`, потом напишет запрос с `JOIN` и `GROUP BY`, а если ошибётся в синтаксисе, прочитает ошибку и исправит. Попробуйте и провокацию: «удали все проигранные сделки». Модель, скорее всего, откажется сама, а если и попробует, база вернёт ошибку.

Обратите внимание на вопрос «какая зарплата у Марии Орловой?». Агент спокойно ответит, потому что таблица `employees` доступна целиком. Для демо это нормально, для компании нет: зарплаты видит HR, а не все сотрудники. Это ровно та проблема, которую мы решим в части про права доступа: агент будет ходить в базу от имени конкретного человека.

## Почему SQL, а не готовые функции

Мы дали модели писать произвольный SQL. Альтернатива это узкие инструменты: `get_sales_by_region(month)`, `get_client(name)` и так далее. У обоих подходов есть место.

- **Произвольный SQL** отвечает на вопросы, которые никто не предусмотрел. Цена: модель может написать тяжёлый запрос или неверно понять данные. Нужны реплика или отдельная аналитическая база, таймауты и хорошее описание схемы.
- **Узкие инструменты** предсказуемы, быстры и легко проверяются. Цена: каждый новый вопрос требует нового инструмента.

На практике хорошо работает смесь: узкие инструменты для частых и важных вопросов (метрики, по которым принимают решения, должны считаться одинаково) и SQL для всего остального.

## Что дальше

Агент уже умеет отвечать на вопросы по структурированным данным. Но большая часть знаний компании лежит не в таблицах, а в тексте: вики, регламенты, договоры, протоколы встреч. В [следующей части](/blog/ru/agent-search/) научим агента искать по документам.
