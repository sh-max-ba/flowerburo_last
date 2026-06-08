# Сводный план выполнения P2-рефакторингов

Документ агрегирует 11 планов P2-рефакторингов проекта FlowerOps, строит граф файловых
конфликтов, задаёт порядок выполнения волнами и фиксирует, что можно делать автономно, а
что требует ручного контроля.

Факты сверены по коду (на момент составления): `src/lib/db.ts` — 5878 строк,
`src/components/backoffice.tsx` — 5796 строк, `src/app/actions.ts` — 858 строк,
`src/lib/crm.ts` — 1258 строк, `src/lib/labels.ts` — 97 строк, `src/lib/page-title.ts` — 78 строк.

Общий гейт для каждого шага каждой задачи: `npx tsc --noEmit` + `next build` (зелёные),
плюс точечная ручная проверка по `verificationNotes` для всего, что трогает деньги/склад/права.

---

## 0. Статус реализации (обновляется по ходу)

- ✅ **Волна 0 — ARCH-9 (A+B):** мёртвый код удалён, `deliveryTypeLabel`/`paymentMethodLabel` дедуплицированы. Часть C (статус-бейджи) отложена.
- ✅ **Волна 1 — ARCH-7, ARCH-6, ARCH-2:** выполнены параллельно (workflow) на непересекающихся файлах. Версионирование схемы, обёртки actions, единый NAV. Матрица ролей сохранена 1:1, `/history` удалён.
- ✅ **Волна 2 — ARCH-3:** общий слой мапперов `src/lib/db-row.ts`; исправлен баг нормализации статуса/deliveryType на CRM-страницах. SQL-алиасы listCustomerOrders/listDealOrders сверены с `mapOrderRow` (camelCase совпадает).
- ⏳ **Волна 3 — PERF-5:** не начато (ручное ревью полноты `paths`).
- ✅ **Волна 4 / ARCH-4:** типизация `*Row` (фазы 1-3) — добавлены кодеки строк + интерфейсы/`rowToX` в `db-row.ts`, заменены «голые» касты в `db.ts`. Поведение не менялось. Гейт зелёный.
- ✅ **Волна 4 / ARCH-8:** `db.ts` (5773 строки) разрезан на баррель + 22 модуля `src/lib/db/*` (connection/types/schema/migrate/seed/form-parsers/mappers/ledger + queries/* + domain/*). Публичный API сохранён 1:1 (113 экспортов), один `let database`. Гейт зелёный + boot вживую: все 12 страниц owner → 200, ошибок в логе нет (read-слой через все модули работает).
- ✅ **Волна 4 / ARCH-5 (zod):** инфра `src/lib/forms/{parse,schemas}.ts`; переведены upsertProduct, createCustomer/updateCustomer, createSale/createOrder/createOrderFromDeal/acceptDealPayment/cashIn/cashOut (скалярная часть). Препроцессоры **переиспользуют `toNumber`/`clean`** (без `coerce`) — семантика парсинга проверена unit-тестом (запятая `"1,5"→1.5`, мусор→0, точные русские ошибки). openShift/closeShift/completePickup/handOrderToCourier/stock-docs оставлены как есть (риск семантики). Gate зелёный + boot.
- ✅ **Волна 4 / ARCH-1 (декомпозиция backoffice.tsx):** монолит полностью удалён.
  - ✅ **ШАГ 1** — settings/users → CrmShell-страницы; закрыт `SEC-5`. `backoffice.tsx` 5741→4446.
  - ✅ **ШАГ 2** — stock/bouquets → CrmShell-страницы. `backoffice.tsx` 4446→~3150. Gate зелёный + boot (все маршруты 200).
  - ✅ **ШАГ 3** — orders/ready-orders → CrmShell-страницы; 5-сек activity-поллер вынесен в остров `OrdersActivityRefresh` (order-shared.tsx); поллер монолита сужён до sales.
  - ✅ **ШАГ 4 (ФИНАЛ)** — касса (sales) → `src/components/cash/cash-page.tsx` + `app/cash/page.tsx` на CrmShell (active="sales", guard `canUseCash`); `/` → `redirect(getDefaultPathForRole)`; sales-поллер живёт в кассовом острове (`OrdersActivityRefresh`); **`backoffice.tsx`/`backoffice-route.tsx` удалены**. ⚠️ Требует ручного ре-теста денег (харнесс не триггерит onSubmit-формы).
- ⏳ Не начато: `PERF-5`, `ARCH-9` часть C, `PERF-6` (no-op).
- ℹ️ **PERF-6:** по факту no-op (страницы остаются динамическими из-за `cookies()` в `requireUser`) — низкий приоритет.

Гейт после каждой волны (`npm run lint`, `npx tsc --noEmit`, `npm run build`) — зелёный.

---

## 1. Сводка-таблица

| id | Название | risk | effort | safeForAuto | Конфликтует с |
|----|----------|------|--------|-------------|---------------|
| **ARCH-9** | Удалить мёртвый код + консолидировать дубликаты лейблов (deliveryTypeLabel + статус-бейджи) | low | M | ✅ true | ARCH-8, ARCH-1, ARCH-2, ARCH-3, ARCH-4, ARCH-5, ARCH-6, ARCH-7, PERF-5, PERF-6 |
| **ARCH-7** | Версионирование схемы через PRAGMA `user_version` (нумерованные шаги поверх идемпотентного migrate) | low | M | ✅ true | ARCH-8, ARCH-3, PERF-6 |
| **PERF-6** | Снять лишний `force-dynamic` (косметика; реального кэширования без инфраструктуры не достичь) | low | S | ❌ false | PERF-5, ARCH-2 |
| **ARCH-3** | Единый слой row→domain мапперов (db.ts ↔ crm.ts), фикс расхождения нормализации статуса заказа | medium | M | ✅ true | ARCH-4, ARCH-8, ARCH-1 |
| **ARCH-2** | Единый конфиг NAV: один источник навигации/ролей/заголовков вместо 4-5 копий | medium | M | ✅ true | ARCH-1, ARCH-6, PERF-5, ARCH-9 |
| **ARCH-6** | `runDataAction` обёртка для единообразной обработки ошибок в server actions | medium | M | ✅ true | ARCH-2, ARCH-5, PERF-5, ARCH-1, ARCH-3 |
| **PERF-5** | Точечная `revalidatePath` вместо безусловного веера по 9 путям в `runAction` | medium | M | ❌ false | ARCH-5, ARCH-6, ARCH-2, ARCH-9 |
| **ARCH-4** | Типизированный слой row→domain: интерфейсы `*Row` под алиасы SELECT + функции `rowToX` | medium | XL | ❌ false | ARCH-3, ARCH-8, ARCH-7, PERF-5, PERF-6 |
| **ARCH-5** | zod-валидация входов server actions | high | L | ❌ false | ARCH-3, ARCH-4, ARCH-8, ARCH-6 |
| **ARCH-8** | Разделение god-модуля db.ts (5878 строк) на schema/migrate/queries/domain/forms с сохранением барреля `@/lib/db` | high | XL | ❌ false | ARCH-3, ARCH-7, ARCH-5, PERF-5, PERF-6 |
| **ARCH-1** | Декомпозиция монолита backoffice.tsx (~5800 строк) на RSC-страницы + клиентские острова | high | XL | ❌ false | ARCH-2, ARCH-9, PERF-5, PERF-6 |

Итого: **11 задач**. safeForAuto=true: 5 (ARCH-9, ARCH-7, ARCH-3, ARCH-2, ARCH-6). safeForAuto=false: 6 (PERF-6, PERF-5, ARCH-4, ARCH-5, ARCH-8, ARCH-1).

---

## 2. Граф конфликтов по файлам

Задачи, делящие один и тот же файл, **нельзя делать параллельно** (мерж-конфликты + сдвиг
номеров строк, на которые опираются approach'и). Ниже — кто за какой файл «держится».

### `src/lib/db.ts` — самый горячий файл (8 задач)
ARCH-9, ARCH-7, ARCH-3, ARCH-4, ARCH-5, ARCH-8 — все правят db.ts напрямую.
- **ARCH-8** — самая инвазивная (разрезает весь файл на дерево `src/lib/db/*`). После неё номера строк всех остальных db-задач становятся невалидны.
- **ARCH-3 / ARCH-4** — оба строят row→domain слой (ARCH-3 = выделение мапперов в `db-row.ts`, ARCH-4 = типизация `*Row` + codecs). Сильно пересекаются по `numberFromRow`/`cleanRowString`/`normalizeOrderStatus`/`mapOrder`/`mapProduct`. Делать строго последовательно, ARCH-3 → ARCH-4.
- **ARCH-7** — добавляет `user_version`-раннер в `migrate()`. Конфликтует с ARCH-8 (которая выносит `migrate` в `db/migrate.ts`).
- **ARCH-5** — zod в доменных функциях db.ts (upsertProduct, createSale, createOrder...). Конфликтует с ARCH-3/ARCH-4 (общий слой парсинга) и ARCH-8 (перемещение функций).
- **ARCH-9** — удаляет мёртвый код в db.ts (`replenishProductStock`/`writeOffProductStock`/`adjustProductStock`/`createStockDocumentDraft`).

**Правило:** в db.ts одновременно — только одна задача. Порядок: ARCH-9 → ARCH-7 → ARCH-3 → (ARCH-4) → ARCH-8 → (ARCH-5). ARCH-8 переупорядочивает весь файл — всё, что хотим сделать «по строкам», делаем ДО неё.

### `src/app/actions.ts` (4 задачи)
ARCH-9, ARCH-6, PERF-5, ARCH-5.
- **ARCH-6** — вводит `runDataAction`/`runMessageAction` обёртки (рефакторинг try/catch).
- **PERF-5** — меняет сигнатуру `runAction`/`runRoleAction`/`runCashAction` (добавляет параметр `paths`).
- ARCH-6 и PERF-5 **оба меняют обёртки** → строго последовательно. Рекомендуется PERF-5 после ARCH-6 (или наоборот), но не параллельно.
- **ARCH-9** — удаляет импорты `replenishProductStock`/`writeOffProductStock` и экшены `replenishProductStockAction`/`writeOffProductStockAction`.
- **ARCH-5** — формально не меняет actions.ts (валидация в доменных функциях), но `parseBouquetTemplateFormData` (actions.ts:106) опционально переводится на schema.

### `src/components/backoffice.tsx` (4 задачи)
ARCH-9, ARCH-2, ARCH-1.
- **ARCH-1** — полностью демонтирует монолит (удаляет `Backoffice`/`BackofficeRoute`). Самая разрушительная для этого файла.
- **ARCH-2** — удаляет локальные `sections`/`sectionGroups`/`roleSectionIds`/`Section` и переключает на `@/lib/nav`.
- **ARCH-9** — удаляет локальный `deliveryTypeLabel`, дедуп `OrderBadge`/`ReadyStatusBadge`.
- Все три трогают одни и те же области (NAV-блоки, бейджи, лейблы) → последовательно: ARCH-9 → ARCH-2 → ARCH-1 (ARCH-1 в самом конце, поверх вычищенного файла).

### `src/lib/crm.ts` (3 задачи)
ARCH-3, ARCH-4, ARCH-8. Те же row-мапперы (`mapCustomer`/`mapDeal`/inline Order-мапперы, `clean`/`toNumber`). Последовательно: ARCH-3 → ARCH-4 → ARCH-8.

### `src/lib/page-title.ts` (2 задачи)
ARCH-2 (читает `NAV_BY_HREF`), ARCH-1 (обновляет при удалении секций). ARCH-2 → ARCH-1.

### `src/lib/labels.ts` (1 задача)
Только ARCH-9 (добавляет `deliveryTypeLabel`-канон, `orderStatusBadgeVariant`, удаляет алиас `paymentMethodLabel`).

### Страницы `src/app/**/page.tsx` (3 задачи)
- **PERF-6** — снимает `force-dynamic` с 22 page.tsx.
- **ARCH-2** — удаляет `src/app/history/page.tsx` (осиротевший маршрут).
- **ARCH-1** — переписывает `settings/users/stock/cash/orders/ready-orders/page.tsx` на `CrmShell`.
- PERF-6 трогает строку `export const dynamic` во всех 22; ARCH-1 переписывает 6 из них. Делать PERF-6 ДО ARCH-1 либо аккуратно совместить (PERF-6 — тривиальное удаление строки).

### Сводный матрикс «нельзя параллельно» (общий файл)
```
db.ts          : ARCH-9 · ARCH-7 · ARCH-3 · ARCH-4 · ARCH-5 · ARCH-8
actions.ts     : ARCH-9 · ARCH-6 · PERF-5 · (ARCH-5)
backoffice.tsx : ARCH-9 · ARCH-2 · ARCH-1
crm.ts         : ARCH-3 · ARCH-4 · ARCH-8
page-title.ts  : ARCH-2 · ARCH-1
page.tsx (app) : PERF-6 · ARCH-2 · ARCH-1
```

### Файл-disjoint пары (можно параллелить)
- **ARCH-7** (только db.ts) ⟂ **ARCH-2** (nav/shell/page-title) — НЕТ общих файлов → можно параллельно.
- **ARCH-7** (db.ts) ⟂ **ARCH-6** (actions.ts) — disjoint → параллельно.
- **ARCH-3** (db.ts + crm.ts + db-row.ts) ⟂ **ARCH-6** (actions.ts) — disjoint → параллельно.
- **ARCH-3** (db.ts/crm.ts) ⟂ **ARCH-2** (nav/shell) — disjoint → параллельно.
- ВНИМАНИЕ: **ARCH-9** трогает db.ts + actions.ts + backoffice.tsx + labels.ts + deal-detail-page.tsx — он пересекается практически со всеми, поэтому идёт ПЕРВЫМ и в одиночку.

---

## 3. Рекомендованный порядок выполнения (волнами)

Принцип: сначала безопасные быстрые победы (low-risk, safeForAuto), затем medium-рефакторинги
по непересекающимся файлам параллельно, крупные XL/high-risk (ARCH-4, ARCH-5, ARCH-8, ARCH-1) —
в конце, отдельными большими этапами под ручным контролем. Каждая задача = серия коммитов
за build-гейтом.

### Волна 0 — Зачистка (одиночно, первым). ARCH-9
- **Почему первым:** ARCH-9 пересекается с 10 из 11 задач (db.ts, actions.ts, backoffice.tsx, labels.ts). Удаление мёртвого кода и консолидация лейблов уменьшает поверхность конфликтов для всех последующих волн. Risk low, safeForAuto.
- Делать в одиночку, без параллели.

### Волна 1 — Быстрые победы + первые непересекающиеся medium (параллельно)
После ARCH-9. Три задачи на **непересекающихся** файлах — можно вести параллельно (разные ветки):
- **ARCH-7** — db.ts (только migrate / user_version). low risk.
- **ARCH-2** — nav.ts/nav-icons.tsx/crm-shell/backoffice-route/page-title + удаление history/page.tsx. medium.
- **ARCH-6** — actions.ts (обёртки). medium.
- **PERF-6** — 22 page.tsx (удаление `force-dynamic`). low, но safeForAuto=false (требует ручной сверки вывода `next build`: все маршруты должны остаться `ƒ` dynamic). Можно вести параллельно с ARCH-7/ARCH-6, но НЕ параллельно с ARCH-2 (та трогает `history/page.tsx`).

  Конфликты внутри волны: ARCH-2 и PERF-6 оба трогают `src/app/history/page.tsx` → их сериализовать (PERF-6 не трогает history, если ARCH-2 его удаляет; согласовать: сначала PERF-6 по 21 файлу, ARCH-2 удаляет history последним). ARCH-7 ⟂ ARCH-2 ⟂ ARCH-6 — полностью disjoint.

### Волна 2 — Row-слой (одиночно, db.ts/crm.ts). ARCH-3
- После ARCH-7 (обе в db.ts). ARCH-3 создаёт `src/lib/db-row.ts`, чинит 2 бага CRM (нормализация статуса, deliveryType default). medium risk, safeForAuto.
- НАМЕРЕННОЕ изменение поведения CRM (фикс): легаси-статусы `new/in_progress/...` теперь рендерятся русскими на карточках клиента/сделки.

### Волна 3 — PERF-5 (одиночно, actions.ts). PERF-5
- После ARCH-6 (обе в actions.ts; ARCH-6 меняет обёртки, PERF-5 тоже — строго последовательно). medium, **safeForAuto=false** — требует ручного ревью ПОЛНОТЫ списков `paths` для денежных/складских/заказных экшенов.

### Волна 4 — Крупные XL-рефакторинги (отдельными большими этапами, последовательно, ручной контроль)
Порядок внутри волны диктуется конфликтами по db.ts/crm.ts/backoffice.tsx:
1. **ARCH-4** (XL, medium) — типизация `*Row`. После ARCH-3 (общий row-слой). Пофазно (4 фазы), UI-прогон после каждой.
2. **ARCH-8** (XL, high) — разрез db.ts на `src/lib/db/*`. После ARCH-3/ARCH-4/ARCH-7 (все правки «по строкам» db.ts завершены). Самый инвазивный для db.ts/crm.ts. По одному домену на коммит, деньги/склад/заказы — последними.
3. **ARCH-5** (L, high) — zod. После ARCH-3/ARCH-4/ARCH-8 (общий слой парсинга стабилизирован). Строго по одному action на коммит, денежные — с ручной проверкой граничных входов.
4. **ARCH-1** (XL, high) — декомпозиция backoffice.tsx. После ARCH-2 (NAV) и ARCH-9 (лейблы). Lift-and-shift по шагам: settings/users → stock/bouquets → orders/ready-orders → cash (деньги — последними). ARCH-1 финализирует backoffice.tsx, поэтому идёт после всех остальных backoffice-задач.

   ARCH-8 (db.ts) ⟂ ARCH-1 (backoffice/app) — файл-disjoint, теоретически параллелятся, но оба high-risk XL → рекомендуется НЕ вести одновременно (когнитивная нагрузка, общий риск регрессии денег/склада). Если ресурсы есть — допустимо в разных ветках.

### Сводная диаграмма волн
```
Волна 0:  ARCH-9
Волна 1:  ARCH-7  ||  ARCH-2  ||  ARCH-6  ||  PERF-6      (disjoint; PERF-6/ARCH-2 сериализовать по history/page.tsx)
Волна 2:  ARCH-3                                          (после ARCH-7; db.ts/crm.ts)
Волна 3:  PERF-5                                          (после ARCH-6; actions.ts)
Волна 4:  ARCH-4  →  ARCH-8  →  ARCH-5  →  ARCH-1         (крупные, последовательно, ручной контроль)
```

---

## 4. Задачи: approach (сжато) + verificationNotes

### ARCH-9 — Мёртвый код + дедуп лейблов
**Файлы:** actions.ts, db.ts, labels.ts, backoffice.tsx, deals/deal-detail-page.tsx.
**Approach:**
- A. Мёртвый код: удалить `replenishProductStockAction`/`writeOffProductStockAction` (actions.ts:620-626) + их импорты `replenishProductStock`(61)/`writeOffProductStock`(74); удалить `replenishProductStock`/`writeOffProductStock` (db.ts:4180-4186) и осиротевший `adjustProductStock` (db.ts:4138-4178); удалить `createStockDocumentDraft` (db.ts:4427-4430, не трогать `saveStockDocumentDraft`); удалить алиас `paymentMethodLabel` (labels.ts:27).
- B. `deliveryTypeLabel`: удалить локальный в backoffice.tsx (5740-5742), импортировать из labels.ts (расширить import стр. 102); в deal-detail-page.tsx (2087-2089) заменить тело на реэкспорт-делегацию из labels.ts (импорт стр. 33), `deliveryOptions` НЕ удалять (нужен для `<Select>`).
- C. Статус-бейджи: добавить в labels.ts `orderStatusBadgeVariant(status)` (маппинг status→{variant,className,icon}), `OrderStatus` в `import type`; `OrderBadge` (5663-5678)/`ReadyStatusBadge` (5680-5690) читают маппинг из labels.ts (JSX с `CheckCircle2Icon` НЕ переносить).

**verificationNotes:** финальный grep по именам удаляемых функций перед коммитом (динамических вызовов в проекте нет, server actions зовутся напрямую). Удаление недостижимо → деньги/права/склад не затронуты. Визуально сверить `deliveryTypeLabel` на карточке сделки (Самовывоз/Доставка, fallback пустого = Самовывоз) и бейджи (Выдан/Отменен/Готов/Передан курьеру/дефолт) на дашборде и `/ready-orders`. Проверить отсутствие неиспользуемых импортов после удаления `adjustProductStock`.

---

### ARCH-7 — Версионирование схемы (PRAGMA user_version)
**Файлы:** db.ts.
**Approach:** аддитивно, без переписывания `ensureColumn`. В начале `migrate(client)` (после 546) читать `fromVersion = client.pragma("user_version", {simple:true})`. Вынести текущее тело 547-1255 в `migrateBaseline(client)` (cut/paste) = version 1. Завести `type Migration = {version; up}` + `const MIGRATIONS: Migration[]` внутри db.ts. Тело `migrate` = раннер: сортировка по version, для `m.version > fromVersion` — `client.transaction(() => { m.up(client); client.pragma('user_version = '+m.version) })()`. `seedDefaultDealPipeline` (1255) оставить ПОСЛЕ раннера (это сид, не DDL). Импорты не трогать.

**verificationNotes:** НЕ менять `orders.status DEFAULT 'new'` (db.ts:645) в baseline без согласованной с ARCH-3 миграции данных (иначе вставки с опущенным status начнут писать иной дефолт). `user_version` выставлять внутри транзакции каждого шага. Свежая БД → `user_version = max`; копия старой (`user_version=0`) → migrate проходит без «duplicate column», повторный запуск — no-op. Всё DDL аддитивно.

---

### PERF-6 — Снять лишний force-dynamic
**Файлы:** 22 page.tsx (page/users/settings/bouquets/stock/orders/cash/ready-orders/deals(+[id])/clients(+[id])/shifts(+[id])/history(+stock)/warehouse-imports(+[id])/stock-acts(+[id]+edit)/login).
**Approach:** удалить строку `export const dynamic = "force-dynamic"` (с окружающей пустой строкой) из всех 22 файлов. Это **no-op для рантайма**: все страницы остаются dynamic из-за `cookies()` в `requireUser()`/`getSidebarDefaultOpen()` (Next 16 без `cacheComponents`). `force-static` применить НЕЛЬЗЯ (сломает auth). Реального выигрыша без `unstable_cache`/`revalidateTag` или `cacheComponents` не будет — это пересечение с PERF-5/архитектурой и отдельная задача.

**verificationNotes:** build-гейт НЕ ловит регрессию. Обязательна ручная сверка вывода `next build`: все 22 маршрута должны остаться `ƒ` (dynamic), НИ ОДИН не должен стать `○` (static). Залогиниться, открыть /users,/settings,/bouquets,/cash — данные актуальны на каждый заход; мутация (напр. активность букета) → соседние страницы свежие; `requireUser` редиректит на /login. Главный риск — ложный сигнал «оптимизация сделана», которой нет.

---

### ARCH-3 — Единый слой row→domain мапперов
**Файлы:** db.ts, crm.ts; новый `src/lib/db-row.ts`.
**Approach:**
- ШАГ 1: создать `db-row.ts` (leaf-модуль): `import type {Order,OrderStatus,Product,OrderItem} from "@/lib/db"` (type-only, без runtime-цикла) + `import {normalizeDiscountType} from "@/lib/pricing"`. Перенести `numberFromRow` (db.ts:1826), `cleanRowString` (1822), `normalizeOrderStatus` (1831, legacy-карта). Добавить `mapOrderRow(row, items=[]): Order` (тело из db.ts mapOrder 3140-3178; `deliveryType: cleanRowString(row.deliveryType) || "pickup"`; `status: normalizeOrderStatus(row.status)`) и `mapProductRow` (db.ts:1883). НЕ трогать FormData-`toNumber`(1802)/`clean`(1818) — у них `replace(",",".")/trim` для денег.
- ШАГ 2: db.ts — удалить локальные `numberFromRow`/`cleanRowString`/`normalizeOrderStatus`/`mapProduct`, импортировать из db-row; `orderRows.map(...)` → `mapOrderRow(row, itemsByOrder.get(...)??[])`; все `mapProduct`→`mapProductRow`.
- ШАГ 3: crm.ts — `import {mapOrderRow}`; заменить inline-мапперы `listCustomerOrders` (285-321) и `listDealOrders` (352-388) на `rows.map(row => mapOrderRow(row))`. Это чинит оба бага. Локальные `clean`/`toNumber`/`clampPercent` (1247-1258) оставить. `listProducts.mapProduct` (133-148) оставить (другие SQL-алиасы; остаточный дубль для ARCH-4).
- ШАГ 4: SQL — `COALESCE(delivery_type,'')` → `COALESCE(delivery_type,'pickup')` в crm.ts:263 и 330.

**verificationNotes:** (1) НАМЕРЕННЫЙ фикс: на CRM-страницах легаси-статусы → русские, пустой deliveryType → pickup; открыть клиента/сделку со старым заказом (`status='new'`), сверить с дашбордом. (2) НЕ объединять FormData-`toNumber` с row-`numberFromRow` (изменит запись денег). (3) `crm.toNumber(x)=Number(x) ≡ numberFromRow` — суммы списков не регрессируют. (4) `deliveryPayoutPaid`/`isReserved` для 0/1 эквивалентны. (5) grep `mapProduct` по db.ts — все вызовы → `mapProductRow` (tsc поймает). Цикла импортов нет (type-only стирается компилятором).

---

### ARCH-2 — Единый конфиг NAV
**Файлы:** crm-shell.tsx, backoffice.tsx, backoffice-route.tsx, page-title.ts, history/page.tsx; новые `src/lib/nav.ts`, `src/lib/nav-icons.tsx`.
**Approach:**
- ШАГ 1: `nav.ts` (без `"use client"`, без lucide): `NavSectionId`, `NavGroupId`, `NavItem` (с `iconKey: string`, НЕ компонентом), `const NAV: NavItem[]`, `NAV_GROUPS`, `NAV_BY_ID`, `NAV_BY_HREF`, `getNavForRole(role,{canAccessCash})`, `canAccessSection(section,role,canAccessCash)`. roles консервативно из объединения текущих (deals/clients/bouquets=[owner,manager], sales=[owner,manager,florist via cash], orders=[owner,manager,florist], ready-orders=[owner,manager], stock/stock-acts/history/shifts/settings=[owner]). Согласовать дрейф: `history.href="/history/stock"`, `sales.iconKey="cash"`.
- ШАГ 2: `nav-icons.tsx` (`"use client"`): `NAV_ICONS: Record<string, LucideIcon>` по iconKey.
- ШАГ 3: page-title.ts — `routeTitles`/`routeContexts` → чтение `NAV_BY_HREF[path]?.title/.context`; динамические regex-ветки (/deals/:id и т.д.) оставить; убрать запись `/history`.
- ШАГ 4: crm-shell.tsx — удалить локальные `navItems`(73-91)/`navGroups`(93-98), импортировать `NAV_GROUPS`/`getNavForRole`/`NAV_ICONS`; `CrmSection`→`NavSectionId`.
- ШАГ 5: backoffice.tsx — удалить `sections`(255-267)/`sectionGroups`(269-274)/`roleSectionIds`(284-300)/`Section`(213-224); `visibleSectionIds`(528-531)→`getNavForRole(...)`; сайдбар через `NAV_GROUPS`+`NAV_ICONS`. Сохранить реэкспорт `export type Section = NavSectionId`.
- ШАГ 6: backoffice-route.tsx — удалить локальный `canAccessSection`(37-58), импортировать из nav.
- ШАГ 7: удалить `src/app/history/page.tsx` (дубль; канон `/history/stock`); НЕ трогать `history/export/route.ts`.

**verificationNotes:** build-гейт ловит рассинхрон типов, но НЕ дрейф прав. Ручная проверка матрицы видимости сайдбара для 3 ролей в ОБЕИХ оболочках (owner=всё; manager=CRM+Работа, без stock/stock-acts/history/shifts/settings; florist=только orders, +Касса при открытой ночной смене — главный риск регрессии прав). `canAccessSection` даёт тот же результат. Нет висящих ссылок `/history`. Иконка Кассы в CrmShell может смениться (косметика). Заголовки топбара не должны стать пустыми. Per-action roles в actions.ts — ВНЕ скоупа.

---

### ARCH-6 — runDataAction обёртка
**Файлы:** actions.ts.
**Approach:**
- ШАГ 1: добавить `runDataAction<T>(roles, fn, message, errorMessage?)` после ~210 (auth+try/catch+форма `DataActionResult<T>`). `revalidatePath` НЕ встраивать (оставить внутри `fn` — у экшенов узкие наборы путей).
- ШАГ 2: перевести 4 data-экшена: `getSecureWazzupWebhookUrlAction`(256-271), `createCashCustomerAction`(484-513, успех «Клиент создан» без точки), `previewWarehouseImportAction`(709-740), `applyWarehouseImportAction`(742-762). `revalidate` — внутри fn; убрать `satisfies`-касты.
- ШАГ 3: вторая обёртка `runMessageAction(roles, fn, errorMessage, {revalidate=true})` для message-only Wazzup-экшенов (test/sync/check/connect). `checkWazzupChannelsAction`(348) — `revalidate:false` (в оригинале не ревалидирует /settings).
- ШАГ 4: НЕ трогать `runAction`/`runRoleAction`/`runCashAction`; `sendBouquetToDealChatAction`(565) — вне scope.

**verificationNotes:** build-гейт ловит почти всё (публичные сигнатуры `DataActionResult<T>`/`ActionResult` сохранены 1:1; backoffice завязан на `result.data.url`, `'data' in result && result.data`, `CustomerCreateResult=Awaited<ReturnType>`). Ручное: (1) НЕ заменять узкие `revalidatePath` на 9-путёвый веер. (2) Сохранить точные тексты ошибок через `errorMessage` ('CRM key не настроен.', 'Клиент не создан.', 'Не удалось прочитать XLSX.', 'Импорт не применен.'). (3) Успех «Клиент создан» без точки. (4) `requireActionRole` ДО бизнес-логики. (5) `checkWazzupChannelsAction` — без лишнего revalidate. Функционально: создание клиента из кассы, preview+apply импорта, копирование webhook URL, ошибочные ветки (нет прав / битый файл).

---

### PERF-5 — Точечная revalidatePath
**Файлы:** actions.ts.
**Approach:**
- ШАГ 1: добавить обязательный параметр `paths: string[]` в `runAction` (149-189), `runRoleAction`(191-200), `runCashAction`(202-210); вместо безусловного веера (155-163) — `for (const p of paths) revalidatePath(p)` ПОСЛЕ успешного `await action()`.
- ШАГ 2: завести константы групп путей рядом с `revalidateCrm`(459-468): `SHELL_PATHS`=["/","/clients","/deals","/history/stock","/stock/acts","/shifts"] (страницы с шапкой смены) — только для shift-мутаций.
- ШАГ 3: проставить `paths` на каждом call-site (ядро задачи): букеты→["/bouquets","/deals"]; товары/категории→["/","/stock","/cash","/orders","/deals"]; склад-документы→["/stock"]+точечные; Wazzup/поставщики→["/settings"]; пользователи→["/users"]; смены→`SHELL_PATHS`+["/cash","/shifts"]; касса→["/cash","/shifts","/"](+склад для createSale); заказы→различные комбинации orders/ready-orders/"/"/stock/cash/shifts/deals (см. план); CRM-экшены через `revalidateCrm`→`paths:[]`.
- ШАГ 4: явно зашить `/deals` в мутации товаров/букетов (фикс рассинхрона CRM — карточка сделки показывала старую цену товара).

**verificationNotes:** build-гейт ловит только наличие `paths`, НЕ полноту списков. Главный риск — недо-ревалидация (устаревшие деньги/остатки/статусы до F5). Ручные сценарии: (1) продажа → `/` и `/shifts` показывают новый expectedCash без F5; (2) markOrderReady → `/ready-orders` бейдж и `/stock` остаток; (3) cancelOrder оплаченного → `/cash`/`/shifts` отражают cash_refund (пересечение с P0 BL-1); (4) смена цены/остатка товара → `/deals/[id]` и `/deals` свежие; (5) закрытие смены → шапка смены исчезла на всех shell-страницах. Параметрические `[id]`-ревалидации (`revalidateCrm`, stock/acts/{id}) сохранить дословно. Полнота денежных/складских списков — ручное ревью человеком → **safeForAuto=false**. Смежно: products/bouquets `image route.ts` дублируют веер — держать согласованными.

---

### ARCH-4 — Типизированный слой *Row + rowToX
**Файлы:** db.ts, crm.ts; новые `src/lib/db/row-codecs.ts`, `src/lib/db/rows.ts`.
**Approach (4 фазы, каждая = коммит за build-гейтом):**
- Фаза 1 (S, safe): `row-codecs.ts` — `rowStr` (БЕЗ trim! текущий `String(x??"")` не тримит), `rowNum` (тело numberFromRow), `rowNumOrNull`, `rowBool` (`Number(x??0)===1`). db.ts: `numberFromRow` → реэкспорт `rowNum` (алиас, не трогая 193 вызова). crm.ts: row-`toNumber`→`rowNum` (сперва отделить от FormData-вариантов среди 124 вызовов).
- Фаза 2 (M, safe): `rows.ts` — интерфейсы под алиасы проблемных «голых» кастов: `SaleRow`/`SaleItemRow`/`MovementRow`/`CustomerOptionRow`/`ShiftRelatedOrderRow`/`OrderItemRow`/`ShiftRow`/`DealStageRow`. Заменить `.all() as Sale[]`→`as SaleRow[]`+`.map(rowToSale)`. Начать с db.ts:3049 (dashboard sales — раньше без ремаппинга).
- Фаза 3 (M, safe): 10 map-функций db.ts + 2 crm.ts → типизированный вход `(row: XxxRow)`. Внимание на смешение camelCase (mapShift: openedAt/openingCash) vs snake_case (mapProduct: cost_price). Тела не менять.
- Фаза 4 (L, опционально, НЕ авто): zod поверх `*Row` (пересечение с ARCH-5).

**verificationNotes:** build-гейт ловит несоответствие `*Row` алиасам (главная ценность), НЕ семантику. (1) db.ts:3049 — сверить числа до/после (better-sqlite3 для REAL отдаёт number; `itemsCount` от COUNT() проверить тип). (2) `rowStr` НЕ тримит (иначе изменятся note/customerName в чеках). (3) crm.toNumber используется и для row, и для FormData — не заменять слепо. (4) Деньги/склад: mapProduct.available, mapShift summary, order/sale totals — сверить чек/смену/заказ на тестовых данных. (5) Легаси-статусы — нормализация остаётся в rowToOrder. Высокий объём → делать пофазно с UI-прогоном.

---

### ARCH-5 — zod-валидация входов
**Файлы:** db.ts, crm.ts, actions.ts; новые `src/lib/forms/schemas.ts`, `src/lib/forms/parse.ts`.
**Approach:** валидация живёт в доменных функциях (НЕ в обёртках), сигнатуры (`formData: FormData`) сохраняются.
- Шаг 0 (инфра): `schemas.ts`+`parse.ts` с `formDataToObject(fd,{arrayKeys?})` и `zNum/zMoney/zTrimmed`-препроцессорами, воспроизводящими `clean()/toNumber()` 1:1 (`String(v??'').replace(',','.').trim()`; `Number.isFinite?n:0`; пустое→0).
- Шаг 1 (пилот): `upsertProduct` (db.ts:3947) → `ProductInputSchema.parse(formDataToObject(fd))`, русские тексты ошибок через message/errorMap.
- Шаг 2 (crm): `createCustomer`(192)/`updateCustomer`(203); схемы в общий forms/schemas; `clean`/`toNumber` crm НЕ удалять (пересечение ARCH-3/ARCH-4).
- Шаг 3 (деньги/склад, по одному коммиту + ручная проверка): createSale/createOrder/createOrderFromDeal/acceptDealPayment/openShift/closeShift/cashIn/cashOut/completePickupOrder/handOrderToCourier/createAndPostStockDocument/saveStockDocumentDraft. zod покрывает ТОЛЬКО скалярную часть; позиции (buildSaleItems/buildOrderItems, параллельные массивы getAll) и чтения БД (getProduct/resolveCashCustomer) остаются в транзакции.

**verificationNotes:** build-гейт НЕ ловит главное: (1) семантика парсинга — наивный `z.coerce.number()` даст NaN на '1,5'/'' (вместо 0) → молча испортит цены; обязателен препроцессор 1:1 + юнит-сравнение на '', '1,5', 'abc', '  5 ', '-3'. (2) Тексты ошибок ZodError по умолчанию англоязычные — сохранить русские, runAction должен отдать первый `issue.message`, не 'Операция не выполнена.'. (3) Параллельные массивы позиций (мульти- и одиночная). (4) Денежные инварианты (prepaid<=total, неотрицательность, requireOpenShift, enforceAvailable) остаются в транзакции, НЕ в схеме. Ручное: товар (граничные цены), продажа (моно/мульти, cash/card), заказ с предоплатой и доставкой, отмена оплаченного, открытие/закрытие смены. Строго по одному action на коммит → **high risk, safeForAuto=false**.

---

### ARCH-8 — Разрез god-модуля db.ts
**Файлы:** db.ts, crm.ts; ~24 новых под `src/lib/db/*` (index/connection/types/schema/migrate/seed/mappers/form-parsers/ledger + queries/* + domain/*).
**Approach:** разрезать db.ts на дерево, СОХРАНИВ публичный `@/lib/db` через barrel `index.ts` (39 импортёров не трогать). Чисто механический copy/paste тел.
- Шаг 0: `types.ts` (все `export type` 15-486 + Set-константы), `connection.ts` (`dbPath`/`csvPath`, `let database`, `db()`, `initDb()`).
- Шаг 1: `schema.ts` (`migrate` 546-1257 + `ensureColumn`), `migrate.ts` (реэкспорт, точка для ARCH-7), `seed.ts` (seedDefaultDealPipeline/seedDefaultUsers/seedFromCsv/parseCsv).
- Шаг 2 (критический общий слой): `form-parsers.ts` (toNumber/clean/numberFromRow/parsePaymentMethod/...), `mappers.ts` (mapUser/mapProduct/mapWarehouseImport/... + normalize*), `ledger.ts` (recordCashTransaction/recordStockMovement/addMovement/applyProductDelta(enforceAvailable BL-3)/getProduct). ВНИМАНИЕ: `mapShift`→`shifts.ts` (зависит от calculateShiftSummary, иначе цикл).
- Шаг 3 (домены, по одному коммиту, по возрастанию связности): queries/{users,suppliers,products,bouquets,cash,shifts,sales,stock-documents,warehouse,dashboard,history}.ts; domain/order-lifecycle.ts (createOrder/markOrderReady/cancelOrder BL-1...), domain/deal-orders.ts (createOrderFromDeal/acceptDealPayment BL-6/BL-7).
- Шаг 4: переименовать остаток db.ts → `db/index.ts` с barrel-реэкспортом РОВНО текущего публичного набора (сверить `grep ^export` до/после).
- Шаг 5 (опц., в рамках ARCH-3): дедуп crm.ts clean/toNumber.

**verificationNotes:** build-гейт НЕ ловит регрессии денег (refund/applyOrderPayment/acceptDealPayment/recordCashTransaction BL-1/BL-2), склада (applyProductDelta/markOrderReady/applyWarehouseImport BL-3/BL-4), прав (assertCanDemoteOrDisableUser/countActiveOwners), смен (requireOpenShift/calculateShiftSummary). Риски переноса: (1) циклы queries↔ledger↔mappers (mapShift→calculateShiftSummary — решается порядком и размещением mapShift в shifts.ts); (2) потеря приватности (локальная→export, build поймает забытый экспорт, но не лишний); (3) `db()` singleton — `let database` ровно в одном месте; (4) границы `client.transaction()` целиком в своём домене. Ручной прогон: открыть/закрыть смену, создать+собрать+отменить оплаченный заказ (cash_refund + сток), заказ из сделки, импорт склада, продажа с проверкой остатка. По одному домену на коммит, деньги/склад — последними → **high risk, safeForAuto=false**.

---

### ARCH-1 — Декомпозиция монолита backoffice.tsx
**Файлы:** backoffice.tsx, backoffice-route.tsx, page-title.ts + 6 app/page.tsx; ~21 новый компонент (settings/stock/cash/orders/backoffice-shared).
**Approach:** убрать «клиентский роутинг поверх App Router» (setSection+router.push). Образец — /shifts → CrmShell + ShiftsPage. По убыванию безопасности, каждый шаг = коммит, lift-and-shift.
- Шаг 0: `backoffice/backoffice-shared.tsx` — чистые leaf-хелперы/компоненты (даты/сортировки 326-482, ResponsiveTable/Info/StockBadge/OrderBadge/ReadyStatusBadge/OrderComposition, deliveryTypeLabel из labels.ts per ARCH-9, и т.д.). Временно реэкспорт `Section`/`roleSectionIds` (сольётся с ARCH-2).
- Шаг 1 (минимальный риск, ПЕРВЫМ): SETTINGS/USERS → settings-page/user-sheet/supplier-sheet/password-dialog/wazzup-settings-block. app/settings+users/page.tsx по образцу /shifts (guard owner, getDashboardData, getWazzupSettingsStatus лениво — закрывает SEC-5). Удалить ветку `displayedSection==='settings'`.
- Шаг 2 (низкий-средний): STOCK/BOUQUETS → stock-page/product-sheet/categories-dialog/warehouse-import-dialog/stock-document-dialog. /bouquets — тонкая страница над существующим BouquetsPage.
- Шаг 3 (средний): ORDERS/READY-ORDERS → orders-page/ready-orders-page/courier-sheet. ВАЖНО: 5-сек activity-поллер (useEffect 574-615, PERF-2) переносится в клиентские острова (образец deals-auto-refresh.tsx) — поведенческий риск, ручная верификация live-refresh.
- Шаг 4 (наивысший риск, ПОСЛЕДНИМ): CASH → cash-page/quick-sale-form/new-order-form/customer-create-dialog/cash-operation-dialog. guard через canUseCash. Вся логика смены/кассы через shiftContext CrmShell.
- ФИНАЛ: удалить `Backoffice`(510) и `BackofficeRoute`.

**verificationNotes:** (см. план — verificationNotes пуст, ключевые проверки из approach.) Каждый шаг: tsc + next build + ручной клик по разделу. Критичные точки ручной проверки: live-refresh activity-поллера после переноса в острова (orders/ready-orders/cash); матрица доступа по ролям на новых тонких страницах (guard повторяет backoffice-route 37-58, пересечение с ARCH-2); вся денежная/сменная логика (open/close shift, продажа, заказ) через shiftContext без регрессии. → **high risk, XL, safeForAuto=false**.

---

## 5. Безопасно для автономной реализации сейчас vs требует ручного контроля

### ✅ Безопасно автономно сейчас (safeForAuto=true, risk low/medium)
Эти задачи можно реализовывать ботом/автономно за build-гейтом + лёгкая визуальная проверка:
- **ARCH-9** (low/M) — мёртвый код + дедуп лейблов. Самый безопасный, делать первым.
- **ARCH-7** (low/M) — версионирование схемы, аддитивно, не трогает деньги/склад/права.
- **ARCH-3** (medium/M) — row-мапперы; НАМЕРЕННО меняет поведение CRM (фикс багов), требует визуальной сверки статусов на CRM-страницах, но логика безопасна.
- **ARCH-2** (medium/M) — единый NAV; build ловит типы, но матрицу прав сайдбара сверить вручную (florist+касса — главный риск).
- **ARCH-6** (medium/M) — обёртки server actions; публичные сигнатуры 1:1, build ловит почти всё.

### ⚠️ Требует ручного контроля / крупное (safeForAuto=false)
- **PERF-6** (low/S) — формально no-op, но safeForAuto=false: обязательна ручная сверка вывода `next build` (все маршруты должны остаться `ƒ`). Реального эффекта без кэш-инфраструктуры нет — низкий приоритет.
- **PERF-5** (medium/M) — полнота списков `paths` для денежных/складских/заказных экшенов требует ручного ревью человеком (риск недо-ревалидации денег/остатков).
- **ARCH-4** (medium/XL) — большой объём (~70 кастов), пофазно с UI-прогоном; задевает числовую логику денег/склада.
- **ARCH-5** (high/L) — деньги/склад/права; семантика препроцессоров и русские тексты ошибок, строго по одному action.
- **ARCH-8** (high/XL) — разрез god-модуля; деньги/склад/права/смены, циклы импортов, singleton БД; по одному домену.
- **ARCH-1** (high/XL) — декомпозиция монолита; деньги/смены, перенос live-поллера; lift-and-shift по шагам, cash — последним.

### Сводное правило приоритизации
1. Сначала автономная пятёрка (ARCH-9 → волна 1: ARCH-7/ARCH-2/ARCH-6 → ARCH-3) — даёт максимум чистки за минимум риска и сокращает поверхность для крупных задач.
2. PERF-5 — после ARCH-6, под ручным ревью путей.
3. Крупные XL (ARCH-4 → ARCH-8 → ARCH-5 → ARCH-1) — отдельными большими этапами, последовательно, с прогоном денежно-складских сценариев после каждого шага.
4. PERF-6 — либо в волне 1 как тривиальная зачистка с ручной сверкой build, либо закрыть как «избыточен, но безвреден» (нулевой выигрыш).
