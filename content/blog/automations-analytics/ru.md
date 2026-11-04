---
title: "Заменяем аналитика: утренняя сводка и тревоги"
description: Каждое утро в Telegram приходит сводка за вчера по заявкам, оплатам и поддержке со сравнением с неделей и комментарием Claude, а если что-то подозрительно затихло или застряло, система пишет сама, один раз в начале и один раз в конце.
date: 2026-11-04
series: automations
part: 7
tags: [automation, analytics, alerts, claude, postgres]
---

:::tldr
В 9 утра бот присылает сводку за вчера: заявки, оплаты, поддержка, у каждой цифры среднее за неделю и стрелка, если отличие больше 30%. Все цифры считает SQL, а Claude только дописывает до трёх наблюдений, что стоит заметить. Раз в 15 минут система проверяет, не затихли ли заявки и оплаты, не копится ли очередь в поддержке и не отстаёт ли воркер. О проблеме приходит одно сообщение, когда она началась, и одно, когда закончилась.
:::

Это седьмая часть цикла про коммерческие автоматизации и последняя из серии «Заменяем …». В [прошлой части](/blog/ru/automations-support/) мы собрали поддержку. Теперь в базе лежат заявки, оплаты и обращения, и из них можно каждое утро получать картину бизнеса, никого не прося её собрать.

## Что именно мы заменяем

Аналитик в небольшой компании это обычно сам владелец, который по утрам открывает CRM, личный кабинет платёжки и почту, или сотрудник, который раз в неделю собирает табличку. Сводка устаревает, пока её собирают, а неприятности замечают, когда клиент уже позвонил с жалобой.

| Раньше делал человек | Теперь делает система |
|---|---|
| собрать вчерашние цифры из трёх мест | сводка в Telegram в 9:00 |
| сравнить с обычной неделей | среднее за 7 дней и стрелки ▲ ▼ |
| пролистать заявки и обращения, понять, о чём пишут | до трёх наблюдений от Claude |
| заметить, что форма на сайте сломалась | тревога «нет заявок 10 часов, хотя обычно было бы 20» |
| заметить, что поддержка не успевает | тревога, когда пять обращений ждут больше 4 часов |
| понять, что проблема ушла | сообщение «✅ всё в норме» с длительностью |

## Главное правило: цифры считает SQL

Языковая модель хорошо замечает закономерности в тексте и плохо считает. Если отдать ей сырые заявки и попросить «посчитай, сколько их вчера», она почти всегда ответит правильно, но «почти всегда» для отчёта недостаточно. Поэтому разделение строгое:

- **все числа считает SQL**, и выводит их код, а не модель;
- **модель получает готовые числа** и краткие пересказы заявок и обращений, которые она сама написала в частях про продажи и поддержку, и отвечает только на вопрос «что тут стоит заметить»;
- **модели запрещено считать новые числа**, а её текст идёт отдельным блоком под цифрами;
- **если модель недоступна, сводка всё равно уходит**, просто без комментария.

## Как это устроено

```mermaid
flowchart TD
  sched(["Расписание"])
  digest["<b>digest.daily</b>, 9:00"]
  checks["<b>alerts.check</b>, раз в 15 минут"]
  db[("leads, orders, tickets, jobs")]
  sqlm["<b>metrics.ts</b><br/>вчера и среднее за неделю"]
  claude["<b>Claude</b><br/>до трёх наблюдений"]
  card["Сводка в Telegram"]
  rules["<b>runChecks</b><br/>тишина, очередь, отставание"]
  state[("alerts<br/>что горит сейчас")]
  alertchat["Чат тревог<br/>🚨 началось, ✅ закончилось"]
  sched --> digest
  sched --> checks
  digest --> sqlm
  db --> sqlm
  sqlm -- готовые числа --> claude
  sqlm --> card
  claude -. комментарий, если ответил .-> card
  checks --> rules
  db --> rules
  rules --> state
  state -- только при смене состояния --> alertchat
```

## Шаг 1. Таблица тревог и индексы

```sql
-- migrations/006_alerts.sql
-- Тревоги, которые горят прямо сейчас. Строка появляется, когда проблема
-- началась, и исчезает, когда закончилась: ровно два сообщения на проблему.
create table alerts (
  name text primary key,
  text text not null,
  since timestamptz not null default now()
);

-- Сводка и тревоги каждый день фильтруют по этим колонкам
create index leads_created on leads (created_at);
create index orders_paid on orders (paid_at) where paid_at is not null;
create index tickets_created on tickets (created_at);
create index tickets_answered on tickets (answered_at) where answered_at is not null;
```

Таблица `alerts` хранит тревоги, которые горят прямо сейчас. Индексы нужны, потому что сводка и проверки каждый день фильтруют заявки, оплаты и обращения по времени. Пока строк тысячи, разницы не видно, но через год без индексов каждый отчёт будет читать таблицы целиком.

## Шаг 2. Метрики

```ts
// src/metrics.ts
import { sql } from "./db";

/** Один день бизнеса в цифрах. Каждое число считает SQL, а не модель. */
export interface DayStats {
  leads: number;
  hot: number;
  spam: number;
  untaken: number;
  takeMinutes: number | null;
  invoiced: number;
  invoicedSum: number;
  paid: number;
  paidSum: number;
  tickets: number;
  answered: number;
  answerMinutes: number | null;
  draftsUsed: number;
  failedJobs: number;
}

/** Полночь в часовом поясе сервера (TZ в compose.yml) `daysAgo` дней назад. */
export function startOfDay(now: Date, daysAgo = 0) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - daysAgo);
  return day;
}

export async function dayStats(from: Date, to: Date): Promise<DayStats> {
  const [leads] = await sql`
    select
      count(*)::int as leads,
      count(*) filter (where qualification->>'temperature' = 'hot'
                         and status <> 'spam'
                         and (qualification->>'spam')::boolean is not true)::int as hot,
      count(*) filter (where status = 'spam' or (qualification->>'spam')::boolean)::int as spam,
      count(*) filter (where status = 'new' and (qualification->>'spam')::boolean is not true)::int as untaken,
      percentile_cont(0.5) within group (
        order by extract(epoch from taken_at - created_at) / 60
      ) filter (where status = 'taken') as take_minutes
    from leads where created_at >= ${from} and created_at < ${to}
  `;
  const [invoiced] = await sql`
    select count(*)::int as n, coalesce(sum(amount), 0)::bigint as sum
    from orders where created_at >= ${from} and created_at < ${to}
  `;
  const [paid] = await sql`
    select count(*)::int as n, coalesce(sum(amount), 0)::bigint as sum
    from orders where paid_at >= ${from} and paid_at < ${to}
  `;
  const [tickets] = await sql`
    select count(*)::int as n from tickets where created_at >= ${from} and created_at < ${to}
  `;
  const [answers] = await sql`
    select
      count(*)::int as n,
      count(*) filter (where draft_used)::int as drafts,
      percentile_cont(0.5) within group (
        order by extract(epoch from answered_at - created_at) / 60
      ) as minutes
    from tickets where answered_at >= ${from} and answered_at < ${to}
  `;
  const [jobs] = await sql`
    select count(*)::int as n from jobs
    where status = 'failed' and finished_at >= ${from} and finished_at < ${to}
  `;
  const minutes = (value: number | null) => (value === null ? null : Math.round(Number(value)));
  return {
    leads: leads.leads,
    hot: leads.hot,
    spam: leads.spam,
    untaken: leads.untaken,
    takeMinutes: minutes(leads.take_minutes),
    invoiced: invoiced.n,
    invoicedSum: Number(invoiced.sum),
    paid: paid.n,
    paidSum: Number(paid.sum),
    tickets: tickets.n,
    answered: answers.n,
    answerMinutes: minutes(answers.minutes),
    draftsUsed: answers.drafts,
    failedJobs: jobs.n,
  };
}

/** Вчерашний день и средний день за 7 дней до него. */
export async function yesterdayVsWeek(now = new Date()) {
  const yesterday = await dayStats(startOfDay(now, 1), startOfDay(now, 0));
  const week: DayStats[] = [];
  for (let i = 2; i <= 8; i++) {
    week.push(await dayStats(startOfDay(now, i), startOfDay(now, i - 1)));
  }
  const average = {} as Record<keyof DayStats, number>;
  for (const key of Object.keys(yesterday) as (keyof DayStats)[]) {
    average[key] = week.reduce((total, day) => total + (day[key] ?? 0), 0) / week.length;
  }
  return { from: startOfDay(now, 1), to: startOfDay(now, 0), yesterday, average };
}

/** То, что есть прямо сейчас, а не за день: долги и очередь поддержки. */
export async function currentState() {
  const [overdue] = await sql`
    select count(*)::int as n, coalesce(sum(amount), 0)::bigint as sum from orders
    where status = 'pending' and created_at < now() - interval '14 days'
  `;
  const [open] = await sql`select count(*)::int as n from tickets where status = 'new'`;
  return { overdue: overdue.n, overdueSum: Number(overdue.sum), openTickets: open.n };
}
```

Несколько решений, которые стоит объяснить.

**Медиана, а не среднее.** «Заявку взяли в среднем за 47 минут» может значить, что все брали за пять минут, а одну вечернюю взяли утром. Медиана такой выброс не замечает и показывает, как обычно бывает на самом деле. В Postgres это `percentile_cont(0.5) within group (order by ...)`.

**Границы дня в часовом поясе сервера.** «Вчера» начинается в полночь по Москве, а не по UTC. Часовой пояс приложения задан в `compose.yml` ещё во второй части (`TZ: Europe/Moscow`), и `startOfDay` считает полночь по нему. Сами границы уходят в SQL параметрами, поэтому часовой пояс базы ни на что не влияет.

**Среднее за 7 дней, а не за вчера.** Сравнивать вчера с позавчера бессмысленно: понедельник почти всегда отличается от воскресенья. Неделя сглаживает дни недели и случайные всплески.

**Текущее состояние отдельно.** Долги старше 14 дней и открытые обращения это не события за день, а то, что есть прямо сейчас. Их считает `currentState`.

## Шаг 3. Сводка

```ts
// src/digest.ts
import { askJson } from "./claude";
import { config } from "./config";
import { sql } from "./db";
import { currentState, type DayStats, yesterdayVsWeek } from "./metrics";
import { money } from "./orders";
import { html, tg } from "./telegram";

/** ▲ или ▼, когда число отличается от среднего за неделю больше чем на 30%. */
export function trend(value: number, average: number) {
  if (average < 1 && value < 1) {
    return "";
  }
  const change = (value - average) / Math.max(average, 1);
  if (change > 0.3) {
    return " ▲";
  }
  if (change < -0.3) {
    return " ▼";
  }
  return "";
}

const avg = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

export function renderDigest(
  day: Date,
  y: DayStats,
  a: Record<keyof DayStats, number>,
  now: { overdue: number; overdueSum: number; openTickets: number },
  highlights: string[]
) {
  const date = day.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
  const lines = [
    `<b>📊 Вчера, ${date}</b>`,
    "",
    `<b>Заявки:</b> ${y.leads} (в среднем ${avg(a.leads)})${trend(y.leads, a.leads)} · 🔥 ${y.hot} · спам ${y.spam}`,
    `взяли за ${y.takeMinutes ?? "–"} мин (медиана) · не взяты: ${y.untaken}`,
    `<b>Оплаты:</b> ${y.paid} на ${money(y.paidSum)} (в среднем ${money(Math.round(a.paidSum))})${trend(y.paidSum, a.paidSum)}`,
    `выставлено: ${y.invoiced} на ${money(y.invoicedSum)} · долги старше 14 дней: ${now.overdue} на ${money(now.overdueSum)}`,
    `<b>Поддержка:</b> ${y.tickets} обращений (в среднем ${avg(a.tickets)})${trend(y.tickets, a.tickets)} · отвечено ${y.answered}, медиана ${y.answerMinutes ?? "–"} мин`,
    `черновики без правок: ${y.draftsUsed} из ${y.answered} · открыто сейчас: ${now.openTickets}`,
  ];
  if (y.failedJobs > 0) {
    lines.push(`<b>Упавшие задачи:</b> ${y.failedJobs}`);
  }
  if (highlights.length > 0) {
    lines.push("", "<b>Что заметно:</b>", ...highlights.map((h) => `• ${html(h)}`));
  }
  return lines.join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    highlights: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["highlights"],
  additionalProperties: false,
};

const SYSTEM = `Ты помогаешь владельцу небольшой веб-студии читать утреннюю сводку.
Ты получаешь вчерашние цифры, средний день прошлой недели и краткие пересказы
вчерашних заявок и обращений в поддержку.
Назови до трёх вещей, на которые владельцу стоит обратить внимание: изменение
относительно недели, закономерность в запросах клиентов, риск. Каждую одним предложением.
Используй только данные числа и никогда не вычисляй новые. Если ничего
не выделяется, верни пустой список. Пиши по-русски.`;

/** О чём вчера писали клиенты, в пересказах самой модели из частей 4 и 6. */
async function yesterdaySummaries(from: Date, to: Date) {
  const leads = await sql`
    select qualification->>'summary' as s from leads
    where created_at >= ${from} and created_at < ${to} and qualification is not null
      and (qualification->>'spam')::boolean is not true
  `;
  const tickets = await sql`
    select triage->>'category' as c, triage->>'summary' as s from tickets
    where created_at >= ${from} and created_at < ${to} and triage is not null
  `;
  return [
    ...leads.map((l: any) => `lead: ${l.s}`),
    ...tickets.map((t: any) => `ticket (${t.c}): ${t.s}`),
  ].join("\n");
}

export async function sendDigest(now = new Date()) {
  const { from, to, yesterday, average } = await yesterdayVsWeek(now);
  const state = await currentState();
  let highlights: string[] = [];
  try {
    const summaries = await yesterdaySummaries(from, to);
    const answer = await askJson<{ highlights: string[] }>({
      task: "digest",
      system: SYSTEM,
      content:
        `<numbers>\n${JSON.stringify({ yesterday, weekAverage: average, now: state })}\n</numbers>\n\n` +
        `<summaries>\n${summaries || "none"}\n</summaries>`,
      schema: SCHEMA,
      effort: "low",
    });
    highlights = answer.highlights.slice(0, 3);
  } catch (error) {
    // Цифры важнее комментария: отправляем сводку без него
    console.error("digest commentary failed", error);
  }
  await tg("sendMessage", {
    chat_id: config.digestChatId,
    text: renderDigest(from, yesterday, average, state, highlights),
    parse_mode: "HTML",
  });
}
```

На что обратить внимание:

- **Стрелка только при отличии больше 30%.** Иначе стрелки будут у каждой строки каждый день, и их перестанут замечать. `Math.max(average, 1)` защищает от деления на ноль, когда за неделю чего-то не было вовсе.
- **Модели уходят только агрегаты и пересказы.** Никаких имён, телефонов и email: для наблюдения «три горячие заявки про интернет-магазины к Новому году» они не нужны. Спам в пересказы не попадает.
- **Ошибка модели не роняет сводку.** Комментарий обёрнут в `try`, и при любой ошибке сводка уходит без него. Если упадёт сама отправка в Telegram, очередь повторит задачу целиком, и это безопасно: сообщение ещё не ушло.
- **`effort: "low"`.** Найти три заметные вещи в паре десятков строк модели несложно.

Вот как выглядит сводка в чате:

```text
📊 Вчера, вт, 3 нояб.

Заявки: 12 (в среднем 8.4) ▲ · 🔥 3 · спам 2
взяли за 6 мин (медиана) · не взяты: 1
Оплаты: 5 на 75 000 ₽ (в среднем 52 000 ₽) ▲
выставлено: 7 на 98 000 ₽ · долги старше 14 дней: 2 на 30 000 ₽
Поддержка: 9 обращений (в среднем 6.1) ▲ · отвечено 8, медиана 42 мин
черновики без правок: 6 из 8 · открыто сейчас: 1

Что заметно:
• Три горячие заявки про интернет-магазин к новогодним распродажам.
• Оплат почти в полтора раза больше обычного.
```

## Шаг 4. Тревоги

Сводка отвечает на вопрос «как прошёл вчерашний день». Тревоги отвечают на другой: «не сломалось ли что-то прямо сейчас». Самые неприятные поломки тихие. Форма на сайте перестала отправляться после правки вёрстки, вебхук платёжки сменил адрес, и никаких ошибок нигде нет. Просто заявок нет.

```ts
// src/alerts.ts
import { sql } from "./db";
import { alert } from "./telegram";

export interface Check {
  name: string;
  firing: boolean;
  text: string;
}

/**
 * «Обычно к этому времени их было бы уже 5, а нет ни одного».
 * Обычный темп это среднее за последние 14 дней. Тишина подозрительна, когда
 * ожидаемое число событий с последнего доходит до `expected`.
 */
export function silence(
  name: string,
  what: string,
  rows: { last: Date | null; per_hour: number },
  expected = 5
): Check {
  if (!rows.last) {
    return { name, firing: false, text: "" };
  }
  const hours = (Date.now() - rows.last.getTime()) / 3_600_000;
  const usual = Number(rows.per_hour) * hours;
  return {
    name,
    firing: usual >= expected,
    text: `Нет ${what} уже ${Math.round(hours)} ч, хотя обычно за это время было бы около ${Math.round(usual)}`,
  };
}

/** Всё, за чем следим. Каждая проверка смотрит на данные как они есть сейчас. */
export async function runChecks(): Promise<Check[]> {
  const [leads] = await sql`
    select max(created_at) as last,
           count(*) filter (where created_at > now() - interval '14 days') / (14 * 24.0) as per_hour
    from leads
  `;
  const [payments] = await sql`
    select max(paid_at) as last,
           count(*) filter (where paid_at > now() - interval '14 days') / (14 * 24.0) as per_hour
    from orders
  `;
  const [support] = await sql`
    select count(*)::int as n from tickets
    where status = 'new' and created_at < now() - interval '4 hours'
  `;
  const [queue] = await sql`
    select count(*)::int as n from jobs
    where status = 'pending' and run_at < now() - interval '10 minutes'
  `;
  return [
    silence("leads.silence", "заявок", leads),
    silence("payments.silence", "оплат", payments),
    {
      name: "support.backlog",
      firing: support.n >= 5,
      text: `${support.n} обращений ждут ответа больше 4 часов`,
    },
    {
      name: "queue.lag",
      firing: queue.n > 0,
      text: `${queue.n} задач просрочены больше чем на 10 минут: воркер не успевает`,
    },
  ];
}

/**
 * Тревога это состояние, а не сообщение: одно сообщение, когда проблема
 * началась, и одно, когда закончилась, как бы часто ни шли проверки.
 */
export async function evaluate(checks: Check[]) {
  for (const check of checks) {
    if (check.firing) {
      const [started] = await sql`
        insert into alerts (name, text) values (${check.name}, ${check.text})
        on conflict (name) do nothing
        returning name
      `;
      if (started) {
        await alert(`🚨 ${check.text}`);
      }
    } else {
      const [ended] = await sql`delete from alerts where name = ${check.name} returning since, text`;
      if (ended) {
        const minutes = Math.round((Date.now() - ended.since.getTime()) / 60_000);
        await alert(`✅ Снова в норме через ${minutes} мин: ${ended.text}`);
      }
    }
  }
}
```

**Правило тишины.** Берём, сколько в среднем приходит заявок в час за последние две недели, и умножаем на число часов с последней. Получаем, сколько заявок «должно было» прийти. Если это пять или больше, а не пришло ни одной, это уже почти наверняка поломка, а не случайность: при пяти ожидаемых шанс случайно не получить ни одной меньше процента. То же правило работает для оплат.

У правила есть слабое место: среднее считается по всем часам подряд, включая ночи и выходные. Если почти все заявки у вас приходят в будни днём, в понедельник утром после тихих выходных тревога может сработать зря. Тогда поднимите порог `expected` или считайте среднее только по рабочим часам.

**Тревога это состояние, а не сообщение.** Проверки идут каждые 15 минут, и если слать сообщение при каждой, за ночь поломки придёт 30 одинаковых, и чат тревог замьютят. Поэтому горящая тревога записывается в таблицу `alerts`. Сообщение уходит, только когда строка появилась или исчезла. `insert ... on conflict do nothing returning` и `delete ... returning` делают это безопасным, даже если проверка случайно запустится дважды.

**Что проверяем:**

- тишина по заявкам и оплатам;
- пять и больше обращений ждут ответа дольше 4 часов: поддержка не справляется;
- задачи в очереди просрочены больше чем на 10 минут: воркер не успевает.

Чего эти проверки не поймают: если воркер упал совсем, проверять будет некому, потому что они сами выполняются воркером. Для этого нужен внешний наблюдатель, о нём в [части про эксплуатацию](/blog/ru/automations-ops/).

## Шаг 5. Подключаем к расписанию

Обработчики короткие, вся логика уже в модулях:

```ts
// src/handlers.ts
import { evaluate, runChecks } from "./alerts";
import { sendDigest } from "./digest";

export const handlers: Record<string, Handler> = {
  // ...

  // Каждое утро: вчерашний день в цифрах с комментарием модели
  "digest.daily": () => sendDigest(),

  // Каждые 15 минут: не затихло ли и не застряло ли что-то
  "alerts.check": async () => {
    await evaluate(await runChecks());
  },
};
```

```ts
// src/schedule.ts
import { enqueue } from "./queue";

export type Schedule =
  | { kind: string; everyMinutes: number }
  | { kind: string; dailyAt: string }; // "09:00" в часовом поясе сервера

export const schedules: Schedule[] = [
  { kind: "heartbeat", everyMinutes: 60 },
  { kind: "invoices.remind", dailyAt: "10:00" },
  { kind: "payments.reconcile", everyMinutes: 60 },
  { kind: "digest.daily", dailyAt: "09:00" },
  { kind: "alerts.check", everyMinutes: 15 },
];

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

Ключи слотов из части про ядро гарантируют, что сводка уйдёт один раз в день, сколько бы воркеров ни работало.

## Шаг 6. Тесты

Проверяем, что метрики считают только события внутри дня, что стрелки появляются только при заметном отличии, что сводка уходит и с комментарием, и без него, если модель ответила ошибкой, и что тревога о тишине приходит один раз в начале и один раз в конце. Заглушка Claude из прошлой части научилась отвечать ошибкой.

```ts
// test/analytics.test.ts
import { beforeEach, expect, test } from "bun:test";
import { evaluate, runChecks } from "../src/alerts";
import { config } from "../src/config";
import { sql } from "../src/db";
import { sendDigest, trend } from "../src/digest";
import { dayStats, startOfDay } from "../src/metrics";
import { calls, claude, reset } from "./stubs";

const HOUR = 60 * 60 * 1000;
const now = new Date();
const yesterday = (hour: number, minute = 0) =>
  new Date(startOfDay(now, 1).getTime() + hour * HOUR + minute * 60_000);
const messages = (chat: string) =>
  calls.filter((c) => c.method === "sendMessage" && String(c.body.chat_id) === chat);

beforeEach(async () => {
  reset();
  await sql`truncate leads, tickets, accesses, orders, jobs, alerts restart identity cascade`;
});

async function seedYesterday() {
  await sql`
    insert into leads (id, name, contact, message, status, qualification, created_at, taken_at) values
      ('a', 'A', 'a@x.io', '', 'taken', ${{ temperature: "hot", spam: false, summary: "Store by December" }},
       ${yesterday(10)}, ${yesterday(10, 8)}),
      ('b', 'B', 'b@x.io', '', 'spam', ${{ temperature: "cold", spam: true, summary: "SEO offer" }},
       ${yesterday(11)}, null),
      ('c', 'C', 'c@x.io', '', 'new', null, ${now}, null)
  `;
  await sql`
    insert into orders (id, email, description, amount, status, created_at, paid_at) values
      ('o1', 'a@x.io', 'Site', 1500000, 'paid', ${yesterday(-30)}, ${yesterday(12)}),
      ('o2', 'b@x.io', 'Fix', 500000, 'pending', ${yesterday(13)}, null)
  `;
  await sql`
    insert into tickets (source_id, channel, customer, message, status, draft_used, triage, created_at, answered_at)
    values ('t1', 'email', 'a@x.io', 'Hi', 'answered', true,
            ${{ category: "question", summary: "Asks about hosting" }}, ${yesterday(9)}, ${yesterday(9, 40)})
  `;
}

test("day stats count only what happened inside the day", async () => {
  await seedYesterday();
  const stats = await dayStats(startOfDay(now, 1), startOfDay(now, 0));
  expect(stats).toEqual({
    leads: 2,
    hot: 1,
    spam: 1,
    untaken: 0,
    takeMinutes: 8,
    invoiced: 1,
    invoicedSum: 500000,
    paid: 1,
    paidSum: 1500000,
    tickets: 1,
    answered: 1,
    answerMinutes: 40,
    draftsUsed: 1,
    failedJobs: 0,
  });
});

test("the trend arrow shows only changes over 30%", () => {
  expect(trend(14, 10)).toBe(" ▲");
  expect(trend(12, 10)).toBe("");
  expect(trend(6, 10)).toBe(" ▼");
  expect(trend(0, 0)).toBe("");
  expect(trend(2, 0)).toBe(" ▲");
});

test("the digest carries the model's highlights, and goes out without them if the model fails", async () => {
  await seedYesterday();
  claude.answer = { highlights: ["Заявок вдвое больше обычного"] };
  await sendDigest(now);
  const first = messages(config.digestChatId).at(-1)!.body.text;
  expect(first).toContain("<b>Заявки:</b> 2 (в среднем 0) ▲");
  expect(first).toContain("Заявок вдвое больше обычного");

  const request = calls.find((c) => c.api === "claude")!.body;
  expect(request.messages[0].content).toContain('"weekAverage"');
  expect(request.messages[0].content).toContain("lead: Store by December");
  expect(request.messages[0].content).not.toContain("SEO offer"); // спам в модель не попадает

  claude.status = 400;
  await sendDigest(now);
  const second = messages(config.digestChatId).at(-1)!.body.text;
  expect(second).toContain("<b>Оплаты:</b> 1");
  expect(second).not.toContain("Что заметно");
});

test("a silence alert fires once and resolves once", async () => {
  // По две заявки в час две недели, потом 10 часов тишины
  await sql`
    insert into leads (id, name, contact, message, created_at)
    select 'old' || g, 'X', 'x@x.io', '', now() - interval '10 hours' - g * interval '30 minutes'
    from generate_series(0, 14 * 48 - 21) as g
  `;
  await evaluate(await runChecks());
  await evaluate(await runChecks());
  const alerts = () => messages(config.alertChatId).map((c) => c.body.text);
  expect(alerts()).toHaveLength(1);
  expect(alerts()[0]).toStartWith("🚨 Нет заявок уже 10 ч");

  await sql`insert into leads (id, name, contact, message) values ('fresh', 'Y', 'y@x.io', '')`;
  await evaluate(await runChecks());
  await evaluate(await runChecks());
  expect(alerts()).toHaveLength(2);
  expect(alerts()[1]).toStartWith("✅ Снова в норме");
});

test("overdue jobs raise the queue lag alert", async () => {
  await sql`insert into jobs (kind, run_at) values ('x', now() - interval '20 minutes')`;
  const checks = await runChecks();
  expect(checks.find((c) => c.name === "queue.lag")!.firing).toBe(true);
  expect(checks.find((c) => c.name === "payments.silence")!.firing).toBe(false);
});
```

```text
 30 pass
 0 fail
```

В CI в шаг `Tests` добавляется `DIGEST_CHAT_ID: "-400"`.

## Шаг 7. Запуск

1. Решите, куда приходит сводка: в общий чат команды или лично владельцу. Для личных сообщений напишите боту `/start` и возьмите id чата так же, как для чата тревог.
2. Допишите в `.env` на сервере `DIGEST_CHAT_ID=...`.
3. Запушьте код: миграция `006_alerts.sql` применится при деплое.
4. Первая сводка придёт на следующее утро в 9:00. Средние станут осмысленными через неделю, а тишина по заявкам и оплатам начнёт проверяться, когда накопится история.

## Проверка

| Что сделали | Что произошло |
|---|---|
| Вчера две заявки (одна горячая, одна спам), оплата, обращение | метрики: 2 заявки, 🔥 1, спам 1, медиана взятия 8 мин, оплачено 15 000 ₽, медиана ответа 40 мин |
| Сводка при пустой прошлой неделе | «Заявки: 2 (в среднем 0) ▲» и наблюдение модели |
| Что ушло в модель | числа и «lead: Store by December», заявки со спамом там нет |
| Модель ответила 400 | сводка ушла без блока «Что заметно» |
| Две недели по две заявки в час, затем 10 часов тишины | одна тревога «🚨 Нет заявок уже 10 ч…» за две проверки подряд |
| Пришла новая заявка | одно «✅ Снова в норме через … мин» за две проверки |
| Задача просрочена на 20 минут | горит `queue.lag` |

## Что получилось

- Каждое утро картина вчерашнего дня приходит сама, со сравнением с обычной неделей.
- Все цифры точные, потому что их считает SQL. Модель только подсказывает, на что посмотреть.
- Тихие поломки вроде отвалившейся формы видны через несколько часов, а не через неделю.
- Тревоги не спамят: одно сообщение в начале проблемы и одно в конце.
- Сводка не зависит от модели и уходит, даже если API недоступен.

На этом серия «Заменяем …» закончена. Продажи, оплаты, поддержка и аналитика работают сами, а человек принимает решения. Осталась последняя часть, [«Эксплуатация»](/blog/ru/automations-ops/): как следить за самой системой, делать бэкапы за пределы сервера, хранить секреты и сколько всё это стоит.
