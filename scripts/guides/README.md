# Экраны для раздела «Руководства»

Скриншоты в `content/guides/shots/*.webp` и их разметка в `src/lib/guides/shots.ts` (размер кадра и
области, которые подсвечивают шаги) снимаются автоматически по сюжету «один заказ через все роли»:
клиентка пишет в WhatsApp → менеджер оформляет заказ из чата → флорист собирает → менеджер выдаёт →
управляющий принимает товар, списывает, проверяет смены и аналитику.

Съёмка идёт **только в песочнице с обезличенной копией базы** — никогда против рабочего магазина:
сценарий проводит продажи, открывает и закрывает смены, отправляет сообщения.

## Как переснять

```bash
# 1. Песочница: отдельный worktree или копия проекта, node_modules — жёсткими ссылками
git worktree add ../flowerburo_guides_shots polish/xhigh-ui-audit
cd ../flowerburo_guides_shots && cp -al ../flowerburo_last/node_modules node_modules
cp ../flowerburo_last/.env .env   # PORT=3007, NODE_ENV=development, WAZZUP_API_BASE_URL=http://127.0.0.1:3997

# 2. Копия базы и обезличивание (клиенты, телефоны, переписка, имена сотрудников и поставщиков)
sqlite3 ../flowerburo_last/app.db "VACUUM INTO '$PWD/app.db'"
node scripts/guides/make-demo-db.mjs app.db --yes-this-is-a-copy

# 3. Мок Wazzup (никаких реальных сообщений) и dev-сервер
node scripts/guides/wazzup-mock.mjs &
npx next dev -p 3007 -H 127.0.0.1 &

# 4. Съёмка всех этапов по порядку (~15 минут) и проверка ссылок
node scripts/guides/capture.mjs
npx tsx scripts/guides/check-content.ts
```

Отдельные этапы: `node scripts/guides/capture.mjs --only=admin,admin-setup` — состояние базы
должно соответствовать предыдущим этапам (порядок — в `PHASES` в `capture.mjs`).

## Что где

- `make-demo-db.mjs` — обезличивание копии базы; всем пользователям ставит пароль `demo2026`.
- `setup.mjs` — демо-переписка через настоящий вебхук, быстрые ответы, иллюстрации букетов.
- `capture.mjs` — этапы сюжета; каждый `capture(page, id, { область: локатор })` сохраняет кадр
  и доли областей. Если область не видна или обрезана — съёмка падает, а не молча портит кадр.
- `check-content.ts` — все шаги руководств ссылаются на существующие кадры и области.
- Тексты руководств — `src/lib/guides/content/*.ts`. `**Надпись**` в тексте — подпись кнопки.

Кадр доступен только ролям, которым видно его руководство (префикс файла: `florist-`, `manager-`,
`admin-`), — отдаёт его `src/app/api/guides/shots/[file]/route.ts`, а не `public/`.
