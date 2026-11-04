---
title: "Operations: monitoring, backups, secrets and cost"
description: The last part of the series. Outside monitoring that notices when the whole system dies, log rotation, encrypted backups with another provider and a restore check, handling secrets, tracking what Claude costs, and updates, including the move to Postgres 18.
date: 2026-11-04
series: automations
part: 8
tags: [automation, operations, backups, monitoring, postgres]
---

:::tldr
Every 5 minutes the worker pings Healthchecks through the queue, and a separate service checks `/health` from outside: if anything dies, the alert comes from beyond the server. Docker logs are capped in size. Every night `backup.sh` dumps the database, encrypts it with age and puts it into another provider's object storage with a key that can't delete, and once a month `restore-check.sh` proves the dump restores. Every Claude request is recorded with its cost: the spend shows up in the morning digest, and going over the daily limit raises an alert. Secrets live only in `.env` on the server, and their list is kept in the repository as `.env.example`.
:::

This is the eighth and last part of the series on commercial automations. In the [previous part](/blog/automations-analytics/) the system learned to notice problems in the business by itself. Now we teach it to notice problems in itself, and take care of what happens when the server burns down one day. The article shows only the key pieces of code; the full code of the series, tests included, is in the [repository](https://github.com/balkhaev/balkhaev.com/tree/main/examples/automations).

## What can go wrong

| What happened | How we find out | Section |
|---|---|---|
| the server or the app went down | an outside check of `/health` | step 1 |
| the worker hung or died, the queue is stuck | pings through the queue stop reaching Healthchecks | step 1 |
| logs filled the disk | they won't: logs are capped | step 2 |
| the database is lost or corrupted | restore from the nightly backup | steps 3–4 |
| a key leaked | rotate it by the procedure; keys have minimal rights | step 5 |
| model costs grew | a line in the digest and a limit alert | step 6 |
| a silent breakage in the business | the alerts from the previous part | — |

```mermaid
flowchart TD
  subgraph server["Server"]
    sched(["Schedule"])
    queue[("jobs")]
    worker["Worker<br/>heartbeat every 5 minutes"]
    app["app: /health"]
    db[("Postgres")]
    cron["cron: backup.sh at 03:30"]
  end
  hc["<b>Healthchecks</b><br/>waits for pings"]
  uptime["<b>Uptime service</b><br/>GET /health every minute"]
  s3[("Another provider's storage<br/>encrypted dumps")]
  tg(["Telegram, email"])
  sched --> queue
  queue --> worker
  worker -- ping --> hc
  app --> db
  uptime -- checks --> app
  cron -- pg_dump, age --> s3
  cron -- ping after upload --> hc
  hc -- no ping --> tg
  uptime -- no answer --> tg
```

::news{topic="cost automation"}

## Step 1. Outside monitoring

The alerts from the previous part run in the worker itself. If it dies, nobody sends them. A system can't reliably report its own death, so it needs an outside watcher. There are two checks, and each catches its own kind of problem.

**A heartbeat through the queue.** Every 5 minutes the `heartbeat` job hits a URL at [Healthchecks.io](https://healthchecks.io). It's a dead man's switch: it doesn't check us, it waits for pings, and if no ping arrives within the set time, it sends an alert to Telegram or email. Importantly, the ping doesn't come from a separate cron but from an ordinary job: the schedule creates it, puts it into the queue and the worker runs it. While pings arrive, the whole chain works; if any link breaks, the pings stop.

```ts
// src/handlers.ts
// Every 5 minutes through the whole chain: schedule, queue, worker.
// If the pings stop, Healthchecks raises the alarm from outside.
heartbeat: async () => {
  if (config.heartbeatUrl) {
    const response = await fetch(config.heartbeatUrl, { signal: AbortSignal.timeout(10_000) });
    await check(response, "heartbeat");
  }
},
```

`heartbeat` now runs every 5 minutes instead of every hour. In Healthchecks create a check with a 5-minute period and a 10-minute grace, connect the Telegram integration and put the ping URL into `HEARTBEAT_URL`.

**A check from outside.** The heartbeat won't notice that Caddy went down or the certificate expired: the worker is still alive and pinging. So a second service opens `https://auto.example.com/health` every minute. The route from the second part runs `select 1` against the database, so the check also confirms the app can see Postgres. Any uptime service works: UptimeRobot, Better Stack, or your own Uptime Kuma, but then on another server, or it dies together with what it watches.

## Step 2. Logs

By default Docker keeps container logs without limits. Half a year later a chatty worker fills the whole disk with them, and the database goes down. We cap every service with one anchor: at most five files of 10 MB per container. The anchor is declared at the top of `compose.yml` and used in the shared `x-app` and in the `db` and `caddy` services:

```yaml
# compose.yml
# Docker keeps container logs forever by default; cap them so the disk never fills
x-logging: &logging
  driver: json-file
  options:
    max-size: 10m
    max-file: "5"

# and in every service, db and caddy included:
#   logging: *logging
```

A system this size doesn't need a log collection stack. `docker compose logs -f --since 1h worker` and `grep` are enough. Job errors are already visible in the `last_error` field of the `jobs` table, and final failures arrive in the alert chat.

Note the database volume: since Postgres 18 it's mounted at `/var/lib/postgresql`, not at `/var/lib/postgresql/data` as with images up to version 17. How to move a running database to a new major version is in step 7.

## Step 3. Backups

A Docker volume on the same server isn't a backup. A disk dies, someone deletes the server by mistake in the hosting panel, the account gets blocked, and the volume goes with the database. A real backup meets three conditions:

1. **It lives somewhere else.** S3-compatible object storage with another provider, preferably in another country: Backblaze B2, Cloudflare R2 and the like. For a small database that's gigabytes, which costs pennies.
2. **It's encrypted.** Dumps are encrypted with [age](https://age-encryption.org) using a public key. The private key isn't on the server; it lives in a password manager. The storage, and anyone who gets access to it, sees only encrypted files.
3. **It can't be erased from the server.** The storage access key can write but not delete. Old copies are removed by a lifecycle rule on the storage side, say after 30 days. If the server is hacked, the attacker can't destroy the backups. If the storage supports versioning or object lock, turn those on too.

Install age and [rclone](https://rclone.org) on the server: `apt install age rclone`. `backup.sh` itself lives in the repository, and the deploy from the second part copies it to the server along with `compose.yml`: the `scp` step got one more file. Cron runs the script every night at 03:30. The full version is [in the repository](https://github.com/balkhaev/balkhaev.com/blob/main/examples/automations/backup.sh), and the gist is six lines:

```bash
# backup.sh, the essentials
set -euo pipefail # a failed pg_dump must fail the script, not upload an empty file
trap 'curl -fsS -m 10 --retry 3 "$BACKUP_PING_URL/fail" > /dev/null || true' ERR

docker compose exec -T db pg_dump -U app -Fc app | age -r "$BACKUP_RECIPIENT" > "$file"
[ "$(stat -c %s "$file")" -ge 1024 ] # a dump of a live database is never under 1 KB
rclone copyto "$file" "backup:$BACKUP_BUCKET/automations/$name"
curl -fsS -m 10 --retry 3 "$BACKUP_PING_URL" > /dev/null
```

`set -o pipefail` matters more than anything else here. Without it, the exit code of `pg_dump | age` comes from the last command. If `pg_dump` fails, age dutifully encrypts nothing, and the script successfully uploads an empty file. With `pipefail` the script stops and pings Healthchecks at `/fail`, and the size check catches more exotic cases.

The settings live next to it, in a separate `backup.env` file with `600` permissions: the age public key, the bucket name, storage access for rclone (through `RCLONE_CONFIG_BACKUP_*` variables, no config file) and the Healthchecks ping URL. The template is in the repository as [`backup.env.example`](https://github.com/balkhaev/balkhaev.com/blob/main/examples/automations/backup.env.example). Create a separate Healthchecks check for backups with a one-day period. If the nightly backup failed or cron didn't run at all, an alert arrives in the morning.

## Step 4. The restore check

A backup nobody has ever restored is a hope, not a backup. The dump may turn out empty, the key may get lost, the format may not suit a new Postgres version. Finding out on the day of the disaster is too late. So once a month, on your own machine, download a fresh file from storage and run [`restore-check.sh`](https://github.com/balkhaev/balkhaev.com/blob/main/examples/automations/restore-check.sh) with the file and the age private key. The script starts a throwaway Postgres in Docker, decrypts the dump, restores it with `pg_restore` and shows the row count and the newest record for leads, orders, tickets and events.

If the numbers look right and the newest record is from yesterday, the backups work. You've also practiced a restore, so on the day of a disaster it won't be your first time.

## Step 5. Secrets

The system already has over a dozen secrets: the bot token, the YooKassa, email, Claude and storage keys, the webhook secrets. The rules are simple.

- **Secrets live only in `.env` on the server** with `600` permissions. It isn't in git and doesn't get into the image (it has been in `.dockerignore` since the second part).
- **The list of secrets lives in the repository** as `.env.example` without values. A new person or a new server sees at once what to fill in, and `required()` in `config.ts` refuses to start without a mandatory one. Our `.env.example` has about twenty lines, grouped by the parts of the series: database, webhooks, Telegram, leads, payments, email, Claude, operations.

- **GitHub gets only what the deploy needs:** the SSH key in Actions secrets and the server address in variables. The image is published with the built-in `GITHUB_TOKEN`, and GitHub never sees any of the app's keys.
- **Each key has minimal rights.** The Bitrix24 webhook has CRM rights only, the storage key can't delete, Claude gets its own workspace in the Console with its own spend limit. One leaked key doesn't open everything else.
- **Rotation.** Issue a new key at the provider, change it in `.env`, run `docker compose up -d`, revoke the old key. It has to be `up -d`: that recreates the containers with the new environment, while `docker compose restart` restarts them with the old one.
- **Secrets don't get into logs or model prompts.** We never log whole request headers or bodies, and requests to Claude carry only lead and ticket data.

## Step 6. What it costs

**Infrastructure.** One small VPS is enough for everything we've built: 2 vCPU and 2–4 GB of memory. As a rough guide at the time of writing, that's 5–10 euros a month. Backup storage costs pennies, Healthchecks and uptime services have free plans, and email services have free volumes for small loads too. Check the current terms; they change.

**Claude.** Here the cost depends on load, and it should be measured, not guessed. Every request is now recorded in an `llm_usage` table: the task, the model, input tokens, tokens read from and written to the cache, output tokens and the cost in dollars. `askJson` writes the row right after the model answers and computes the cost from the answer's `usage`:

```ts
// Dollars per million tokens. Prices change: check them on the Anthropic site
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

/** What one answer cost, from the token counts in `usage`. */
export function cost(usage: Anthropic.Beta.BetaUsage) {
  return (
    (usage.input_tokens * PRICE.input +
      (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      usage.output_tokens * PRICE.output) /
    1_000_000
  );
}
```

The prices in the code are for Claude Opus 5.5 at the time of writing: 4 dollars per million input tokens, 20 per million output tokens, 0.20 for cache reads. If the model or the prices change, update `PRICE`. If the fallback model answered, its name goes into `model`, but the cost is computed with the main model's prices, so treat it as an estimate rather than an invoice.

The morning digest got a line like "Claude: 34 requests for 0.41 dollars", and the checks got an alert when the day's spend exceeds `LLM_DAILY_LIMIT_USD`:

```ts
// src/alerts.ts, in runChecks
{
  name: "llm.spend",
  firing: spend.today > config.llmDailyLimit,
  text: `Claude has cost $${spend.today.toFixed(2)} today, over the $${config.llmDailyLimit} limit`,
},
```

The alert informs but doesn't stop anything. The hard cap is a workspace spend limit in the Claude Console: even if a loop creeps into the code, it can't spend past the limit.

A rough estimate for our requests. Qualifying a lead is a few hundred input tokens and a couple hundred output tokens, under a cent. A support draft is longer, and the model thinks about it longer: about two cents, with the knowledge base read from the cache at a twentieth of the normal input price. The morning digest costs a couple of cents a day. At 100 leads and 30 tickets a day that comes to roughly 30–40 dollars a month. After a week of work `llm_usage` will show the exact figure.

If the figure looks big, here are the levers in order:

- **A model per task.** Sorting leads into fields is something Claude Haiku 5.5 does perfectly well, at a few dozen times less than Opus: 0.10 and 0.50 dollars per million tokens. Change the `model` line, but note that Haiku has no server-side fallback, so drop the `betas` and `fallbacks` parameters for it. Keep client drafts on Opus.
- **Prompt caching** for anything repeated (the support part).
- **`effort`** no higher than needed: we use `low` for classification and `medium` for drafts.

## Step 7. Updates

- **The OS.** Turn on `unattended-upgrades` on the server so security updates install themselves.
- **Images.** `caddy:2` and `postgres:18` are pinned to a major version, so `docker compose pull && docker compose up -d` once a month pulls in the fixes.
- **App dependencies.** Dependabot or Renovate on GitHub sends a weekly PR with updates to `bun.lock` and the actions' versions. The CI tests from the earlier parts tell you whether it's safe to merge.

**A new Postgres major version.** One comes out every year, and it can't be installed by just changing the tag: data files aren't compatible between versions. The example below moves from 17 to 18, in case you started with the older image. Version 18 also changed the data path, so the volume is mounted at `/var/lib/postgresql`. A year later you move to 19 the same way. The simplest route for a small database is a dump and restore with the same tools as the backup:

```bash
cd /opt/automations
docker compose stop app worker                     # nobody writes to the database any more
docker compose exec -T db pg_dump -U app -Fc app > /root/before-18.dump
docker compose down                                # the old pgdata volume stays where it is
# in compose.yml: postgres:18, volume pgdata_18:/var/lib/postgresql, and pgdata_18 under volumes
docker compose up -d db
docker compose exec -T db pg_restore -U app -d app --no-owner < /root/before-18.dump
docker compose up -d
```

Leave the old `pgdata` volume alone for a week: if something goes wrong, going back to `postgres:17` takes a minute. Before the move, make sure last night's backup is in place.

## Step 8. Tests

The new tests check the cost calculation with caching, the recording of every model request, a single alert for the limit, and that the heartbeat pings the URL and fails loudly when it can't reach it. Failing is the right behavior here: the queue retries the job, and Healthchecks, missing the ping, raises the alarm. For example, 1,000 input tokens, 10,000 from the cache and 500 output tokens must cost exactly 0.016 dollars.

There are no new required variables: without `HEARTBEAT_URL` the heartbeat simply does nothing, and the spend limit has a default.

The backup scripts were checked against a local Postgres in Docker, with stubs instead of rclone and Healthchecks. A successful run uploads the file and pings the check. A restore through `restore-check.sh` shows the rows. With the database stopped, the script fails at `pg_dump`, uploads nothing and pings `/fail`.

## The operations checklist

| How often | What to do |
|---|---|
| every day | read the morning digest, deal with alerts |
| every week | merge the dependency update PR if CI is green |
| every month | `restore-check.sh` on a fresh backup, `docker compose pull && up -d` |
| every quarter | review keys and rights, revoke unused ones, weigh the Claude spend against its value |
| every year | move to the new Postgres major version |

## The series in summary

Over eight parts we went from an idea to a system that runs on one server and takes over most of a small company's routine:

- **Foundation:** Bun, TypeScript and Postgres on one VPS, Docker Compose, Caddy with automatic HTTPS, and deploy on push through GitHub Actions.
- **Core:** webhook intake with signature checks and duplicate protection, a Postgres job queue with retries and a schedule.
- **Sales:** a website lead reaches a manager within seconds, with Claude's triage, the CRM and reminders.
- **Payments:** invoices, a pay link that never expires, access granted exactly once, reconciliation and reminders to clients who owe.
- **Support:** all incoming messages in one chat, drafts from the knowledge base, a person sends.
- **Analytics:** a morning digest where SQL computes the numbers, and alerts about silent breakages.
- **Operations:** outside monitoring, backups proven by restores, secrets and cost tracking.

It's about 2,200 lines of code and SQL plus 700 lines of tests, without a single framework, and every line can be read and understood. A few ideas run through the whole system: an event is stored first and processed second, every action has an idempotency key, races are settled by one conditional `update`, the model helps a person but the person decides and sends, and the system reports problems by itself, once and to the point.

All the code with tests is in the [repository](https://github.com/balkhaev/balkhaev.com/tree/main/examples/automations), and all parts of the series are collected on the [series page](/blog/series/automations/).
