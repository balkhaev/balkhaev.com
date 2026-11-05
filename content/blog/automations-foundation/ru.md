---
title: "Фундамент: сервер, база и деплой по пушу"
description: Арендуем VPS, настраиваем его, пишем первый сервис на Bun с Postgres и миграциями, упаковываем в Docker Compose с Caddy и настраиваем деплой через GitHub Actions.
date: 2025-06-24
updated: 2026-11-04
series: automations
part: 2
tags: [automation, devops, docker, postgres]
---

:::tldr
Один VPS, Docker Compose с тремя контейнерами (наш сервис, Postgres, Caddy), образ в GitHub Container Registry и деплой по пушу в main через GitHub Actions. К концу части у нас есть адрес с HTTPS, который принимает события, складывает их в базу и обновляется сам после каждого коммита.
:::

Это вторая часть цикла про коммерческие автоматизации. В [первой](/blog/ru/automations-concept/) мы выбрали, что автоматизировать, и нарисовали архитектуру. Теперь строим фундамент, на котором будут жить все автоматизации цикла. Его стоит сделать один раз и хорошо: дальше мы будем только добавлять код, а не думать, как он попадает на сервер. В статье только ключевые фрагменты кода, полный код серии с тестами лежит в [репозитории](https://github.com/balkhaev/balkhaev.com/tree/main/examples/automations).

## Что получится

```mermaid
flowchart TD
  push(["GitHub: push в main"])
  ci["<b>GitHub Actions</b><br/>проверка типов → сборка образа → push в ghcr.io"]
  push --> ci
  ci -- "ssh deploy@сервер ./deploy.sh &lt;commit&gt;" --> caddy
  subgraph vps [VPS]
    direction LR
    caddy["<b>caddy</b><br/>:443, HTTPS"]
    app["<b>app</b><br/>Bun, :3000"]
    db[("<b>db</b><br/>Postgres, том pgdata")]
    caddy --> app --> db
  end
```

::news{topic="automation"}

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

Зависимостей во время работы у нас нет: HTTP-сервер и клиент Postgres встроены в Bun. TypeScript нужен только для проверки типов, и с седьмой версии его компилятор `tsc` переписан на Go и работает в разы быстрее прежнего. В `package.json` добавим скрипты `dev` (`bun --watch src/server.ts`), `migrate` и `check` (`tsc --noEmit`).

Конфигурация только из переменных окружения. В `config.ts` функция `required(name)` читает переменную и бросает ошибку, если её нет, поэтому без нужной настройки сервис падает сразу при старте, а не через час на первом событии.

Подключение к базе, один пул на всё приложение:

```ts
// src/db.ts
import { SQL } from "bun";
import { config } from "./config";

export const sql = new SQL(config.databaseUrl);
```

## Шаг 4. Миграции

Схему базы будем менять в каждой части, поэтому сразу заводим миграции. Отдельная библиотека для этого не нужна: SQL-файлы в папке `migrations`, таблица `schema_migrations` с именами применённых и двадцать строк кода в `migrate.ts`: прочитать список файлов, отсортировать, пропустить применённые, а каждый новый выполнить так:

```ts
// Миграция и запись о ней в одной транзакции: либо обе, либо ни одной
await sql.begin(async (tx) => {
  await tx.unsafe(text);
  await tx`insert into schema_migrations (name) values (${file})`;
});
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

Два маршрута: `/health` для проверки, что сервис жив и видит базу, и `/hooks/:source` для приёма событий. Принцип из первой части: сначала сохранить, потом обработать. Пока обрабатывать нечем, поэтому только сохраняем. `/health` делает `select 1` и отвечает `{ ok: true }`, а приём события это одна вставка:

```ts
const body = await req.text();
const [event] = await sql`
  insert into events (source, headers, body)
  values (${source}, ${Object.fromEntries(req.headers)}, ${body})
  returning id
`;
return Response.json({ id: event.id }, { status: 202 });
```

Неизвестный источник, которого нет в списке `SOURCES`, получает 404. На SIGTERM сервер дожидается текущих запросов и закрывает пул, чтобы деплой не обрывал запросы на середине. И пара деталей. Bun сам превращает объект `headers` в `jsonb`, вручную вызывать `JSON.stringify` не нужно (если вызвать, в базу ляжет JSON-строка вместо объекта). Тело храним как текст, а не разобранный JSON: для проверки подписи вебхука нужны ровно те байты, что пришли.

:::note
Сейчас любой, кто знает адрес, может записать событие в базу. В следующей части у каждого источника появится проверка подписи или секрета, а пока список `SOURCES` хотя бы отсекает случайные запросы.
:::

Проверяем локально. Postgres проще всего поднять в Docker:

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:18
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

Событие лежит в таблице `events`, проверить можно через `psql` в контейнере `pg`.

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

Весь сервис на сервере описан одним файлом `compose.yml` с тремя сервисами. Кроме приложения в нём `db` (образ `postgres:18`, именованный том `pgdata`, проверка здоровья через `pg_isready`) и `caddy` (образ `caddy:2`, единственный, кто публикует порты 80 и 443). Приложение выглядит так:

```yaml
# compose.yml, сервис приложения
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
# .github/workflows/deploy.yml, сокращённо
on:
  push:
    branches: [main]
concurrency: deploy
jobs:
  deploy:
    environment: production
    steps:
      # checkout, bun install, bun run check
      # docker/login-action и docker/build-push-action: образ в ghcr.io
      - name: Ship to the server
        run: |
          scp compose.yml Caddyfile deploy.sh "deploy@$HOST:/opt/automations/"
          ssh "deploy@$HOST" "/opt/automations/deploy.sh ${{ github.sha }}"
      # smoke test: curl /health несколько раз с паузой
```

По шагам:

1. Проверяем типы. Если код не компилируется, дальше не идём. В следующей части сюда добавятся тесты.
2. Собираем образ и кладём в GHCR с двумя тегами: хеш коммита и `latest`. Для входа в реестр хватает встроенного `GITHUB_TOKEN`, отдельный токен не нужен.
3. Копируем на сервер `compose.yml`, `Caddyfile` и `deploy.sh`, чтобы изменения в них тоже доезжали через git, и запускаем деплой с хешем коммита.
4. Проверяем, что `/health` отвечает. Если нет, джоба падает, и GitHub пришлёт письмо.

`concurrency: deploy` не даёт двум деплоям идти одновременно, если вы запушили два коммита подряд.

## Первый деплой

Создаём репозиторий на GitHub, коммитим всё и пушим в `main`.

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

Этот фундамент не изменится до конца цикла. В [следующей части](/blog/ru/automations-queue/) пишем сердце системы: проверку подписей вебхуков, очередь задач в Postgres, воркер с повторами и расписание. После неё к сервису можно будет подключать настоящие автоматизации.
