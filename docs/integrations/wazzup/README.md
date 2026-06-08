# Wazzup Integration Documentation

Эта папка содержит исходную документацию Wazzup для будущей интеграции CRM.

## Важные документы

- `Авторизация.md` — авторизация и ключи доступа
- `Auth.md` — auth details, если используется отдельно
- `Webhooks.md` — входящие события от Wazzup
- `Окно чатов (iFrame).md` — подключение окна чатов через iframe
- `Отправка сообщений.md` — отправка сообщений из CRM
- `Работа с контактами.md` — синхронизация и работа с контактами
- `Работа со списком сделок.md` — синхронизация сделок
- `Загрузка воронок продаж.md` — загрузка/передача воронок
- `Работа с каналами.md` — каналы Wazzup
- `Счетчик неотвеченных.md` — счетчики неотвеченных
- `Общие ошибки.md` — ошибки API
- `Сущности API и терминология.md` — термины и сущности
- `Схемы интеграций.md` — варианты интеграционной архитектуры

## Rules for Codex

Перед любой реализацией Wazzup:

1. Прочитать этот README.
2. Прочитать релевантные файлы документации из этой папки.
3. Не придумывать API.
4. Не реализовывать поведение Wazzup по памяти.
5. Если документации не хватает — остановиться и задать вопрос.
6. Секреты и API keys должны использоваться только server-side.
7. Ничего из Wazzup API не должно попадать в client-side code.
8. Webhook handlers должны быть idempotent и сохранять raw payload.

## Planned integration stages

### Stage 1 — Documentation analysis
Сделать технический план интеграции без изменения application code.

### Stage 2 — Wazzup iframe
Подключить iframe/окно чатов в карточку сделки.

### Stage 3 — Webhooks
Добавить endpoint для входящих событий Wazzup.

### Stage 4 — Database models
Добавить сущности Conversation, Message, WebhookEvent, IntegrationAccount, ExternalLink.

### Stage 5 — Message sync
Сохранять входящие сообщения и статусы.

### Stage 6 — Outbound messages
Отправлять сообщения из CRM через Wazzup API.

### Stage 7 — Deals/contacts sync
Синхронизация контактов, сделок, пользователей и воронок.
