# Flower Ops MVP

## Temporary Production Start

Use production mode for the temporary VPS launch. Do not run the user-facing app with `npm run dev`.

```bash
npm install
npm run build
npm run start
```

By default Next.js starts on `http://localhost:3000`. To use a different port:

```bash
PORT=3001 npm run start
```

## Database

The SQLite database is stored at:

```text
app.db
```

This path is relative to the project root, because the app opens `path.join(process.cwd(), "app.db")`.

SQLite WAL files may also exist next to it:

```text
app.db-wal
app.db-shm
```

`app.db`, `app.db-wal`, `app.db-shm`, and `app.db.backup*` are ignored by git.

## Backup Before Use

Stop the app before copying the database, then run:

```bash
cp app.db "app.db.backup-$(date +%Y%m%d%H%M%S)"
```

If the app is running and WAL files exist, stop the app first so SQLite can checkpoint cleanly.

## Полная очистка перед запуском

Скрипт полной очистки не запускается автоматически. Он требует явное подтверждение через `CONFIRM_RESET=YES`, перед очисткой делает backup `app.db`, сохраняет пользователей, роли и пароли, но очищает сессии, чтобы все вошли заново.

Команда:

```bash
CONFIRM_RESET=YES npm run reset-database-for-launch
```

Перед запуском остановите приложение. Backup будет создан рядом с базой:

```text
app.db.backup-before-launch-reset-YYYY-MM-DD-HH-mm-ss
```

Скрипт очищает операционные таблицы, склад, историю импортов и `sessions`. Таблица `users` не очищается.

## Stop And Restart

If the app was started directly with `npm run start`, stop it with `Ctrl+C` in the same terminal.

If it is running in the background, find and stop the process:

```bash
ps aux | grep "next start"
kill <PID>
```

Restart:

```bash
npm run build
npm run start
```

For a several-day VPS run, use a process manager such as `pm2` or `systemd` so the app restarts after a server reboot.

## Development

Development mode is only for local development:

```bash
npm run dev
```

Production checks:

```bash
npm run lint
npm run build
npm run start
```

## Notes

The app supports warehouse XLSX import/export in production mode. The runtime dependencies include `xlsx` and `exceljs`; they are not dev-only dependencies.

## Wazzup Safety Note

На этапе CRM foundation Wazzup не подключен: нет iframe, webhooks и реальных API-запросов.
Для следующего этапа API keys должны храниться только server-side, iframe нужно получать через server-side route/action, webhooks должны сохранять raw payload, а поведение API нельзя придумывать без актуальной документации Wazzup.
