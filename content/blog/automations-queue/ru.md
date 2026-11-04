---
title: "Сердце системы: события, очередь и повторы"
description: Проверяем подписи вебхуков, отсекаем повторные события, пишем очередь задач на Postgres, воркер с повторами и расписание. Ядро, на котором будут работать все автоматизации.
date: 2026-11-04
series: automations
part: 3
tags: [automation, postgres, webhooks, reliability]
---

:::tldr
Приёмник проверяет подпись, сохраняет событие и в той же транзакции кладёт задачи в очередь. Отдельный воркер забирает задачи через `FOR UPDATE SKIP LOCKED`, при сбое повторяет их с растущей паузой, а после последней попытки присылает тревогу в Telegram. Расписание кладёт задачи в ту же очередь с ключом идемпотентности, поэтому каждая запускается ровно один раз. Всё это 300 строк без внешних зависимостей.
:::

Это третья часть цикла про коммерческие автоматизации. В [прошлой части](/blog/ru/automations-foundation/) мы подняли сервер, базу и деплой, и сервис научился складывать входящие события в таблицу. Теперь научим его эти события надёжно обрабатывать. Эта часть самая «инфраструктурная» в цикле, зато после неё каждая новая автоматизация будет занимать десятки строк: источник событий и обработчик.

## Что может пойти не так

Прежде чем писать код, перечислим, от чего защищаемся. Всё это случается в первый же месяц работы любой автоматизации.

- **Чужие запросы.** Адрес вебхука несложно узнать, и кто угодно может прислать поддельную «оплату».
- **Повторная доставка.** Платёжки и Telegram доставляют событие «как минимум один раз»: если наш ответ потерялся по дороге, они пришлют то же событие снова.
- **Внешний сервис недоступен.** CRM лежит, Telegram ответил 502, API модели перегружен. Через минуту всё работает.
- **Воркер упал посреди задачи.** Деплой, нехватка памяти, перезагрузка сервера.
- **Ошибка в нашем коде.** Задача падает при каждой попытке, пока мы не исправим код.
- **Никто не заметил.** Самое опасное: автоматизация молча не работает неделю.

## Как всё устроено

```mermaid
flowchart TD
  subgraph tx [Одна транзакция]
    ev["events: сохранить<br/>(повтор — ничего не делать)"]
    jobs["jobs: положить задачи"]
    ev --> jobs
  end
  subgraph worker [Воркер, отдельный контейнер]
    claim["claim: взять задачу"]
    handler["handler: выполнить"]
    done[done]
    pending["pending, повтор позже"]
    failed["failed + тревога"]
    claim --> handler
    handler -- ok --> done
    handler -- сбой --> pending
    pending -.-> claim
    handler -- попытки кончились --> failed
  end
  hook["POST /hooks/:source"]
  sig["Проверить подпись"]
  e401[401]
  ok202[202]
  hook --> sig
  sig -- нет --> e401
  sig -- да --> ev
  jobs --> ok202
  jobs -. забирает .-> claim
```

Главная мысль: HTTP-обработчик ничего не делает, кроме записи в базу. Он быстрый и почти никогда не падает, поэтому отправитель всегда получает ответ, а вся медленная и ненадёжная работа уходит в воркер, где её можно повторить.

## Шаг 1. Таблица задач

Вторая миграция добавляет к событиям ключ для отсечения повторов и создаёт очередь.

```sql
-- migrations/002_jobs.sql
alter table events add column dedup_key text;
create unique index events_source_dedup on events (source, dedup_key);

create table jobs (
  id bigint generated always as identity primary key,
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 8,
  run_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  key text unique,
  event_id bigint references events (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index jobs_due on jobs (run_at) where status in ('pending', 'running');
```

Поля, на которых держится вся надёжность:

- `status`: `pending` ждёт, `running` выполняется, `done` готово, `failed` упало окончательно;
- `run_at`: не раньше какого момента выполнять. Через него работают и отложенные задачи («напомнить через 15 минут»), и паузы между повторами;
- `locked_until`: до какого момента задача считается занятой. Если воркер умер, после этого времени задачу возьмёт другой;
- `key`: ключ идемпотентности. Вторая задача с тем же ключом не создастся;
- `event_id`: из какого события выросла задача. Это ответ на вопрос «почему это произошло».

У `events` уникальный индекс по `(source, dedup_key)`. В Postgres значения `NULL` в уникальном индексе считаются разными, поэтому события без ключа сохраняются все, а с ключом только по одному.

## Шаг 2. Очередь

```ts
// src/queue.ts
import type { SQL } from "bun";
import { sql } from "./db";

export interface NewJob {
  kind: string;
  payload?: unknown;
  /** Ключ идемпотентности: вторая задача с тем же ключом не создаётся. */
  key?: string;
  runAt?: Date;
  eventId?: number;
  maxAttempts?: number;
}

export interface Job {
  id: number;
  kind: string;
  payload: any;
  attempts: number;
  max_attempts: number;
}

/** Добавляет задачу. С `tx` задача попадает в ту же транзакцию, что и остальные записи. */
export async function enqueue(job: NewJob, tx: SQL = sql) {
  await tx`
    insert into jobs (kind, payload, key, run_at, event_id, max_attempts)
    values (
      ${job.kind},
      ${job.payload ?? {}},
      ${job.key ?? null},
      ${job.runAt ?? new Date()},
      ${job.eventId ?? null},
      ${job.maxAttempts ?? 8}
    )
    on conflict (key) do nothing
  `;
}

const LOCK = "5 minutes";

/**
 * Берёт одну готовую задачу и помечает её выполняемой. Задачи, которые
 * упавший воркер оставил в "running", возвращаются, когда истекла блокировка.
 * SKIP LOCKED позволяет нескольким воркерам брать задачи одновременно
 * и никогда не брать одну и ту же.
 */
export async function claim(): Promise<Job | undefined> {
  const [job] = await sql`
    update jobs
    set status = 'running',
        attempts = attempts + 1,
        locked_until = now() + ${LOCK}::interval
    where id = (
      select id from jobs
      where (status = 'pending' and run_at <= now())
         or (status = 'running' and locked_until < now())
      order by run_at
      for update skip locked
      limit 1
    )
    returning id, kind, payload, attempts, max_attempts
  `;
  return job;
}

export async function complete(job: Job) {
  await sql`
    update jobs set status = 'done', finished_at = now(), last_error = null
    where id = ${job.id}
  `;
}

/** Пауза перед следующей попыткой: 10 с, 20 с, 40 с... не больше часа, со случайным разбросом. */
export function backoff(attempts: number): number {
  const base = Math.min(10_000 * 2 ** (attempts - 1), 3_600_000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** Записывает ошибку. Возвращает true, если задача упала окончательно. */
export async function fail(job: Job, error: string, permanent: boolean) {
  const final = permanent || job.attempts >= job.max_attempts;
  if (final) {
    await sql`
      update jobs set status = 'failed', finished_at = now(), last_error = ${error}
      where id = ${job.id}
    `;
  } else {
    const runAt = new Date(Date.now() + backoff(job.attempts));
    await sql`
      update jobs set status = 'pending', run_at = ${runAt}, last_error = ${error}
      where id = ${job.id}
    `;
  }
  return final;
}
```

Самое интересное здесь в `claim`. Подзапрос выбирает одну готовую задачу и блокирует строку, а `SKIP LOCKED` говорит: если строку уже заблокировал другой воркер, не жди его, бери следующую. Поэтому можно запустить хоть десять воркеров, и они никогда не возьмут одну задачу дважды. Внешний `update` сразу помечает задачу как занятую и увеличивает счётчик попыток.

Условие `status = 'running' and locked_until < now()` подбирает задачи, которые застряли: воркер взял задачу и умер. Пять минут блокировки должно хватать на любую задачу с запасом; если у вас бывают задачи дольше, увеличьте `LOCK`.

Паузы между попытками растут вдвое: 10 секунд, 20, 40 и так до часа. Случайный разброс в 20% нужен, чтобы сто задач, упавших одновременно из-за сбоя CRM, не пришли к ней снова тоже одновременно. Восемь попыток по умолчанию растягиваются примерно на 40 минут, и большинство временных сбоев за это время проходит.

## Шаг 3. Какие ошибки повторять

Повторять имеет смысл не всё. Если CRM ответила 503, через минуту может получиться. Если она ответила 400 «неверный телефон», не получится никогда, и восемь попыток только отложат тревогу на 40 минут.

```ts
// src/errors.ts
/** Ошибка, которую повтор не исправит: неверные данные, отклонённый запрос. */
export class PermanentError extends Error {}

/** Бросает PermanentError на ответы 4xx и обычную ошибку на остальные. */
export async function check(response: Response, what: string) {
  if (response.ok) {
    return;
  }
  const text = await response.text();
  const message = `${what}: ${response.status} ${text.slice(0, 500)}`;
  // 429 значит "слишком много запросов": повторить позже стоит
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    throw new PermanentError(message);
  }
  throw new Error(message);
}
```

Функция `check` пригодится в каждой интеграции: вызвали внешний API, передали ответ в `check`, и ошибка сама стала правильного типа. Исключение для 429: это «слишком много запросов», и повторить позже как раз правильно.

## Шаг 4. Telegram для ответов и тревог

Сначала новые настройки. Все обязательные, поэтому без них сервис не стартует:

```ts
// src/config.ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  // Секреты для проверки входящих вебхуков
  siteSecret: required("SITE_WEBHOOK_SECRET"),
  telegramSecret: required("TELEGRAM_WEBHOOK_SECRET"),
  // Бот для ответов и тревог
  telegramToken: required("TELEGRAM_BOT_TOKEN"),
  telegramApi: process.env.TELEGRAM_API ?? "https://api.telegram.org",
  alertChatId: required("ALERT_CHAT_ID"),
};
```

И небольшой клиент Telegram:

```ts
// src/telegram.ts
import { config } from "./config";
import { check } from "./errors";

export async function sendMessage(chatId: number | string, text: string) {
  const response = await fetch(
    `${config.telegramApi}/bot${config.telegramToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    }
  );
  await check(response, "telegram sendMessage");
}

/** Сообщение в чат тревог. Никогда не бросает: тревога не должна ломать вызывающий код. */
export async function alert(text: string) {
  try {
    await sendMessage(config.alertChatId, text);
  } catch (error) {
    console.error("alert failed", error, text);
  }
}
```

У каждого внешнего запроса таймаут. Без него зависший сервис держит воркер бесконечно, и очередь встаёт. `alert` никогда не бросает исключение: если упала и тревога, пишем в лог, но не ломаем код, который её вызвал.

Адрес API вынесен в настройку `TELEGRAM_API`, чтобы в тестах подставить заглушку.

Бота создаём у [@BotFather](https://t.me/BotFather), он выдаст токен. Чат для тревог это обычная группа, куда добавлен бот; её id проще всего узнать, написав в группу сообщение и открыв `https://api.telegram.org/bot<токен>/getUpdates`.

## Шаг 5. Источники событий

Каждый источник описывает три вещи: как проверить, что запрос настоящий, как узнать id события для отсечения повторов и какие задачи из события получаются.

```ts
// src/sources.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import type { NewJob } from "./queue";

export interface Source {
  /** Проверяет, что запрос действительно от этого источника. */
  verify(headers: Headers, body: string): boolean;
  /** Id события у отправителя: повторно доставленное событие получит тот же ключ. */
  dedupKey(body: string): string | undefined;
  /** Какие задачи порождает событие. */
  route(body: string): NewJob[];
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Заголовок `x-signature: sha256=<hex HMAC тела>`, как у GitHub и многих других. */
export function hmacValid(secret: string, body: string, header: string | null) {
  if (!header) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return safeEqual(expected, header);
}

export const sources: Record<string, Source> = {
  // Серверная часть сайта подписывает каждый запрос общим секретом
  site: {
    verify: (headers, body) =>
      hmacValid(config.siteSecret, body, headers.get("x-signature")),
    dedupKey: (body) => JSON.parse(body).id,
    route: (body) => [{ kind: "site.form", payload: JSON.parse(body) }],
  },

  // Telegram присылает в этом заголовке secret_token из setWebhook
  telegram: {
    verify: (headers) =>
      safeEqual(
        headers.get("x-telegram-bot-api-secret-token") ?? "",
        config.telegramSecret
      ),
    dedupKey: (body) => String(JSON.parse(body).update_id),
    route: (body) => {
      const update = JSON.parse(body);
      if (!update.message?.text) {
        return [];
      }
      return [{ kind: "telegram.message", payload: update.message }];
    },
  },
};
```

Две схемы проверки, которые покрывают почти все сервисы:

**Подпись HMAC.** Отправитель и мы знаем общий секрет. Отправитель считает HMAC-SHA256 от тела запроса и кладёт в заголовок, мы считаем то же самое и сравниваем. Подделать подпись без секрета нельзя, а изменить тело незаметно тоже нельзя. Так работают GitHub, Stripe и многие другие сервисы, отличаются только имя заголовка и формат. Некоторые платёжки подписей не присылают; для них проверка устроена иначе, разберём в части про оплаты. Поэтому тело мы храним как текст: подпись считается от точных байтов, и разобранный и собранный обратно JSON её уже не пройдёт.

**Секрет в заголовке.** Проще и слабее: секрет передаётся как есть. Так работает Telegram: при регистрации вебхука мы передаём `secret_token`, и Telegram присылает его в заголовке `X-Telegram-Bot-Api-Secret-Token` с каждым обновлением.

В обоих случаях сравниваем через `timingSafeEqual`, а не через `===`. Обычное сравнение строк останавливается на первом несовпавшем символе, и по времени ответа можно подбирать секрет посимвольно.

Источник `site` мы подключим к форме в следующей части. Секрет нельзя держать в браузере, поэтому подписывать запрос будет серверная часть сайта или небольшая функция, которая принимает форму.

## Шаг 6. Приёмник

```ts
// src/server.ts
import { config } from "./config";
import { sql } from "./db";
import { enqueue, type NewJob } from "./queue";
import { sources } from "./sources";

const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: 1024 * 1024, // вебхуку хватит мегабайта
  routes: {
    "/health": async () => {
      await sql`select 1`;
      return Response.json({ ok: true });
    },
    "/hooks/:source": {
      POST: async (req) => {
        const name = req.params.source;
        const source = sources[name];
        if (!source) {
          return new Response("Unknown source", { status: 404 });
        }
        const body = await req.text();
        if (!source.verify(req.headers, body)) {
          return new Response("Bad signature", { status: 401 });
        }

        // Ошибка разбора не должна терять событие: сохраняем его без задач
        let dedupKey: string | undefined;
        let jobs: NewJob[] = [];
        try {
          dedupKey = source.dedupKey(body);
          jobs = source.route(body);
        } catch (error) {
          console.error(`cannot route ${name} event`, error);
        }

        const headers = Object.fromEntries(req.headers);
        const result = await sql.begin(async (tx) => {
          const [event] = await tx`
            insert into events (source, headers, body, dedup_key)
            values (${name}, ${headers}, ${body}, ${dedupKey ?? null})
            on conflict (source, dedup_key) do nothing
            returning id
          `;
          if (!event) {
            return { duplicate: true };
          }
          for (const job of jobs) {
            await enqueue({ ...job, eventId: event.id }, tx);
          }
          return { id: event.id, jobs: jobs.length };
        });
        return Response.json(result, { status: 202 });
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

console.log(`listening on :${server.port}`);

process.on("SIGTERM", async () => {
  await server.stop();
  await sql.close();
  process.exit(0);
});
```

Порядок действий:

1. Неизвестный источник получает 404, неверная подпись 401. Ничего не пишем в базу: это мусор.
2. Разбираем событие. Если разобрать не получилось, это наша ошибка, а не отправителя, поэтому событие всё равно сохраняем, просто без задач. Позже, исправив код, его можно переиграть.
3. Событие и задачи пишем в одной транзакции. Не бывает события без задач или задач без события.
4. Если событие с таким ключом уже есть, `on conflict do nothing` ничего не вставит и `returning` вернёт пустой результат. Отвечаем 202, чтобы отправитель перестал присылать повтор, и задачи второй раз не создаём.

Ответ всегда быстрый: пара вставок в базу. Это важно, потому что многие сервисы считают медленный ответ ошибкой и присылают событие снова.

## Шаг 7. Обработчики

Обработчик это функция, которая получает `payload` задачи. Пока их три, в следующих частях здесь появятся настоящие автоматизации.

```ts
// src/handlers.ts
import type { Job } from "./queue";
import { sendMessage } from "./telegram";

type Handler = (payload: any, job: Job) => Promise<void>;

export const handlers: Record<string, Handler> = {
  // Пока просто отмечаем, что форма пришла. В части 4 здесь будет обработка лида.
  "site.form": async (form) => {
    console.log("form received", form.id);
  },

  "telegram.message": async (message) => {
    if (message.text === "/ping") {
      await sendMessage(message.chat.id, "pong");
    }
  },

  // По расписанию: показывает, что расписание и очередь живы
  heartbeat: async () => {
    console.log("heartbeat", new Date().toISOString());
  },
};
```

Главное правило для обработчиков: **повторный запуск не должен навредить**. Воркер может выполнить обработчик, отправить сообщение и упасть до того, как отметил задачу выполненной. Тогда задача выполнится ещё раз. Для отправки «pong» это не страшно, для выдачи доступа или списания денег нужно проверять, не сделано ли это уже. К этому вернёмся в части про оплаты.

## Шаг 8. Расписание

Классический cron на сервере плохо подходит: если в момент запуска сервис лежал, запуск пропадёт, а если воркеров два, задача выполнится дважды. Сделаем расписание через ту же очередь.

```ts
// src/schedule.ts
import { enqueue } from "./queue";

export type Schedule =
  | { kind: string; everyMinutes: number }
  | { kind: string; dailyAt: string }; // "09:00" в часовом поясе сервера

export const schedules: Schedule[] = [{ kind: "heartbeat", everyMinutes: 60 }];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Текущий слот расписания или null, если время ещё не пришло.
 * Слот становится ключом задачи, поэтому каждый слот выполняется один раз,
 * сколько бы воркеров его ни проверяли и как бы часто.
 */
export function slot(schedule: Schedule, now: Date): string | null {
  if ("everyMinutes" in schedule) {
    const ms = schedule.everyMinutes * 60_000;
    return new Date(Math.floor(now.getTime() / ms) * ms).toISOString();
  }
  const [hours, minutes] = schedule.dailyAt.split(":").map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hours * 60 + minutes) {
    return null;
  }
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function enqueueDue(now = new Date()) {
  for (const schedule of schedules) {
    const current = slot(schedule, now);
    if (current) {
      await enqueue({ kind: schedule.kind, key: `${schedule.kind}:${current}` });
    }
  }
}
```

Идея в ключе. Для ежечасной задачи ключ это начало текущего часа, для ежедневной это сегодняшняя дата. Воркер раз в 30 секунд пытается положить задачу с этим ключом, и уникальный индекс пропускает только первую попытку. Отсюда три полезных свойства:

- сколько бы воркеров ни работало, задача на слот одна;
- если воркер лежал в 9:00 и поднялся в 9:40, ежедневная задача всё равно выполнится сегодня;
- в таблице `jobs` видно, когда каждый слот реально выполнился и с какой ошибкой.

Время ежедневных задач считается в часовом поясе процесса. Его задаём переменной `TZ` в compose-файле.

## Шаг 9. Воркер

```ts
// src/worker.ts
import { sql } from "./db";
import { PermanentError } from "./errors";
import { handlers } from "./handlers";
import { claim, complete, fail, type Job } from "./queue";
import { enqueueDue } from "./schedule";
import { alert } from "./telegram";

let running = true;
process.on("SIGTERM", () => {
  running = false;
});

async function run(job: Job) {
  const handler = handlers[job.kind];
  try {
    if (!handler) {
      throw new PermanentError(`no handler for ${job.kind}`);
    }
    await handler(job.payload, job);
    await complete(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await fail(job, message, error instanceof PermanentError);
    console.error(`job ${job.id} ${job.kind} attempt ${job.attempts}: ${message}`);
    if (failed) {
      await alert(`Job ${job.id} (${job.kind}) failed: ${message}`);
    }
  }
}

let lastScheduleCheck = 0;

while (running) {
  if (Date.now() - lastScheduleCheck > 30_000) {
    await enqueueDue();
    lastScheduleCheck = Date.now();
  }
  const job = await claim();
  if (job) {
    await run(job);
  } else {
    await Bun.sleep(1000);
  }
}

await sql.close();
console.log("worker stopped");
```

Цикл простой: раз в 30 секунд проверить расписание, взять задачу, выполнить, если задач нет, подождать секунду. Секунда задержки на пустой очереди незаметна для бизнеса и не нагружает базу. Если когда-нибудь понадобится реакция быстрее, в Postgres для этого есть `LISTEN/NOTIFY`, но для наших задач это лишнее.

На SIGTERM воркер не бросает задачу на середине: флаг `running` останавливает цикл после текущей задачи.

Если упадёт сама база, `claim` бросит исключение, процесс завершится, и Docker перезапустит его благодаря `restart: unless-stopped`. Отдельно обрабатывать такой случай не нужно.

## Шаг 10. Ручное управление

Задачи будут падать, и нужен способ быстро посмотреть упавшие, перезапустить после исправления и переиграть событие.

```ts
// src/cli.ts: bun src/cli.ts failed | retry <job id> | replay <event id>
import { sql } from "./db";
import { enqueue } from "./queue";
import { sources } from "./sources";

const [command, id] = process.argv.slice(2);

if (command === "failed") {
  const rows = await sql`
    select id, kind, attempts, finished_at, last_error from jobs
    where status = 'failed' order by id desc limit 50
  `;
  console.table(rows);
} else if (command === "retry") {
  // Новые попытки для упавшей задачи, например после исправления бага
  await sql`
    update jobs set status = 'pending', attempts = 0, run_at = now(), last_error = null
    where id = ${Number(id)} and status = 'failed'
  `;
  console.log(`job ${id} queued again`);
} else if (command === "replay") {
  // Разобрать сохранённое событие заново: новые задачи без участия отправителя
  const [event] = await sql`select id, source, body from events where id = ${Number(id)}`;
  const jobs = sources[event.source].route(event.body);
  for (const job of jobs) {
    await enqueue({ ...job, eventId: event.id });
  }
  console.log(`event ${id}: ${jobs.length} jobs queued`);
} else {
  console.log("usage: bun src/cli.ts failed | retry <job id> | replay <event id>");
}

await sql.close();
```

На сервере:

```bash
docker compose exec app bun src/cli.ts failed
docker compose exec app bun src/cli.ts retry 42
docker compose exec app bun src/cli.ts replay 1337
```

## Шаг 11. Тесты

Очередь это код, который должен работать всегда, поэтому на неё пишем тесты против настоящего Postgres, а не моков: всё интересное здесь происходит в SQL.

```ts
// test/queue.test.ts: нужен DATABASE_URL на пустую тестовую базу
import { beforeEach, expect, test } from "bun:test";
import { sql } from "../src/db";
import { backoff, claim, complete, enqueue, fail } from "../src/queue";

beforeEach(async () => {
  await sql`truncate jobs restart identity cascade`;
});

test("a job with the same key is enqueued once", async () => {
  await enqueue({ kind: "a", key: "k1" });
  await enqueue({ kind: "a", key: "k1" });
  const [{ count }] = await sql`select count(*)::int as count from jobs`;
  expect(count).toBe(1);
});

test("parallel workers never take the same job", async () => {
  for (let i = 0; i < 20; i++) {
    await enqueue({ kind: "a", payload: { i } });
  }
  const claimed = await Promise.all(Array.from({ length: 30 }, () => claim()));
  const ids = claimed.filter(Boolean).map((job) => job!.id);
  expect(ids.length).toBe(20);
  expect(new Set(ids).size).toBe(20);
});

test("a failed attempt is retried later, then fails for good", async () => {
  await enqueue({ kind: "a", maxAttempts: 2 });
  const first = (await claim())!;
  expect(await fail(first, "boom", false)).toBe(false);
  expect(await claim()).toBeUndefined(); // ждёт паузу перед повтором

  await sql`update jobs set run_at = now()`;
  const second = (await claim())!;
  expect(second.attempts).toBe(2);
  expect(await fail(second, "boom", false)).toBe(true);
  const [job] = await sql`select status, last_error from jobs`;
  expect(job).toEqual({ status: "failed", last_error: "boom" });
});

test("a job stuck in running comes back after its lock expires", async () => {
  await enqueue({ kind: "a" });
  const job = (await claim())!;
  await sql`update jobs set locked_until = now() - interval '1 second'`;
  const again = (await claim())!;
  expect(again.id).toBe(job.id);
  await complete(again);
  expect(await claim()).toBeUndefined();
});

test("backoff grows and is capped at an hour", () => {
  expect(backoff(1)).toBeLessThanOrEqual(12_000);
  expect(backoff(4)).toBeGreaterThanOrEqual(64_000);
  expect(backoff(30)).toBeLessThanOrEqual(3_600_000 * 1.2);
});
```

И быстрые тесты расписания, без базы:

```ts
// test/schedule.test.ts
import { expect, test } from "bun:test";
import { slot } from "../src/schedule";

test("hourly slot is the start of the hour", () => {
  const now = new Date("2026-11-04T10:42:00Z");
  expect(slot({ kind: "x", everyMinutes: 60 }, now)).toBe("2026-11-04T10:00:00.000Z");
});

test("daily slot appears only after the time", () => {
  const schedule = { kind: "digest", dailyAt: "09:00" };
  expect(slot(schedule, new Date(2026, 10, 4, 8, 59))).toBeNull();
  expect(slot(schedule, new Date(2026, 10, 4, 9, 0))).toBe("2026-11-04");
  expect(slot(schedule, new Date(2026, 10, 4, 23, 0))).toBe("2026-11-04");
});
```

В `package.json` добавляем скрипты `"worker": "bun src/worker.ts"` и `"test": "bun test"`, в `tsconfig.json` в `include` папку `test`.

Локально тесты запускаются против отдельной базы:

```bash
docker exec pg createdb -U postgres app_test
DATABASE_URL=postgres://postgres:dev@localhost:5432/app_test bun src/migrate.ts
DATABASE_URL=postgres://postgres:dev@localhost:5432/app_test bun test
```

```text
 7 pass
 0 fail
```

## Шаг 12. Деплой

Воркер запускается из того же образа, что и сервер, только с другой командой. Чтобы не повторять настройки, выносим общее в якорь YAML:

```yaml
# compose.yml
x-app: &app
  image: ghcr.io/your-name/automations:${TAG:-latest}
  restart: unless-stopped
  env_file: .env
  environment:
    DATABASE_URL: postgres://app:${POSTGRES_PASSWORD}@db:5432/app
    TZ: Europe/Moscow
  depends_on:
    db:
      condition: service_healthy

services:
  app:
    <<: *app

  worker:
    <<: *app
    command: ["bun", "src/worker.ts"]
    stop_grace_period: 60s

  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      retries: 10

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  pgdata:
  caddy_data:
  caddy_config:
```

`stop_grace_period: 60s` даёт воркеру минуту, чтобы доделать текущую задачу при деплое. В `deploy.sh` скачиваем оба образа: `docker compose pull app worker`.

В CI добавляем Postgres как сервис и запуск тестов перед сборкой образа. Если тесты упали, деплоя не будет:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run check
      - name: Tests
        env:
          DATABASE_URL: postgres://postgres:test@localhost:5432/postgres
          SITE_WEBHOOK_SECRET: test
          TELEGRAM_WEBHOOK_SECRET: test
          TELEGRAM_BOT_TOKEN: test
          ALERT_CHAT_ID: "0"
        run: |
          bun src/migrate.ts
          bun test
      # дальше сборка образа и деплой, как в прошлой части
```

На сервере дописываем в `.env` новые секреты. Секреты вебхуков генерируем случайно:

```bash
cd /opt/automations
cat >> .env <<EOF
SITE_WEBHOOK_SECRET=$(openssl rand -hex 32)
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
TELEGRAM_BOT_TOKEN=токен-от-botfather
ALERT_CHAT_ID=-100xxxxxxxxxx
EOF
```

После деплоя регистрируем вебхук у Telegram:

```bash
curl https://api.telegram.org/bot<токен>/setWebhook \
  -d url=https://auto.example.com/hooks/telegram \
  -d secret_token=<TELEGRAM_WEBHOOK_SECRET из .env>
```

Пишем боту `/ping` и получаем `pong`. Это значит, что работает вся цепочка: Telegram, Caddy, проверка секрета, событие в базе, задача в очереди, воркер, ответ через API.

## Проверяем сбои

Самое интересное: убедиться, что система переживает то, ради чего мы всё это строили. Вот результат локального прогона с заглушкой Telegram API, которая на первый запрос отвечает 502:

| Что сделали | Что произошло |
|---|---|
| Отправили одно обновление Telegram дважды | первый ответ `{"id":"1","jobs":1}`, второй `{"duplicate":true}`, задача одна |
| Отправили с неверным секретом | 401, в базе ничего |
| Telegram ответил 502 на `sendMessage` | задача вернулась в `pending`, через ~10 секунд вторая попытка прошла, `attempts = 2` |
| Отправили на `site` тело, которое не JSON, но с правильной подписью | событие сохранено, задач 0, ошибка в логе |
| Положили задачу неизвестного типа | `failed` с первой попытки, в чат тревог пришло «Job 4 (nope) failed: no handler for nope» |
| Остановили воркер при деплое | доделал текущую задачу, вышел за доли секунды |

## Что получилось

- Вебхуки проверяются подписью или секретом, повторы отсекаются по id события.
- Событие и задачи сохраняются атомарно, до любой внешней работы.
- Очередь на Postgres без брокера: параллельные воркеры, отложенные задачи, повторы с растущей паузой, возврат застрявших задач.
- Постоянные ошибки не повторяются зря, окончательные падения приходят тревогой в Telegram.
- Расписание через ту же очередь: ровно один запуск на слот, догоняет пропущенное.
- Тесты очереди против настоящей базы в CI, перед каждым деплоем.

Фундамент готов. В [следующей части](/blog/ru/automations-sales/) строим первую настоящую автоматизацию: заявка с сайта за минуту превращается в карточку у менеджера в Telegram, модель вытаскивает из свободного текста, что нужно клиенту, а если заявку никто не взял, бот напомнит.
