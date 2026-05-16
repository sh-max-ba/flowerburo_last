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

## Wazzup

Wazzup можно настроить в CRM: `/settings` → вкладка `Wazzup`.

Env-переменные остаются server-side fallback, если ключи еще не сохранены в базе:

```bash
WAZZUP_API_KEY=
WAZZUP_CRM_KEY=
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

Webhook URL:

```text
https://your-domain.com/api/wazzup/webhook
```

В Wazzup нужно включить webhooks:

- `messagesAndStatuses`
- `contactsAndDealsCreation`

Порядок подключения:

1. Вставить Wazzup API key.
2. Сгенерировать CRM key.
3. Подключить webhook.
4. Проверить каналы.
5. Нажать “Синхронизировать пользователей”.
6. В личном кабинете Wazzup назначить пользователям роли и доступ.
7. Нажать “Синхронизировать воронки”.
8. Нажать “Синхронизировать клиентов”.
9. Нажать “Синхронизировать сделки”.
10. Проверить входящее сообщение.

CRM отправляет активных пользователей в Wazzup через `POST /v3/users` с `id` и `name`. Затем администратор Wazzup должен назначить этим пользователям роли и доступ в личном кабинете Wazzup.

Если iframe открывается, но внутри Wazzup показывает “Нет доступа к приложению”, значит CRM-пользователь уже может быть синхронизирован, но роль/доступ в Wazzup ему еще не назначены.

Ручная привязка `chatId` удалена. Новые заявки должны приходить через webhook: обработчик сохраняет raw payload, создает или обновляет клиента, создает открытую сделку с `wazzup_chat_type`, `wazzup_chat_id`, `wazzup_channel_id`, после чего iframe в карточке сделки открывается автоматически.

В `/settings` → `Wazzup` можно:

- сохранить или обновить Wazzup API key;
- сгенерировать CRM key для проверки входящих webhooks;
- скопировать Webhook URL;
- синхронизировать CRM-пользователей в Wazzup и смотреть статусы sync;
- синхронизировать воронки/этапы через `POST /v3/pipelines`;
- синхронизировать клиентов через `POST /v3/contacts`;
- синхронизировать сделки через `POST /v3/deals`;
- проверить API key через `GET https://api.wazzup24.com/v3/channels`;
- проверить локальную готовность webhook endpoint.

Ключи хранятся server-side: в таблице `integration_settings`, либо берутся из env fallback. UI показывает только маску ключей. Iframe не загружается без API key или при выключенной интеграции: карточка покажет состояние “Wazzup не настроен” или “Wazzup выключен”.

## Notes

The app supports warehouse XLSX import/export in production mode. The runtime dependencies include `xlsx` and `exceljs`; they are not dev-only dependencies.

## Wazzup Safety Note

Wazzup iframe и webhook подключены через server-side routes. `WAZZUP_API_KEY` и `WAZZUP_CRM_KEY` должны храниться только server-side и не передаются в client-side code.
