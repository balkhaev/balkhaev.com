# Коммерческие автоматизации: код серии

Итоговый код серии статей [«Коммерческие автоматизации»](https://balkhaev.com/blog/ru/series/automations/) ([English](https://balkhaev.com/blog/series/automations/)): заявки, оплаты, поддержка, аналитика и эксплуатация на Bun, TypeScript и Postgres. Статьи показывают только ключевые фрагменты, здесь лежит всё целиком.

The final code of the [Commercial automations](https://balkhaev.com/blog/series/automations/) series: leads, payments, support, analytics and operations on Bun, TypeScript and Postgres. The articles show only the key pieces; everything is here.

## Запуск / Running

```bash
bun install
docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:18
cp .env.example .env   # заполните / fill in
bun src/migrate.ts
bun run dev            # приёмник / intake
bun run worker         # воркер / worker
```

Тесты нужна пустая база / Tests need an empty database:

```bash
docker exec pg createdb -U postgres app_test
DATABASE_URL=postgres://postgres:dev@localhost:5432/app_test bun src/migrate.ts
DATABASE_URL=postgres://postgres:dev@localhost:5432/app_test bun test
```

Переменные для тестов (адреса заглушек и тестовые секреты) перечислены в `.github/workflows/deploy.yml`. / The test variables (stub addresses and test secrets) are listed in `.github/workflows/deploy.yml`.

| Часть / Part | Файлы / Files |
|---|---|
| 2. Фундамент / Foundation | `src/server.ts`, `src/migrate.ts`, `compose.yml`, `Caddyfile`, `deploy.sh`, `Dockerfile` |
| 3. Ядро / Core | `src/queue.ts`, `src/worker.ts`, `src/sources.ts`, `src/schedule.ts`, `src/cli.ts` |
| 4. Продажи / Sales | `src/forms.ts`, `src/leads.ts`, `src/qualify.ts`, `src/crm.ts` |
| 5. Оплаты / Billing | `src/orders.ts`, `src/billing.ts`, `src/yookassa.ts`, `src/pay.ts`, `src/email.ts` |
| 6. Поддержка / Support | `src/support.ts`, `src/triage.ts`, `src/claude.ts`, `kb/` |
| 7. Аналитика / Analytics | `src/metrics.ts`, `src/digest.ts`, `src/alerts.ts` |
| 8. Эксплуатация / Operations | `backup.sh`, `restore-check.sh`, `backup.env.example`, `.env.example` |
