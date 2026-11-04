---
title: "The foundation: a server, a database and deploy on push"
description: Rent a VPS, set it up, write the first Bun service with Postgres and migrations, package it with Docker Compose and Caddy, and deploy it with GitHub Actions.
date: 2024-03-05
updated: 2026-11-04
series: automations
part: 2
tags: [automation, devops, docker, postgres]
---

:::tldr
One VPS, Docker Compose with three containers (our service, Postgres, Caddy), an image in GitHub Container Registry and deploy on push to main through GitHub Actions. By the end of this part we have an HTTPS address that accepts events, stores them in the database and updates itself after every commit.
:::

This is the second part of the series on commercial automations. In the [first one](/blog/automations-concept/) we chose what to automate and drew the architecture. Now we build the foundation every automation in the series will live on. It is worth doing once and doing well: from here on we only add code instead of thinking about how it gets to the server. The article shows only the key pieces of code; the full code of the series, tests included, is in the [repository](https://github.com/balkhaev/balkhaev.com/tree/main/examples/automations).

## What we end up with

```mermaid
flowchart TD
  push(["GitHub: push to main"])
  ci["<b>GitHub Actions</b><br/>type check → build image → push to ghcr.io"]
  push --> ci
  ci -- "ssh deploy@server ./deploy.sh &lt;commit&gt;" --> caddy
  subgraph vps [VPS]
    direction LR
    caddy["<b>caddy</b><br/>:443, HTTPS"]
    app["<b>app</b><br/>Bun, :3000"]
    db[("<b>db</b><br/>Postgres, pgdata volume")]
    caddy --> app --> db
  end
```

::news{topic="automation"}

## Step 1. The server

Any VPS with Ubuntu 24.04, two cores and 2–4 GB of memory will do. That is a few euros a month at Hetzner, DigitalOcean, Vultr or a local provider. Choose by where your clients are and where paying is convenient: the load from automations is small and hardware differences do not matter here.

Add your SSH key when creating the server so you never set a password. Then log in as root and do the basic setup.

```bash
ssh root@YOUR_IP

# updates, including automatic security updates
apt update && apt upgrade -y
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# Docker and the compose plugin from the official script
curl -fsSL https://get.docker.com | sh

# a separate deploy user, no password, with Docker access
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /opt/automations
chown deploy:deploy /opt/automations
```

Disable password logins and expose only SSH and the web:

```bash
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'CONF'
PasswordAuthentication no
PermitRootLogin prohibit-password
CONF
systemctl reload ssh

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw enable
```

:::warning
Docker writes its own iptables rules, and ports published with `ports:` in compose are opened to the world past ufw. That is why in our compose file only Caddy publishes ports while Postgres stays on Docker's internal network. Never publish the database port for convenience: that is what an SSH tunnel is for.
:::

## Step 2. The domain

Pick a subdomain for the service, for example `auto.example.com`, and add an A record pointing at the server's IP. Caddy will get a Let's Encrypt certificate on first start, as long as the domain already points at the server and ports 80 and 443 are open.

## Step 3. The service

Install Bun and create the project:

```bash
mkdir automations && cd automations
bun init -y
bun add -d typescript @types/bun
```

We have no runtime dependencies: the HTTP server and the Postgres client are built into Bun. TypeScript is only needed for type checking, and since version 7 its `tsc` compiler is rewritten in Go and runs several times faster than before. Add scripts to `package.json`: `dev` (`bun --watch src/server.ts`), `migrate` and `check` (`tsc --noEmit`).

Configuration comes only from environment variables. In `config.ts` a `required(name)` function reads a variable and throws if it's missing, so without a needed setting the service fails right at startup rather than an hour later on the first event.

The database connection, one pool for the whole app:

```ts
// src/db.ts
import { SQL } from "bun";
import { config } from "./config";

export const sql = new SQL(config.databaseUrl);
```

## Step 4. Migrations

We will change the schema in every part, so we set up migrations right away. No library is needed: SQL files in a `migrations` folder, a `schema_migrations` table with the names of applied ones and twenty lines of code in `migrate.ts`: read the file list, sort it, skip the applied ones, and run each new one like this:

```ts
// Миграция и запись о ней в одной транзакции: либо обе, либо ни одной
await sql.begin(async (tx) => {
  await tx.unsafe(text);
  await tx`insert into schema_migrations (name) values (${file})`;
});
```

Files are sorted by name, so we prefix them with a number: `001_`, `002_` and so on. An applied migration is never edited; we only add new ones.

The first migration creates the event log. Everything that comes from outside lands here raw, together with its headers: later we will use them to verify webhook signatures.

```sql
-- migrations/001_events.sql
create table events (
  id bigint generated always as identity primary key,
  source text not null,
  headers jsonb not null,
  body text not null,
  received_at timestamptz not null default now()
);

create index events_source_received_at on events (source, received_at desc);
```

## Step 5. The HTTP server

Two routes: `/health` to check that the service is alive and can reach the database, and `/hooks/:source` to accept events. The principle from the first part applies: store first, process later. There is nothing to process with yet, so we only store. `/health` runs `select 1` and answers `{ ok: true }`, and accepting an event is a single insert:

```ts
const body = await req.text();
const [event] = await sql`
  insert into events (source, headers, body)
  values (${source}, ${Object.fromEntries(req.headers)}, ${body})
  returning id
`;
return Response.json({ id: event.id }, { status: 202 });
```

An unknown source that isn't in the `SOURCES` list gets 404. On SIGTERM the server waits for current requests and closes the pool, so a deploy never cuts requests off halfway. And a couple of details. Bun turns the `headers` object into `jsonb` by itself, so there is no need to call `JSON.stringify` (if you do, a JSON string ends up in the database instead of an object). The body is stored as text rather than parsed JSON: verifying a webhook signature needs exactly the bytes that arrived.

:::note
Right now anyone who knows the address can write an event into the database. In the next part every source gets a signature or secret check; until then the `SOURCES` list at least turns away random requests.
:::

Try it locally. The easiest way to get Postgres is Docker:

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:18
echo 'DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres' > .env

bun run migrate
bun run dev
```

Bun reads `.env` by itself. In another terminal:

```bash
curl localhost:3000/health
# {"ok":true}

curl -X POST localhost:3000/hooks/site \
  -H 'content-type: application/json' \
  -d '{"name":"Anna","email":"anna@example.com","message":"We need a website for our studio"}'
# {"id":"1"}
```

The event is in the `events` table; you can check with `psql` in the `pg` container.

## Step 6. Docker

```dockerfile
# Dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY migrations ./migrations
USER bun
EXPOSE 3000
CMD ["bun", "src/server.ts"]
```

The array form of `CMD` matters: Bun runs as the container's main process and receives SIGTERM directly, so stopping during a deploy takes a fraction of a second instead of a ten-second wait followed by a forced kill.

Add `node_modules` and `.env` to both `.dockerignore` and `.gitignore`.

## Step 7. Compose and Caddy

The whole service on the server is described by one `compose.yml` file with three services. Besides the app there is `db` (the `postgres:18` image, a named `pgdata` volume, a health check with `pg_isready`) and `caddy` (the `caddy:2` image, the only one that publishes ports 80 and 443). The app looks like this:

```yaml
# compose.yml, the app service
app:
  image: ghcr.io/your-name/automations:${TAG:-latest}
  restart: unless-stopped
  env_file: .env
  environment:
    DATABASE_URL: postgres://app:${POSTGRES_PASSWORD}@db:5432/app
  depends_on:
    db:
      condition: service_healthy
```

What matters here:

- `image` instead of `build`: nothing is built on the server, it only pulls a ready image. Image names in GHCR must be lowercase.
- The image version comes from the `TAG` variable, which is the commit hash. You always know which commit is running, and a rollback is a deploy of an older hash.
- The database password comes from the `.env` file next to the compose file, which compose reads by itself.
- `depends_on` with `service_healthy`: the service starts only once the database accepts connections.
- Database data and Caddy's certificates live in named volumes and survive container re-creation.
- The Postgres version is pinned. A major database upgrade is done separately, with a dump and restore, not by changing the tag.

Caddy's config is three lines. It will get the certificate and keep renewing it by itself:

```text
auto.example.com {
	reverse_proxy app:3000
}
```

## Step 8. The deploy script

On the server a deploy is four commands. Put them in a script so GitHub Actions calls just one:

```bash
#!/bin/sh
# deploy.sh <tag>: runs on the server from /opt/automations
set -eu
cd "$(dirname "$0")"
export TAG="$1"
docker compose pull app
docker compose run --rm app bun src/migrate.ts
docker compose up -d --remove-orphans
docker image prune -f
```

The order matters: first pull the new image, then run migrations with the new code, and only then restart the service. If a migration fails, `set -e` stops the script and the old version keeps running. Hence the rule for migrations: old code must work with the new schema. Adding a column is fine; dropping one the old code still reads is not, and the drop goes into the next deploy.

## Step 9. Preparing the server for deploys

Once, by hand. First create a dedicated deploy key on your machine:

```bash
ssh-keygen -t ed25519 -f deploy_key -N "" -C "github-actions"
```

Put the public half into the `deploy` user's keys on the server:

```bash
ssh root@YOUR_IP "mkdir -p /home/deploy/.ssh && cat >> /home/deploy/.ssh/authorized_keys && chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys" < deploy_key.pub
```

Create the `.env` with the database password on the server:

```bash
ssh -i deploy_key deploy@auto.example.com
cd /opt/automations
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
chmod 600 .env
```

The password is hex so it contains no characters that break the connection string.

If the repository is private, the GHCR image will be private too, and the server needs to log in to the registry. Create a classic GitHub token with just the `read:packages` scope and, as `deploy` on the server, run:

```bash
docker login ghcr.io -u your-name
# paste the token as the password
```

Finally, the server's host key for GitHub Actions, so a deploy never connects to an impostor:

```bash
ssh-keyscan -t ed25519 auto.example.com
```

Compare the fingerprint with what the server itself reports (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) and keep the line `ssh-keyscan` printed.

## Step 10. GitHub Actions

In the repository settings create a `production` environment (Settings, Environments) and add to it:

- secret `DEPLOY_SSH_KEY`: the contents of `deploy_key`;
- secret `DEPLOY_KNOWN_HOSTS`: the line from `ssh-keyscan`;
- variable `DEPLOY_HOST`: `auto.example.com`.

Environment secrets are available only to jobs that name the environment explicitly, and you can turn on manual approval for it if you ever need to.

```yaml
# .github/workflows/deploy.yml, abridged
on:
  push:
    branches: [main]
concurrency: deploy
jobs:
  deploy:
    environment: production
    steps:
      # checkout, bun install, bun run check
      # docker/login-action and docker/build-push-action: image to ghcr.io
      - name: Ship to the server
        run: |
          scp compose.yml Caddyfile deploy.sh "deploy@$HOST:/opt/automations/"
          ssh "deploy@$HOST" "/opt/automations/deploy.sh ${{ github.sha }}"
      # smoke test: curl /health a few times with a pause
```

Step by step:

1. Type-check. If the code does not compile, we stop here. Tests join this step in the next part.
2. Build the image and push it to GHCR with two tags: the commit hash and `latest`. The built-in `GITHUB_TOKEN` is enough to log in to the registry, no extra token required.
3. Copy `compose.yml`, `Caddyfile` and `deploy.sh` to the server so changes to them also ship through git, and run the deploy with the commit hash.
4. Check that `/health` answers. If it does not, the job fails and GitHub sends an email.

`concurrency: deploy` keeps two deploys from running at once if you push two commits in a row.

## The first deploy

Create a repository on GitHub, commit everything and push to `main`.

A couple of minutes later the job is green and the service answers from outside:

```bash
curl https://auto.example.com/health
# {"ok":true}

curl -X POST https://auto.example.com/hooks/site -d '{"name":"test"}'
# {"id":"1"}
```

To read the logs and open the database:

```bash
ssh deploy@auto.example.com
cd /opt/automations
docker compose logs -f app
docker compose exec db psql -U app -c "select * from events order by id desc limit 5"
```

Rolling back to the previous version is the same deploy with an older hash: `./deploy.sh <old-hash>`.

## A backup to start with

Proper backups with an off-site copy come in the operations part. But from the first day real data lands in the database, there must be at least a daily dump. Add this to the `deploy` user's crontab (`crontab -e`):

```text
0 3 * * * cd /opt/automations && mkdir -p backups && docker compose exec -T db pg_dump -U app app | gzip > backups/app-$(date +\%F).sql.gz && find backups -name '*.sql.gz' -mtime +14 -delete
```

The percent sign must be escaped in crontab, hence `\%F`.

## What we have

- A server with minimal security setup: key-only login, only SSH and the web exposed, security updates installed automatically.
- A Bun service with Postgres and migrations that accepts events and stores them before any processing.
- HTTPS with no manual certificate work.
- Deploy on push to main: checks, build, migrations, restart, health check. Rollback in one command.

This foundation will not change for the rest of the series. In the [next part](/blog/automations-queue/) we write the core of the system: webhook signature checks, a job queue in Postgres, a worker with retries and a schedule. After that we can start plugging real automations into the service.
