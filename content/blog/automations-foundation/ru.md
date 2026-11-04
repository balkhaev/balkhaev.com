---
title: "Фундамент: сервер, база и деплой по пушу"
description: Арендуем VPS, настраиваем его, пишем первый сервис на Bun с Postgres и миграциями, упаковываем в Docker Compose с Caddy и настраиваем деплой через GitHub Actions.
date: 2026-11-04
series: automations
part: 2
tags: [automation, devops, docker, postgres]
---

:::tldr
Один VPS, Docker Compose с тремя контейнерами (наш сервис, Postgres, Caddy), образ в GitHub Container Registry и деплой по пушу в main через GitHub Actions. К концу части у нас есть адрес с HTTPS, который принимает события, складывает их в базу и обновляется сам после каждого коммита.
:::

Это вторая часть цикла про коммерческие автоматизации. В [первой](/blog/ru/automations-concept/) мы выбрали, что автоматизировать, и нарисовали архитектуру. Теперь строим фундамент, на котором будут жить все автоматизации цикла. Его стоит сделать один раз и хорошо: дальше мы будем только добавлять код, а не думать, как он попадает на сервер.

## Что получится

```text
   GitHub: push в main
          |
          v
   GitHub Actions: проверка типов -> сборка образа -> push в ghcr.io
          |
          |  ssh deploy@сервер ./deploy.sh <commit>
          v
  +-------------------- VPS -----------------------------------+
  |                                                            |
  |  :443  caddy  -->  app (Bun, :3000)  -->  db (Postgres)    |
  |        HTTPS                              том pgdata       |
  |                                                            |
  +------------------------------------------------------------+
```

Структура репозитория к концу части:

```text
automations/
  .github/workflows/deploy.yml
  migrations/001_events.sql
  src/config.ts
  src/db.ts
  src/migrate.ts
  src/server.ts
  Caddyfile
  compose.yml
  deploy.sh
  Dockerfile
  package.json
```

## Шаг 1. Сервер

Подойдёт любой VPS с Ubuntu 24.04, двумя ядрами и 2–4 ГБ памяти. Это несколько евро в месяц у Hetzner, DigitalOcean, Vultr, а для российских компаний у Selectel или Timeweb Cloud. Выбирайте по тому, где ваши клиенты и где удобнее платить: нагрузка у автоматизаций небольшая, и разница в железе здесь не важна.

При создании сервера сразу добавьте свой SSH-ключ, чтобы не заводить пароль. Затем заходим под root и делаем базовую настройку.

```bash
ssh root@ВАШ_IP

# обновления, в том числе автоматические обновления безопасности
apt update && apt upgrade -y
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# Docker и плагин compose из официального скрипта
curl -fsSL https://get.docker.com | sh

# отдельный пользователь для деплоя, без пароля, с доступом к Docker
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /opt/automations
chown deploy:deploy /opt/automations
```

Запрещаем вход по паролю и открываем наружу только SSH и веб:

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
Docker сам пишет правила iptables, и порты, опубликованные через `ports:` в compose, открываются наружу в обход ufw. Поэтому в нашем compose-файле порты публикует только Caddy, а Postgres остаётся во внутренней сети Docker. Никогда не публикуйте порт базы ради удобства подключения: для этого есть SSH-туннель.
:::

## Шаг 2. Домен

Заведите поддомен для сервиса, например `auto.example.com`, и добавьте A-запись на IP сервера. Caddy сам получит сертификат Let's Encrypt при первом запуске, если домен уже указывает на сервер и порты 80 и 443 открыты.

## Шаг 3. Сервис

Ставим Bun и создаём проект:

```bash
mkdir automations && cd automations
bun init -y
bun add -d typescript @types/bun
```

Зависимостей во время работы у нас нет: HTTP-сервер и клиент Postgres встроены в Bun. В `package.json` добавим скрипты:

```json
{
  "name": "automations",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/server.ts",
    "migrate": "bun src/migrate.ts",
    "check": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

Конфигурация только из переменных окружения, и если чего-то не хватает, сервис падает сразу при старте, а не через час на первом событии:

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
};
```

Подключение к базе, один пул на всё приложение:

```ts
// src/db.ts
import { SQL } from "bun";
import { config } from "./config";

export const sql = new SQL(config.databaseUrl);
```

## Шаг 4. Миграции

Схему базы будем менять в каждой части, поэтому сразу заводим миграции. Отдельная библиотека для этого не нужна: SQL-файлы в папке `migrations`, таблица с именами применённых и двадцать строк кода.

```ts
// src/migrate.ts
import { readdir } from "node:fs/promises";
import { sql } from "./db";

await sql`
  create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`;

const rows: { name: string }[] = await sql`select name from schema_migrations`;
const applied = new Set(rows.map((row) => row.name));
const files = (await readdir("migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const file of files) {
  if (applied.has(file)) {
    continue;
  }
  const text = await Bun.file(`migrations/${file}`).text();
  // Миграция и запись о ней в одной транзакции: либо обе, либо ни одной
  await sql.begin(async (tx) => {
    await tx.unsafe(text);
    await tx`insert into schema_migrations (name) values (${file})`;
  });
  console.log(`applied ${file}`);
}

await sql.close();
```

Файлы сортируются по имени, поэтому называем их с номером: `001_`, `002_` и так далее. Применённую миграцию никогда не редактируем, только добавляем новую.

Первая миграция создаёт журнал событий. Сюда попадает всё, что пришло снаружи, в сыром виде, вместе с заголовками: позже по ним будем проверять подписи вебхуков.

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

## Шаг 5. HTTP-сервер

Два маршрута: `/health` для проверки, что сервис жив и видит базу, и `/hooks/:source` для приёма событий. Принцип из первой части: сначала сохранить, потом обработать. Пока обрабатывать нечем, поэтому только сохраняем.

```ts
// src/server.ts
import { config } from "./config";
import { sql } from "./db";

// Источники, от которых принимаем события. Остальным 404.
const SOURCES = new Set(["site", "payments", "telegram"]);

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
        const { source } = req.params;
        if (!SOURCES.has(source)) {
          return new Response("Unknown source", { status: 404 });
        }
        const headers = Object.fromEntries(req.headers);
        const body = await req.text();
        const [event] = await sql`
          insert into events (source, headers, body)
          values (${source}, ${headers}, ${body})
          returning id
        `;
        return Response.json({ id: event.id }, { status: 202 });
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

console.log(`listening on :${server.port}`);

// При деплое Docker шлёт SIGTERM: дожидаемся текущих запросов и выходим
process.on("SIGTERM", async () => {
  await server.stop();
  await sql.close();
  process.exit(0);
});
```

Пара деталей. Bun сам превращает объект `headers` в `jsonb`, вручную вызывать `JSON.stringify` не нужно (если вызвать, в базу ляжет JSON-строка вместо объекта). Тело храним как текст, а не разобранный JSON: для проверки подписи вебхука нужны ровно те байты, что пришли.

:::note
Сейчас любой, кто знает адрес, может записать событие в базу. В следующей части у каждого источника появится проверка подписи или секрета, а пока список `SOURCES` хотя бы отсекает случайные запросы.
:::

Проверяем локально. Postgres проще всего поднять в Docker:

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:17
echo 'DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres' > .env

bun run migrate
bun run dev
```

Bun сам читает `.env`. В другом терминале:

```bash
curl localhost:3000/health
# {"ok":true}

curl -X POST localhost:3000/hooks/site \
  -H 'content-type: application/json' \
  -d '{"name":"Анна","phone":"+79001234567","message":"Нужен сайт для студии"}'
# {"id":"1"}
```

Событие лежит в базе:

```bash
docker exec pg psql -U postgres -c "select id, source, body from events"
```

## Шаг 6. Docker

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

`CMD` в форме массива важен: так Bun работает как главный процесс контейнера и получает SIGTERM напрямую, и остановка при деплое занимает доли секунды вместо десяти секунд ожидания и принудительного убийства.

В `.dockerignore` и `.gitignore` добавляем `node_modules` и `.env`.

## Шаг 7. Compose и Caddy

Весь сервис на сервере описан одним файлом:

```yaml
# compose.yml
services:
  app:
    image: ghcr.io/your-name/automations:${TAG:-latest}
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgres://app:${POSTGRES_PASSWORD}@db:5432/app
    depends_on:
      db:
        condition: service_healthy

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

Что здесь важно:

- `image` вместо `build`: на сервере ничего не собираем, только скачиваем готовый образ. Имя образа в GHCR должно быть в нижнем регистре.
- Версия образа приходит из переменной `TAG`, это хеш коммита. Так всегда видно, какой коммит сейчас работает, и откат это деплой старого хеша.
- Пароль базы приходит из файла `.env` рядом с compose-файлом, compose читает его сам.
- `depends_on` с `service_healthy`: сервис стартует, только когда база готова принимать подключения.
- Данные базы и сертификаты Caddy лежат в именованных томах и переживают пересоздание контейнеров.
- Версия Postgres зафиксирована. Мажорное обновление базы делается отдельно, через дамп и восстановление, а не сменой тега.

Конфиг Caddy занимает три строки. Сертификат он получит и будет продлевать сам:

```text
auto.example.com {
	reverse_proxy app:3000
}
```

## Шаг 8. Скрипт деплоя

На сервере деплой состоит из четырёх команд. Положим их в скрипт, чтобы GitHub Actions вызывал одну:

```bash
#!/bin/sh
# deploy.sh <tag>: запускается на сервере из /opt/automations
set -eu
cd "$(dirname "$0")"
export TAG="$1"
docker compose pull app
docker compose run --rm app bun src/migrate.ts
docker compose up -d --remove-orphans
docker image prune -f
```

Порядок важен: сначала скачиваем новый образ, затем прогоняем миграции новым кодом, и только потом перезапускаем сервис. Если миграция упала, `set -e` остановит скрипт, и старая версия продолжит работать. Отсюда правило для миграций: старый код должен работать с новой схемой. Добавить колонку можно, а удалить ту, которую старый код ещё читает, нельзя: удаление делается следующим деплоем.

## Шаг 9. Подготовка сервера к деплою

Один раз, руками. Сначала на своей машине создаём отдельный ключ для деплоя:

```bash
ssh-keygen -t ed25519 -f deploy_key -N "" -C "github-actions"
```

Публичную часть кладём пользователю `deploy` на сервере:

```bash
ssh root@ВАШ_IP "mkdir -p /home/deploy/.ssh && cat >> /home/deploy/.ssh/authorized_keys && chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys" < deploy_key.pub
```

Создаём на сервере `.env` с паролем базы:

```bash
ssh -i deploy_key deploy@auto.example.com
cd /opt/automations
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
chmod 600 .env
```

Пароль в hex, чтобы в нём не было символов, которые ломают строку подключения.

Если репозиторий приватный, образ в GHCR тоже будет приватным, и серверу нужно войти в реестр. Создайте на GitHub классический токен с одним правом `read:packages` и на сервере под `deploy` выполните:

```bash
docker login ghcr.io -u your-name
# вставьте токен вместо пароля
```

Наконец, отпечаток ключа сервера для GitHub Actions, чтобы деплой не подключился к подменённому серверу:

```bash
ssh-keyscan -t ed25519 auto.example.com
```

Сверьте отпечаток с тем, что показывает сам сервер (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`), и сохраните строку из вывода `ssh-keyscan`.

## Шаг 10. GitHub Actions

В настройках репозитория создайте окружение `production` (Settings, Environments) и добавьте в него:

- секрет `DEPLOY_SSH_KEY`: содержимое файла `deploy_key`;
- секрет `DEPLOY_KNOWN_HOSTS`: строка из `ssh-keyscan`;
- переменную `DEPLOY_HOST`: `auto.example.com`.

Секреты окружения доступны только джобам, которые явно указали это окружение, и для него можно включить ручное подтверждение, если когда-нибудь понадобится.

```yaml
# .github/workflows/deploy.yml
name: deploy

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

concurrency: deploy

env:
  IMAGE: ghcr.io/your-name/automations

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run check

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ env.IMAGE }}:${{ github.sha }}
            ${{ env.IMAGE }}:latest

      - name: Ship to the server
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
          HOST: ${{ vars.DEPLOY_HOST }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_ed25519
          echo "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          chmod 600 ~/.ssh/id_ed25519
          scp compose.yml Caddyfile deploy.sh "deploy@$HOST:/opt/automations/"
          ssh "deploy@$HOST" "/opt/automations/deploy.sh ${{ github.sha }}"

      - name: Smoke test
        run: |
          for i in 1 2 3 4 5 6; do
            curl -fsS https://auto.example.com/health && exit 0
            sleep 5
          done
          exit 1
```

По шагам:

1. Проверяем типы. Если код не компилируется, дальше не идём. В следующей части сюда добавятся тесты.
2. Собираем образ и кладём в GHCR с двумя тегами: хеш коммита и `latest`. Для входа в реестр хватает встроенного `GITHUB_TOKEN`, отдельный токен не нужен.
3. Копируем на сервер `compose.yml`, `Caddyfile` и `deploy.sh`, чтобы изменения в них тоже доезжали через git, и запускаем деплой с хешем коммита.
4. Проверяем, что `/health` отвечает. Если нет, джоба падает, и GitHub пришлёт письмо.

`concurrency: deploy` не даёт двум деплоям идти одновременно, если вы запушили два коммита подряд.

## Первый деплой

```bash
git init
git add .
git commit -m "Foundation: service, database, deploy"
git remote add origin git@github.com:your-name/automations.git
git push -u origin main
```

Через пару минут джоба зелёная, и сервис отвечает снаружи:

```bash
curl https://auto.example.com/health
# {"ok":true}

curl -X POST https://auto.example.com/hooks/site -d '{"name":"test"}'
# {"id":"1"}
```

Посмотреть логи и зайти в базу:

```bash
ssh deploy@auto.example.com
cd /opt/automations
docker compose logs -f app
docker compose exec db psql -U app -c "select * from events order by id desc limit 5"
```

Откат на предыдущую версию это тот же деплой со старым хешем: `./deploy.sh <старый-хеш>`.

## Бэкап на первое время

Полноценные бэкапы с копией в другом месте разберём в части про эксплуатацию. Но с первого дня, как в базу попадают настоящие данные, должен быть хотя бы ежедневный дамп. Добавьте в crontab пользователя `deploy` (`crontab -e`):

```text
0 3 * * * cd /opt/automations && mkdir -p backups && docker compose exec -T db pg_dump -U app app | gzip > backups/app-$(date +\%F).sql.gz && find backups -name '*.sql.gz' -mtime +14 -delete
```

Знак процента в crontab нужно экранировать, отсюда `\%F`.

## Что получилось

- Сервер с минимальной настройкой безопасности: вход только по ключу, наружу открыты SSH и веб, обновления безопасности ставятся сами.
- Сервис на Bun с Postgres и миграциями, который принимает события и сохраняет их до любой обработки.
- HTTPS без ручной возни с сертификатами.
- Деплой по пушу в main: проверка, сборка, миграции, перезапуск, проверка здоровья. Откат одной командой.

Этот фундамент не изменится до конца цикла. В следующей части пишем сердце системы: проверку подписей вебхуков, очередь задач в Postgres, воркер с повторами и расписание. После неё к сервису можно будет подключать настоящие автоматизации.
