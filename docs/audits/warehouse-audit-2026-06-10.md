# Аудит складской подсистемы — 10.06.2026

Полный многоагентный аудит кода и данных прода (131 агент, 12 направлений + 4 добора критика полноты).
Каждая находка прошла адверсариальную верификацию (1–2 независимых проверяющих, попытка опровержения по коду и read-only SQL).
Итог: **92 подтверждённых находки**, 2 опровергнуты, 0 спорных. БД не модифицировалась (только `sqlite3 -readonly`).

Сборка прода на момент аудита: коммит `beea4f3` (ветка `polish/xhigh-ui-audit`), активных товаров: 230.

| Серьёзность | Кол-во |
|---|---|
| Критично | 1 |
| Высокая | 11 |
| Средняя | 36 |
| Низкая | 44 |


## Критично (1)

### 1. Инвентаризацию невозможно провести: quick-fill подставляет отрицательный учётный остаток, save падает целиком без указания строки — причина 4 отменённых инвентаризаций

**Где:** `src/lib/db/queries/stock-inventory.ts:159` · **Направление:** Инвентаризация

В каталоге ~49 активных товаров с отрицательным stock (K3). При создании инвентаризации они попадают в снапшот с expected_qty < 0 (в доках 7/8 — 53 строки, в 11/12 — 48 строк). Кнопки «совпало» (inventory-detail-client.tsx:82) и «Остальные совпадают» (строка 92) копируют expectedQty в поле «Факт» как есть: counted = "-1168" (атрибут min={0} у input не блокирует программную установку значения). При «Сохранить» или «Провести» (saveThenPost сначала сохраняет) saveInventoryDraft на первой же отрицательной строке бросает throw — а так как все 230 UPDATE идут в одной client.transaction (строка 128), откатывается ВЕСЬ ввод. Ошибка «Фактическое количество не может быть отрицательным.» не называет товар — найти виновную строку среди 230 невозможно. postInventoryAction при этом никогда не вызывается (saveThenPost выходит при !saved.ok). Это объясняет, почему клиент 4 раза начинал и отменял инвентаризацию.

**Доказательство:** Код: `if (!Number.isFinite(value) || value < 0) { throw new Error("Фактическое количество не может быть отрицательным.") }` (stock-inventory.ts:158-160) внутри `client.transaction` (:128); quickFill: `setRow(item.id, { counted: String(item.expectedQty ?? 0) })` (inventory-detail-client.tsx:82). SQL-доказательства: `SELECT document_id, COUNT(*) FROM stock_document_items WHERE document_id IN (7,8,11,12) AND expected_qty<0 GROUP BY document_id` → 7|53, 8|53, 11|48, 12|48 (например Оазис 0,5 = -1168, Уп. лист = -266). Все 4 дока: counted=0, applied=0 из 230 строк; operation_at равен моменту создания (12 → 2026-06-09T11:04:52.184Z при created_at 11:04:52) — а любой успешный save перезаписал бы operation_at (см. отдельную находку) ⇒ НИ ОДИН save за 4 попытки не прошёл. stock_movements по документам 7/8/11/12 — пусто.

**Рекомендуемый фикс:** (1) В quick-fill подставлять max(0, expected) или живой currentStock; (2) в saveInventoryDraft включать в текст ошибки product_name/код строки; (3) валидировать на клиенте до отправки с подсветкой строк.


## Высокая (11)

### 2. finalizeOrderDraft с priceMode='current' разрушает цену букета в черновике заказа

**Где:** `src/lib/db/domain/order-lifecycle.ts:500` · **Направление:** Букеты и доступность

Модель цены букета: вся цена шаблона хранится в ПЕРВОЙ строке-компоненте (addBouquetToLineItems: price = index===0 ? bouquet.price : 0), остальные строки имеют price=0; при price>0 и bouquet_group_id строка тарифицируется как qty=1 (calculateComponentLineTotal). Черновик заказа с букетом можно создать прямо с кассы (cash-page.tsx:223, data-intent='draft' -> createOrderDraftAction). При отправке черновика в работу с режимом «Обновить по текущим» finalizeOrderDraft перезаписывает цену КАЖДОЙ строки на sale_price товара-компонента, игнорируя bouquet_group_id. Итог: строка-носитель цены букета (например 5000₽) становится ценой розы (500₽), нулевые строки компонентов получают свои sale_price, и из-за правила qty=1 для строк букета с price>0 сумма заказа превращается в сумму ОДНОЙ штуки каждого компонента — это ни цена букета, ни стоимость состава (qty компонентов игнорируется). Сумма заказа молча занижается/искажается, клиенту выставляется неверный счёт.

**Доказательство:** order-lifecycle.ts:500: `const price = priceMode === "current" ? numberFromRow(product.sale_price) : numberFromRow(row.price)` — без проверки bouquetGroupId; затем :507 `calculateComponentLineTotal({ qty, price, bouquetGroupId, ... })`, где commercial.ts:14 `qty: bouquetGroupId && price > 0 ? 1 : qty`. Цена букета задаётся только первой строке: product-line-items.tsx:393 `price: index === 0 ? bouquet.price : 0`. Пример: букет 5000₽ (15 роз по 500 + 3 эвкалипта по 300) после «Обновить по текущим» = 500 + 300 = 800₽ вместо 5000₽.

**Рекомендуемый фикс:** В finalizeOrderDraft при priceMode='current' пропускать строки с bouquet_group_id (оставлять их цены как в черновике) либо пересчитывать цену букета по актуальному шаблону целиком.

### 3. Инвентаризация: сохранение переписывает ВСЕ строки акта значениями из вкладки — устаревшая вкладка молча стирает чужой/свой подсчёт (lost update), а «Провести» сначала автосохраняет этот устаревший снимок

**Где:** `src/components/stock/inventory-detail-client.tsx:115` · **Направление:** Гонки и транзакционность

Состояние строк (`rows`) инициализируется ОДИН раз при монтировании (useState initializer, строки 44–53) и никогда не обновляется с сервера: router.refresh() обновляет проп `doc`, но не `rows` (страница src/app/stock/inventory/[id]/page.tsx:41 рендерит компонент без key). buildSaveFormData() (строки 115–125) отправляет ВСЕ строки акта, включая нетронутые: пустое поле уходит как "". На сервере saveInventoryDraft (src/lib/db/queries/stock-inventory.ts:147–171) для пустого значения пишет counted_qty=NULL, counted_at=NULL, variance_reason=NULL — т.е. «не считали». Сценарий: два оператора (или две вкладки одного владельца — вкладка, открытая утром/вчера) считают один акт; B сохраняет факт по 50 позициям; A, в чьей вкладке эти позиции пустые, жмёт «Сохранить» — подсчёт B полностью затирается NULL'ами без какого-либо предупреждения. Хуже: кнопка «Провести» (строки 142–147) СНАЧАЛА вызывает saveInventoryDraftAction(buildSaveFormData()) и затем postInventoryAction — устаревшая вкладка перед проведением молча перезапишет весь акт своим снимком и проведёт неверные дельты по складу (adjustment-движения, stock = counted). Фича живая: в прод-БД enable_inventory=1 (память о «флаг OFF» устарела). Это же объясняет жалобы вида «вводили — пропадало».

**Доказательство:** inventory-detail-client.tsx:118-122: `for (const item of doc.items) { const row = rows[item.id]; formData.append("itemId", String(item.id)); formData.append("countedQty", row?.counted ?? "") ... }`; stock-inventory.ts:153-163: `const isBlank = rawCounted == null || String(rawCounted).trim() === ""; let countedQty: number | null = null; ... updateItem.run({ id, documentId, countedQty, countedAt, ... })` — пустое поле затирает сохранённый факт NULL'ом. Прод: `sqlite3 -readonly app.db "SELECT key,value FROM app_settings"` → enable_inventory|1.

**Рекомендуемый фикс:** Отправлять только строки, которые пользователь реально менял (dirty-tracking), либо на сервере не затирать counted_qty=NULL поверх ненулевого counted_at (пустое поле = «не трогать», для явного сброса — отдельный маркер). Дополнительно: оптимистическая блокировка (передавать counted_at строки и отказывать при расхождении) и реинициализация rows из doc после router.refresh.

### 4. Фантомный товар «Букет» (00177165699006): 35% заказов оформляются одной строкой-заглушкой, реальные цветы не списываются со склада

**Где:** `app.db` · **Направление:** Форензика данных (app.db)

19 из 55 заказов прода (на сумму 86 063 руб) состоят ровно из ОДНОЙ позиции — товара-заглушки «Букет» с произвольной ценой (от 0 до 20 000 руб). При сборке (order_fulfill) списывается 1 шт «Букета» (его остаток уже −9), а реальные цветы, из которых букет собран физически, НЕ списываются и не попадают в себестоимость (cost_price заглушки = 0, COGS = 0). Это системно завышает остатки реальных цветов и обнуляет маржинальный учёт по этим заказам. Паттерн продолжается: заказы 48, 49, 51 с заглушкой созданы 2026-06-09 (сегодня). Заглушка сама приехала импортом уже с минусом (−2).

**Доказательство:** SQL: `SELECT oi.order_id, COUNT(*) , SUM(oi.product_code='00177165699006') FROM order_items oi WHERE order_id IN (SELECT order_id FROM order_items WHERE product_code='00177165699006') GROUP BY order_id;` → 19 заказов, в каждом lines=1 и placeholder_lines=1 (заказы 5,6,7,8,9,10,11,12,13,14,15,17,18,19,22,24,48,49,51). `SELECT SUM(total) FROM order_items WHERE product_code='00177165699006';` → 86063.0. `SELECT stock,sale_price,cost_price FROM products WHERE code='00177165699006';` → −9.0|0.0|0.0. Движение: `import|-2.0|Импорт склада XLSX: 1`, далее 9 × order_fulfill по −1 («Списание при готовности букета»).

**Рекомендуемый фикс:** Либо запретить/предупреждать при заказе из одной свободной заглушки, либо оформить «Букет» как is_custom-строку без товарного кода (не трогающую склад), а товар-заглушку архивировать. Процессно — требовать состав заказа из реальных позиций.

### 5. Reset стирает products, а холодный старт молча реанимирует каталог из CSV от 9 мая — с фантомным резервом 1082 шт

**Где:** `scripts/reset-database-for-launch.ts:31` · **Направление:** Сид/миграции/reset (добор)

Вопреки документации (CLAUDE.md: «preserves users/integration_settings/suppliers/...»), таблица products входит в tablesToClear (строка 31) и ПОЛНОСТЬЮ удаляется при reset. После этого первый же холодный старт процесса (deploy, reboot, crash) вызывает db() → seedFromCsv (src/lib/db/connection.ts:17-19, seed.ts:62: срабатывает при COUNT(products)=0), который заливает коммитнутый moysklad_stock_report_2026-05-09.csv: каталог месячной давности с устаревшими ценами/остатками и колонкой reserved — 58 позиций, суммарно 1082 шт фантомного резерва БЕЗ единого заказа (available = stock - reserved занижается, и снять этот резерв нечем — reserve_cancel привязан к заказам). Прод от 2026-06-04 спасло только то, что сервер НЕ перезапускался между reset (00:00:09) и ручным XLSX-импортом владельца (00:01:30, первые stock_movements — «Импорт склада XLSX», created_at всех 230 товаров = 2026-06-04 00:01): окно в 81 секунду. Любой systemd-рестарт в этом окне = молчаливое воскрешение мёртвого каталога. Комментарий в ledger.ts:177-178 («если резерв был перезаписан импортом») подтверждает, что класс проблемы уже известен.

**Доказательство:** seed.ts:62: `if (count.count > 0 || !fs.existsSync(csvPath)) { return }`; seed.ts:71: INSERT включает `@stock, @reserved`. CSV: `awk -F',' 'NR>1 && $7>0' moysklad_stock_report_2026-05-09.csv` → 58 строк reserved>0, сумма 1082. Прод: `SELECT substr(created_at,1,16), COUNT(*) FROM products GROUP BY 1` → `2026-06-04 00:01|230` (весь каталог пересоздан после reset 2026-06-04 00:00:09 — бэкап app.db.backup-before-launch-reset-2026-06-04-00-00-09).

**Рекомендуемый фикс:** 1) Убрать products из tablesToClear или явно задокументировать вайп; 2) seedFromCsv выполнять только при создании НОВОГО файла БД (флаг от new Database / env SEED_ON_EMPTY=1), а не при любой пустой таблице; 3) при сиде писать reserved=0 — резерв должен порождаться только заказами.

### 6. acceptDealPayment проводит оплату на ОТМЕНЁННЫЙ заказ (deals.order_id не очищается при отмене)

**Где:** `src/lib/db/domain/deal-orders.ts:694` · **Направление:** Леджер и резервы

При отмене заказа cancelOrder (order-lifecycle.ts:1019-1062) НЕ очищает deals.order_id — единственное место, где он пишется, это createOrderFromDeal (deal-orders.ts:251). После отмены заказа по сделке refundOrderPayments уменьшает deal.paid, баланс сделки снова > 0, и кнопка «Принять оплату» в карточке сделки активна (deal-detail-page.tsx:1522 — disabled только при balance<=0 || !openShift; activeDealOrder=null, т.к. 'Отменен' не активный статус). acceptDealPayment берёт orderId из deal.order_id БЕЗ проверки статуса заказа: для отменённого заказа orderBalance = total - 0 > 0, проверка «Заказ уже оплачен» проходит → (1) cash_transaction привязывается к отменённому заказу, (2) UPDATE orders SET paid += amount воскрешает paid у заказа со статусом 'Отменен'. Последствия: paid>0 навсегда застревает на отменённом заказе (повторный cancelOrder ранний return на 'Отменен' — возврат через стандартный путь невозможен); при создании нового заказа из сделки C1-логика (SUM(paid) WHERE status <> 'Отменен', строка 121) игнорирует этот paid, а H2-перепривязка (строка 189) переносит только строки с order_id IS NULL — приход остаётся на отменённом заказе. Если затем отменить НОВЫЙ заказ, refundOrderPayments не найдёт его приходов и вернёт всё наличными с пометкой «(предоплата)» — безналичная оплата вернётся наличкой (тот же класс бага, что чинился в updatePaymentMethod). В соседнем crm.ts отменённый заказ обрабатывается правильно (assertDealItemsEditable:572-586 и recalculateDealTotals:783-791 проверяют status !== 'Отменен') — acceptDealPayment эту проверку не делает. В проде пока не стрельнуло (SELECT по orders WHERE status='Отменен' AND paid>0 — пусто), баг латентный.

**Доказательство:** deal-orders.ts:694-712: const orderId = numberFromRow(deal.order_id) || null ... if (orderId) { const order = client.prepare("SELECT total, paid FROM orders WHERE id = ?").get(orderId) ... const orderBalance = Math.max(0, numberFromRow(order.total) - numberFromRow(order.paid)) — статус заказа НЕ проверяется; deal-orders.ts:734-741: if (orderId) { client.prepare(`UPDATE orders SET paid = COALESCE(paid, 0) + ? ... WHERE id = ?`).run(amount, currentUser.id, orderId) }. grep по всему src: deals.order_id нигде не сбрасывается в NULL при отмене заказа.

**Рекомендуемый фикс:** В acceptDealPayment (и в applyOrderPayment для симметрии) проверять статус связанного заказа: если 'Отменен' — считать orderId = null (оплата идёт только на сделку), либо очищать deals.order_id в cancelOrder.

### 7. updatePaymentMethod(target="sale") позволяет менять способ оплаты у СТОРНИРОВАННОЙ продажи — пара «приход+возврат» разъезжается, касса ломается (тот же класс, что инцидент −6870)

**Где:** `src/lib/db/queries/cash.ts:235` · **Направление:** Продажи/возвраты и остатки

Сторно продажи (reverseCashTransaction, cash.ts:406-445) создаёт cash_refund с ТЕМ ЖЕ способом оплаты, что у исходной проводки 'sale' — сбалансированная пара, нетто 0 по каждому методу. Гард «нельзя править приход, по которому есть возврат» (фикс инцидента 04.06.2026) добавлен ТОЛЬКО в ветку target="transaction" и ищет возврат по order_id (cash.ts:307-317). В ветке target="sale" (cash.ts:235-267) никакой проверки reversed_at / существующего cash_refund по sale_id нет: UPDATE двигает метод у sales и у проводки type='sale' (cash.ts:254-259), а парный cash_refund остаётся в старом методе. Если в открытой смене сторнировать продажу за наличные, а затем «исправить» её метод на безнал — expectedCash уйдёт в минус на полную сумму продажи (cashSales теряет сумму, cashRefund по наличке остаётся), разбивка выручки по методам тоже разъедется. Сценарий полностью доступен из UI: getShiftDetails отдаёт продажи БЕЗ фильтра/поля reversed_at (shifts.ts:514-538), а ShiftCashTimeline рендерит активный селект метода для КАЖДОЙ продажи открытой смены (cash-page.tsx:1925: editTarget всегда задан; canEditPayments = Boolean(openShift), строка 1613). Прецеденты в проде уже есть: сторнированные продажи #88 (cash, 12 551.80) и #95 (bakai, 4 640) в смене 5.

**Доказательство:** cash.ts:250-259 (ветка target="sale", гарда нет): `if (sale.paymentMethod === paymentMethod) { return } client.prepare("UPDATE sales SET payment_method = ? WHERE id = ?").run(...); client.prepare("UPDATE cash_transactions SET payment_method = ? WHERE sale_id = ? AND type = 'sale'")...` — сравните с гардом для заказов cash.ts:309-314: `SELECT 1 FROM cash_transactions WHERE order_id = ? AND type = 'cash_refund'` (по sale_id аналога нет). SQL по проду: sale #88 reversed_at='2026-06-08 10:57:31', пара tx 168 (sale, cash, 12551.8) + 174 (cash_refund, cash, 12551.8, reverses_id=168); sale #95 — tx 176/177 (bakai). Возврат при сторно зеркалит старый метод: cash.ts:411-421 `recordCashTransaction({... type: "cash_refund", paymentMethod: original.paymentMethod ...})`.

**Рекомендуемый фикс:** В ветке target="sale" запрещать правку, если по продаже есть возврат: SELECT reversed_at FROM sales / SELECT 1 FROM cash_transactions WHERE sale_id = ? AND type='cash_refund' → throw (зеркально гарду для заказов). Дополнительно скрывать селект метода для сторнированных продаж в UI.

### 8. Дата приемки/списания сдвигается на +6 часов и накапливается при каждом редактировании (TZ-баг fromDatetimeLocalValue)

**Где:** `src/lib/datetime.ts:17` · **Направление:** Акты склада (приход/списание/корректировка)

fromDatetimeLocalValue парсит «наивную» строку datetime-local через new Date(rawValue), т.е. в часовом поясе СЕРВЕРА. Прод-сервер работает в Etc/UTC (проверено timedatectl), а пользователь вводит время в поясе магазина Asia/Bishkek (UTC+6). Введённое «09:36» сохраняется как 09:36Z вместо 03:36Z, а при показе parseDbInstant конвертирует в Бишкек → на экране 15:36 (+6ч к введённому). Хуже: при каждом цикле редактирования черновика ошибка НАКАПЛИВАЕТСЯ — toDatetimeLocalValue в браузере корректно сдвигает UTC→Бишкек (+6), сервер снова неверно интерпретирует (+6 к хранимому). Затрагивает все акты склада (stock-documents.ts:233) и инвентаризацию (stock-inventory.ts:47,132 — все call-sites fromDatetimeLocalValue). Латентно влияет и на срок годности партий: receivedAt партии берётся из operation_at (maybeCreateReceiptLot), сдвиг может перенести expiry_date на сутки.

**Доказательство:** Код: `const date = new Date(rawValue); return ... date.toISOString()` (datetime.ts:17-18). Прод-данные: timedatectl → Time zone: Etc/UTC. SQL: акт OUT-000001 created_at=2026-06-08 03:36:14 (=09:36 Бишкек, пользователь ввёл «09:36»), operation_at=2026-06-08T09:36:00.000Z → на странице акта показывается 15:36. Цепочка корректировки: IN-000004 operation_at=2026-06-08T17:01:00.000Z → его корректировка IN-000005 после одного круга через форму редактирования: operation_at=2026-06-08T23:01:00.000Z — ровно +6:00, дата «уехала» на следующие сутки.

**Рекомендуемый фикс:** В fromDatetimeLocalValue интерпретировать naive-строку как время в SHOP_TIME_ZONE (вычесть смещение Бишкека, +06:00), а не полагаться на TZ сервера; например new Date(`${rawValue}:00+06:00`) или через Intl-вычисление смещения. Существующие operation_at в БД скорректировать миграцией (-6ч для значений, введённых пользователем).

### 9. Таймзонный двойной сдвиг operation_at: срок годности партии завышается на день для вечерних приёмок, received_at/даты актов показываются +6ч

**Где:** `src/lib/datetime.ts:17` · **Направление:** Партии и сроки годности

fromDatetimeLocalValue парсит значение из <input type=datetime-local> через new Date(rawValue) в таймзоне СЕРВЕРА (прод = Etc/UTC, проверено timedatectl), хотя пользователь вводит время Бишкека (UTC+6). В БД попадает wall-clock со суффиксом Z, т.е. момент на 6 часов позже истинного. Последствия для партий: maybeCreateReceiptLot (stock-lots.ts:112,121) пишет этот фейковый UTC в stock_lots.received_at, а computeExpiryDate (stock-lots.ts:13-25) читает его parseDbInstant'ом как UTC и форматирует +N дней в Asia/Bishkek — при времени приёмки ≥18:00 дата перескакивает на следующий день, и expiry_date получается на ДЕНЬ ПОЗЖЕ истинного (цветы числятся свежими лишний день; FEFO-порядок тоже искажается). Колонка «Получено» на /stock/lots (stock-lots-client.tsx:51-54) для вечерних приёмок показывает следующий день. Уже сегодня (без партий) все акты склада показывают дату/время операции +6ч (stock/acts/page.tsx:189,258-261 форматируют через parseDbInstant→Asia/Bishkek). Бонус-дефект: при редактировании черновика toDatetimeLocalValue (datetime.ts:1-9, stock-document-form.tsx:72) выполняется в браузере (UTC+6) и показывает +6ч; пересохранение без правки фиксирует ещё +6ч — дрейф накапливается с каждым циклом редактирования.

**Доказательство:** datetime.ts:17 `const date = new Date(rawValue)` → `date.toISOString()`. Прод-данные: IN-000007 operation_at=2026-06-09T16:36:00.000Z при created_at=2026-06-09 10:38:16 (UTC, = 16:38 Бишкек) — ровно +6ч; IN-000005 operation_at=2026-06-08T23:01:00.000Z (вечерняя приёмка реально существует: с vase_life=7 expiry стал бы 2026-06-16 вместо 2026-06-15). Сервер: `timedatectl` → Time zone: Etc/UTC.

**Рекомендуемый фикс:** В fromDatetimeLocalValue интерпретировать naive-значение как время Asia/Bishkek (вычесть смещение зоны магазина перед toISOString), либо хранить operation_at как wall-clock и выводить через parseWallClock (как due_at). Поправить toDatetimeLocalValue симметрично. Существующие operation_at в БД мигрировать (-6ч для значений с .000Z-паттерном) до включения партионного учёта.

### 10. Касса никогда не обновляет каталог товаров: revision поллинга учитывает только заказы — точная механика жалобы про «хризантему»

**Где:** `src/lib/db/queries/shifts.ts:122` · **Направление:** Видимость и поиск товаров

Единственный авто-рефреш экрана /cash — компонент OrdersActivityRefresh (src/components/orders/order-shared.tsx:54-84), который поллит /api/orders/activity и делает router.refresh() ТОЛЬКО при изменении revision. Но getOrdersActivityRevision считает revision исключительно по таблице orders (COUNT + MAX(updated_at) активных заказов). Переименование, создание, архивация товара или изменение остатка НЕ меняют revision — у кассира бессрочно (пока не изменится какой-нибудь заказ или не перезагрузят вкладку) живёт каталог на момент загрузки страницы. Это и есть точное объяснение наблюдения клиента: код 00177165698580 за один день 2026-06-09 пережил «войну переименований» — 14 событий stock_update, минимум 11 смен имени между 4 разными цветами (Хризантема Китай кустовая ↔ Аллиум (агапантус) ↔ Гортензия местная ↔ юкка) с 07:52 до 13:46, каждые ~10 минут (механика K1: разные сотрудники «добавляли новый товар» под одним кодом/штрихкодом, молча перезаписывая друг друга). Владелец, открыв /stock ПОСЛЕ очередного переименования, не находит «Хризантему Китай кустовую» (поиск по имени, имя уже «Аллиум»/«Гортензия»; находится только 00023 «Хризантема одноголовая Момока»). Менеджер на кассе со вкладкой, загруженной ДО переименования, находит её — в его клиентском массиве products имя старое. Опасное следствие: продажа со stale-вкладки уходит на сервер по product_code со stale-ценой (buildSaleItems, src/lib/db/queries/sales.ts:45-50: цена берётся из формы, товар резолвится по коду) — списывается остаток ТОГО цветка, который сейчас владеет кодом (сегодня это «Гортензия местная», stock 243 — слитая котлета из четырёх разных цветов).

**Доказательство:** shifts.ts:122-131: `SELECT COUNT(*) as count, COALESCE(MAX(COALESCE(updated_at, created_at)), '') as latest FROM orders WHERE status NOT IN ('Черновик','Выдан','Отменен')` — таблица products не участвует. SQL (read-only): movements по коду 00177165698580 за 2026-06-09: 05:11 sale «Хризантема Китай кустовая» → 07:52 «Аллиум (агапантус)» → 08:30 «Хризантема Китай кустовая» → 08:40 «Аллиум» → 08:47 «Хризантема» → 08:59 «Аллиум» → 09:13 «Хризантема» → 10:35 «Гортензия местная» → 11:57-11:58 «юкка» ×3 → 13:10-13:11 «Аллиум» ×2 → 13:43 «юкка» → 13:46 «Гортензия местная» → 18:26 sale «Гортензия местная». Текущее состояние: products: 00177165698580 = «Гортензия местная», stock 243, reserved 10.

**Рекомендуемый фикс:** Включить в revision также MAX(updated_at) по products (и, в идеале, по shifts/cash_transactions), либо добавить отдельный поллинг версии каталога на /cash. Плюс закрыть K1 (запрет молчаливого ON CONFLICT DO UPDATE из формы «Новый товар»).

### 11. Касса показывает и проверяет stock, склад — available: резерв под заказы не защищён при продаже, предупреждение о нехватке не срабатывает

**Где:** `src/components/cash/cash-page.tsx:451` · **Направление:** Видимость и поиск товаров

Для одного и того же товара экраны показывают разные числа: склад считает уровень по available = stock − reserved (stock-page.tsx:134-146, StockBadge), а выпадашка поиска на кассе показывает «Остаток {product.stock}» (product-combobox.tsx:412) и красит бейдж только при stock < 0 (product-combobox.tsx:382). Проверка нехватки по корзине на кассе тоже сравнивает с product.stock, игнорируя reserved (cash-page.tsx:451: requiredQty > product.stock). Итог: товар, полностью зарезервированный под заказы, на складе виден как «Нет в наличии»/«В минусе», а на кассе выглядит доступным («Остаток 4») — кассир без единого предупреждения продаёт зарезервированное, заказ потом нечем собирать, склад уходит в минус (смежная механика K3, но это отдельный дефект: даже существующее предупреждение «склад уйдёт в минус» не срабатывает, пока продажа влезает в stock, хотя available уже отрицательный).

**Доказательство:** cash-page.tsx:450-453: `const product = productByCode.get(code); if (product && requiredQty > product.stock) { count += 1 }`. product-combobox.tsx:411-413: `Остаток {formatNumber(product.stock)}`; :382: `const hasStockProblem = product.stock < 0`. SQL: гладиолус 00177165699047: stock=4, reserved=20, available=−16 — склад показывает «В минусе −16», касса — «Остаток 4» без предупреждений; продажа 4 шт пройдёт молча.

**Рекомендуемый фикс:** На кассе показывать и проверять available (stock − reserved): в бейдже комбобокса, в hasStockProblem и в cartShortageCount.

### 12. Дубликаты кода в одном XLSX суммируют дельты остатка — итоговый stock завышается, отчёт врёт

**Где:** `src/lib/db/queries/warehouse.ts:188` · **Направление:** Импорт/экспорт XLSX

Ни parseWarehouseImportRows (строки 301–329), ни buildWarehouseImportReportItems (382–403) не дедуплицируют строки по code — каждая строка превью считается независимо против ОДНОГО и того же текущего остатка в БД. При apply (строки 177–241) для каждой строки заново читается existing и к ЖИВОМУ остатку прибавляется дельта, зафиксированная на превью. Пример: товар X, stock=10; в файле две строки X со stock=15 (типичный случай — Excel-файл с задублированной строкой). Превью: обе строки action=update, delta=+5. Apply: строка 1 → stock=15 (movement +5), строка 2 → existing уже 15, +5 → stock=20 вместо ожидаемых 15. Для двух строк-«create» с одним новым кодом: первая делает INSERT(stock1), вторая попадает в UPDATE-ветку → stock1+stock2. При этом сохранённый отчёт (insertWarehouseImportItems из превью-значений, строка 254) покажет new_stock=15, хотя в БД 20 — расхождение не видно нигде, кроме stock_movements. Семантика «stock в файле = абсолютное целевое значение» нарушается молча.

**Доказательство:** warehouse.ts:182-189: `const existing = getProduct(client, item.code); const currentStock = existing ? numberFromRow(existing.stock) : 0; ... const intendedStockDelta = numberFromRow(item.stockDelta); const appliedStock = currentStock + intendedStockDelta` — выполняется в цикле по строкам отчёта без проверки повторяющихся code; в buildWarehouseImportReportItems нет ни Set по кодам, ни ошибки «дубликат кода».

**Рекомендуемый фикс:** В buildWarehouseImportReportItems завести Set уже встреченных кодов и помечать повторные строки action='error' («дубликат кода в файле», как ошибка строки) — это автоматически заблокирует apply существующей проверкой на error-строки.


## Средняя (36)

### 13. Флорист на кассе видит «Новый клиент», «Создать заказ» и «Сохранить черновик», но все три action для него запрещены

**Где:** `src/components/cash/cash-page.tsx:902` · **Направление:** Роли, server actions, инвалидация

Страница /cash доступна флористу при ЛЮБОЙ открытой смене (canUseCash в src/lib/auth.ts:184-193; прямо сейчас в БД открыта смена менеджера id=7, т.е. условие выполнено для активного флориста). Однако компонент CashPage не получает роль вообще (src/app/cash/page.tsx:35 — `<CashPage data={data} />`, в самом cash-page.tsx нет ни одного упоминания role) и безусловно рендерит: кнопку «Новый» клиента (строка 670) → createCashCustomerAction (actions.ts:598-601, roles ["owner","manager"]), кнопку «Создать заказ» (строки 896-906) → OrderDialog → createOrderAction (actions.ts:977-979, ["owner","manager"]) и кнопку «Сохранить черновик» (строка 1578, data-intent="draft") → createOrderDraftAction (actions.ts:982-990, ["owner","manager"]). Флорист, легально работающий на кассе, заполняет форму заказа/клиента целиком и получает «Недостаточно прав.» — рабочий тупик: продажу он провести может (createSaleAction = runCashAction), а заказ с доставкой или нового клиента в той же кассе — нет. Комментарий в actions.ts:981 («флористы их не видят и не трогают») верен только для /orders (там есть canManageDrafts, src/app/orders/page.tsx:22-23), а на /cash это допущение нарушено.

**Доказательство:** cash-page.tsx:206 `onCreateOrder={() => setOrderOpen(true)}`; :223 `const action = submitter?.getAttribute("data-intent") === "draft" ? createOrderDraftAction : createOrderAction`; :670 `onClick={() => setCustomerDialogOpen(true)}` — без проверки роли. actions.ts:598-600 `runDataAction<CustomerOption>(["owner", "manager"], ...)`; :978 `runRoleAction(["owner", "manager"], (user) => createOrder(...))`. SQL: `SELECT role,COUNT(*) FROM users WHERE is_active=1 GROUP BY role` → florist|1, manager|2, owner|2; `SELECT id,type,status,user_id FROM shifts WHERE status='open'` → 7|day|open|4 (менеджер) — т.е. флорист сейчас проходит canUseCash и видит все эти кнопки.

**Рекомендуемый фикс:** Передать роль в CashPage (как сделано в /orders через canManageDrafts) и скрыть/задизейблить кнопки для флориста, ЛИБО осознанно расширить createCashCustomerAction/createOrderAction/createOrderDraftAction до runCashAction — но синхронно в обоих слоях.

### 14. Кнопка «Перейти к сменам» на /orders ведёт флориста и менеджера на owner-only страницу /shifts (Access denied)

**Где:** `src/components/orders/orders-page.tsx:221` · **Направление:** Роли, server actions, инвалидация

Пустое состояние «Стола заказов» при hasOpenShift === false показывает кнопку «Перейти к сменам» со ссылкой на /shifts. /orders — дефолтный лендинг флориста (getDefaultPathForRole, auth.ts:24-26) и доступен менеджеру, но страница /shifts пускает только owner (src/app/shifts/page.tsx:12 `if (user.role !== "owner") return <AccessDenied .../>`; nav.ts:58 roles: ["owner"]). Сценарий: флорист приходит утром, смены нет, заказов нет → видит подсказку «откройте смену» и кнопку → клик → «Access denied». При этом открыть свою смену флорист по дизайну (Phase 9a) должен через /cash, куда его специально пускают без смены (floristCanOpenShift, src/app/cash/page.tsx:18-21).

**Доказательство:** orders-page.tsx:220-223: `hasOpenShift === false && (<Button variant="outline" size="sm" render={<Link href="/shifts" />}>Перейти к сменам</Button>)` — без проверки роли; src/app/shifts/page.tsx:12-14: `if (user.role !== "owner") { return <AccessDenied homeHref={getDefaultPathForRole(user.role)} /> }`.

**Рекомендуемый фикс:** Для не-owner вести на /cash (там открывают смену) либо показывать кнопку только owner'у — прокинуть роль или canAccessShifts в OrdersPage.

### 15. getDraftPriceChanges всегда ложно сообщает «цены изменились» для черновика с букетом и подталкивает к ломающему режиму

**Где:** `src/lib/db/domain/order-lifecycle.ts:454` · **Направление:** Букеты и доступность

getDraftPriceChanges сравнивает price каждой строки order_items с sale_price товара, не учитывая bouquet_group_id. Для черновика с букетом строка-носитель цены (5000₽) сравнивается с sale_price компонента (500₽), а нулевые строки компонентов — с их sale_price (0 != 500). Любой черновик с букетом всегда показывает алерт «Цены некоторых позиций изменились» и диалог с бессмысленными парами «Роза: 5000₽ → 500₽», «Эвкалипт: 0₽ → 300₽» (orders-page.tsx:308-348). Это и пугает оператора, и ведёт его прямиком к кнопке «Обновить по текущим», которая ломает сумму (см. предыдущую находку). Побочно: то же ложное срабатывание для любых строк с ручной ценой.

**Доказательство:** order-lifecycle.ts:449-455: `const product = getProduct(client, row.productCode); ... const oldPrice = numberFromRow(row.price); const newPrice = numberFromRow(product.sale_price); if (roundMoney(oldPrice) !== roundMoney(newPrice)) { changes.push(...) }` — выборка на :445 берёт все строки заказа без фильтра по bouquet_group_id.

**Рекомендуемый фикс:** В выборке getDraftPriceChanges исключать строки с непустым bouquet_group_id (или сравнивать цену группы с актуальной ценой шаблона по bouquet_id).

### 16. Доступность букета считается по stock, игнорируя reserved: зарезервированные под заказы цветы считаются доступными

**Где:** `src/lib/bouquet-availability.ts:32` · **Направление:** Букеты и доступность

getBouquetAvailability сравнивает требуемое количество с raw stock, хотя ledger определяет доступный остаток как stock - reserved (заказы резервируют компоненты через applyProductDelta reservedDelta, и серверная проверка enforceAvailable в ledger.ts:167-174 считает именно available = stock - reserved). listBouquetTemplateItems (bouquets.ts:239,259) даже вычисляет поле available = stock - reserved, но его НИКТО не читает — все 6 точек вызова (product-combobox.tsx:166,439; deal-detail-page.tsx:644; wazzup-custom-chat.tsx:478,1091; bouquets-page.tsx:65,504) передают item.stock. На проде 25 товаров имеют reserved>0 (гладиолус: stock 4, reserved 20 → реально доступно -16, но проверка букета увидит «4 в наличии»). Итог: бейдж «Не хватает» не загорается, кассир продаёт букет из цветов, зарезервированных под заказы; а при allow_oversell_orders=0 заказ с таким «доступным» букетом упадёт с ошибкой, противореча UI. Отрицательные остатки при этом обрабатываются корректно (missingQty = qty - stock > 0).

**Доказательство:** bouquet-availability.ts:31-32: `const stock = Number.isFinite(itemStock) ? itemStock : 0; const missingQty = Math.max(0, requiredQty - stock)` — тип BouquetAvailabilityItem (строки 1-6) вообще не содержит reserved. bouquets.ts:259: `available: stock - reserved,` — поле-сирота. SQL: SELECT code,name,stock,reserved FROM products WHERE reserved>0 → 25 строк, в т.ч. `00177165699047|гладиолус|4.0|20.0`, `00177165699050|пион премиум|-140.0|31.0`.

**Рекомендуемый фикс:** Передавать в getBouquetAvailability available (stock - reserved) вместо stock — поле уже считается в listBouquetTemplateItems; аналогично в getShortfall (product-line-items.tsx:538) использовать product.stock - product.reserved.

### 17. deleteProduct жёстко удаляет товар, не проверяя его участие в шаблонах букетов и позициях сделок

**Где:** `src/lib/db/queries/products.ts:167` · **Направление:** Букеты и доступность

deleteProduct (DELETE FROM products) проверяет резерв, активные заказы и историю продаж, но НЕ проверяет bouquet_template_items и deal_items. Удаление товара-компонента оставляет осиротевшую ссылку в шаблоне: бейдж покажет «Не хватает» (LEFT JOIN даёт stock 0), но букет остаётся выбираемым, и продажа на кассе падает с криптичной ошибкой «Товар 00... не найден.» (sales.ts:36-38), добавление букета в сделку — аналогично (crm.ts:644-647: «Товар X не найден.»), создание заказа из сделки с таким товаром в deal_items — тоже (deal-orders.ts:65-67). Шаблон остаётся перманентно сломанным, пока его не отредактируют вручную. Сейчас осиротевших строк нет (таблицы пустые), но защита отсутствует.

**Доказательство:** products.ts:177-198: проверяются только product.reserved > 0, order_items активных заказов и sale_items; затем :212 `client.prepare("DELETE FROM products WHERE code = ?").run(code)`. В guards нет ни одного обращения к bouquet_template_items или deal_items. bouquets.ts:242 `LEFT JOIN products ON products.code = bouquet_template_items.product_code` + COALESCE(stock,0) — удалённый компонент тихо превращается в «0 на складе».

**Рекомендуемый фикс:** В deleteProduct добавить проверки: COUNT(*) из bouquet_template_items по product_code (запретить или предложить убрать из шаблонов) и из deal_items открытых сделок.

### 18. Товар-плейсхолдер «Букет» (00177165699006) обходит списание компонентов: цветы под такие заказы вообще не списываются

**Где:** `src/lib/db/domain/order-lifecycle.ts:35` · **Направление:** Букеты и доступность

Новая деталь к механике K3 (направление «б»). Двойного учёта в коде нет: шаблон букета не является складской позицией, продажа/заказ по шаблону списывает только компоненты. Но на проде шаблоны не используются вовсе (bouquet_templates пуст, bouquet_group_id нигде не встречается) — вместо этого флористы заводят заказы с обычным товаром «Букет» (код 00177165699006, sale_price 0). Такой заказ резервирует и списывает только сам плейсхолдер (stock уже -9, reserved 6, сейчас 6 позиций в активных заказах), а реальные цветы, из которых собирают букет, НЕ списываются ни на одном этапе — складские остатки по цветам систематически завышаются, что усугубляет минуса из K3 при инвентаризации. Код это никак не ограничивает: buildOrderItems принимает любой товар, включая price=0 без остатка, без предупреждений.

**Доказательство:** SQL: `SELECT code,name,stock,reserved,is_active,sale_price FROM products WHERE code='00177165699006'` → `Букет|-9.0|6.0|1|0.0`; `SELECT type,COUNT(*),SUM(qty) FROM stock_movements WHERE product_code='00177165699006' GROUP BY type` → order_fulfill: 7 шт (-7), reserve: 24 (+24), reserve_cancel: 11 (-11); активных заказов с плейсхолдером: 6 (в т.ч. ORD-20260609-0051, -0049, -0048 в статусе «Новый»). При этом `SELECT COUNT(*) FROM bouquet_templates` → 0 и `SELECT COUNT(*) FROM order_items WHERE COALESCE(bouquet_group_id,'')!=''` → 0 — механика шаблонов, которая списывала бы компоненты, не используется.

**Рекомендуемый фикс:** Процессно: перевести сборные букеты на шаблоны (/bouquets). В коде: предупреждать/блокировать добавление в заказ товаров с sale_price=0 и без остатка, либо помечать плейсхолдер как служебный.

### 19. Смежный с K1: «Новый товар» с кодом архивного товара молча перезаписывает архивную запись и оставляет её невидимой (is_active не сбрасывается)

**Где:** `src/lib/db/queries/products.ts:67` · **Направление:** Гонки и транзакционность

Новая деталь механики K1. В upsertProduct блок ON CONFLICT(code) DO UPDATE перечисляет category_path/article/name/unit/stock/reserved/expected/cost_price/sale_price/track_lots/vase_life_days, но НЕ is_active. Если владелец «создаёт» товар с кодом, который принадлежит архивному товару (is_active=0), произойдёт молчаливое обновление архивной записи (имя, цены, категория перепишутся данными формы), а is_active останется 0. Действие вернёт «Товар сохранен.», но товар не появится ни в каталоге, ни в продажах: getDashboardData фильтрует `WHERE COALESCE(is_active, 1) = 1` (src/lib/db/queries/dashboard.ts:34), listArchivedProducts покажет архивную строку уже с НОВЫМ именем — старый архивный товар при этом фактически уничтожен (его имя/цены затёрты). Для пользователя это выглядит как «создал товар — он пропал». Сейчас в прод-БД архивных товаров 0, т.е. баг латентный, но путь воспроизводится в один шаг. Замечу: скрытые поля stock/reserved/expected в форме товара (src/components/stock/stock-page.tsx:858-860) при конфликте кода НЕ затирают остаток — для существующего товара upsertProduct берёт stock/reserved из БД (строки 35–37), эта часть K1 уже смягчена; молча перезаписываются именно имя/цены/категория и флаги партий.

**Доказательство:** products.ts:67-79: `ON CONFLICT(code) DO UPDATE SET category_path = excluded.category_path, article = excluded.article, name = excluded.name, ... vase_life_days = excluded.vase_life_days, updated_at = CURRENT_TIMESTAMP` — поля is_active в списке нет; dashboard.ts:34: `WHERE COALESCE(is_active, 1) = 1`. Проверка прод-БД: `SELECT COUNT(*) FROM products WHERE COALESCE(is_active,1)=0` → 0 (латентно).

**Рекомендуемый фикс:** В upsertProduct: если before существует и это «создание» (форма новой записи), отказывать с понятной ошибкой «Код занят товаром …» (исправление K1); как минимум — при конфликте добавить is_active=1 в DO UPDATE или явно запрещать апдейт архивной записи через форму создания.

### 20. Отмена уже собранного заказа: компоненты списаны безвозвратно, пути возврата на склад нет (потеряно ~7 300 руб себестоимости)

**Где:** `src/lib/db/domain/order-lifecycle.ts:1038` · **Направление:** Форензика данных (app.db)

cancelOrder для статусов «Готов»/«Передан курьеру»/«Выдан» сознательно не восстанавливает склад (комментарий в коде), деньги возвращает. На проде это уже стоило реальных остатков: заказ 20 отменён через 6 минут после сборки (похоже на ошибочный клик) — 25 ед. компонентов (~3 659 руб себестоимости: лилия ×3, георгин ×7, каллы ×5 и др.) остались списанными; заказ 28 отменён через 50 минут — 20 ед. (~3 648 руб: гортензия ×4, пион премиум ×4, эустома ×5 и др.). UI-механизма «разобрать букет / вернуть компоненты» нет, а если собранный букет потом продадут через кассу по составу — компоненты спишутся ВТОРОЙ раз. Ещё 4 отменённых заказа (9,12,15,17) списали по 1 шт заглушки «Букет».

**Доказательство:** Код (order-lifecycle.ts:1036–1041): `} else if (["Готов", "Передан курьеру", "Выдан"].includes(order.status)) { // «Готов»/«Передан курьеру»/«Выдан» — букет уже собран (склад списан), резерва нет: // автоматически склад не восстанавливаем... alreadyBuilt = true }`. SQL: заказы со статусом 'Отменен' и движениями order_fulfill без компенсирующих возвратов → 6 заказов (9,12,15,17,20,28), суммарно 49 ед. Тайминги: заказ 20 — fulfill 2026-06-06 04:37:58, отмена 04:44:15; заказ 28 — fulfill 06:40:20, отмена 07:30:00.

**Рекомендуемый фикс:** При отмене собранного заказа предлагать опцию «вернуть компоненты на склад» (компенсирующее движение adjustment/stock_in со ссылкой на заказ), как минимум для отмены вскоре после сборки.

### 21. Себестоимость списаний (stock_out) всегда сохраняется как 0 — оценка потерь, показанная в редакторе, никуда не записывается

**Где:** `src/components/stock/stock-document-form.tsx:351` · **Направление:** Себестоимость и накладные (добор)

Для актов списания UI вообще не рендерит поле itemUnitCost (колонка «Цена закупки» обёрнута в {!isWriteOff && ...}, строки 314 и 351–365). На сервере buildStockDocumentItems (src/lib/db/queries/stock-documents.ts:134) берёт unitCost из formData.getAll("itemUnitCost")[index]; для списаний массив пуст, toNumber(undefined) → 0, поэтому каждая строка stock_out получает unit_cost=0, а при проведении goodsTotal = Σ qty*0 = 0 и landed_total = 0 (stock-documents.ts:393, 481). При этом редактор честно показывает пользователю «Стоимость списания: X», считая её по текущей product.costPrice (stock-document-form.tsx:117 — комментарий в коде прямо говорит «списание — по текущей себестоимости товара», и строка 411 выводит итог с подсказкой «Оценочно по текущей себестоимости») — но эта оценка существует только в браузере и не сохраняется. В результате денежная оценка потерь не фиксируется нигде: ни в stock_document_items.unit_cost, ни в goods_total, и восстановить её задним числом нельзя (cost_price товара к тому времени изменится). Любой будущий отчёт по стоимости списаний на этих данных покажет 0.

**Доказательство:** stock-document-form.tsx:117: `const unit = isWriteOff ? line.product.costPrice || 0 : Number(line.item.unitCost) || 0` (только превью); :351 `{!isWriteOff && (<TableCell><Input name="itemUnitCost" ...` — поле не рендерится для списаний. Прод-данные: sqlite3 -readonly app.db → акт 4 (OUT-000001, posted): 1 позиция, unit_cost=0; stock_documents.goods_total=0.0, landed_total=0.0.

**Рекомендуемый фикс:** При проведении stock_out заполнять unit_cost строки снапшотом текущей products.cost_price (и считать goods_total по нему) — это совпадает с тем, что обещает редактор; либо передавать itemUnitCost скрытым полем из формы.

### 22. Корректировка прихода не откатывает и не переигрывает пересчитанную себестоимость; снапшоты cost_before/stock_before_cost пишутся «для будущей корректировки», но нигде не читаются (мёртвый механизм)

**Где:** `src/lib/db/queries/stock-documents.ts:502` · **Направление:** Себестоимость и накладные (добор)

При recompute_cost_on_receipt=ON проведение прихода обновляет products.cost_price по средневзвешенной от landed-цены (строки 430–439) и сохраняет снапшоты cost_before/cost_after/stock_before_cost — комментарий миграции v14 (src/lib/db/schema.ts:927–928) обещает, что они нужны «для средневзвешенного пересчёта … и будущей корректировки/переигрывания». Но postStockCorrectionInTransaction (строка 502+) себестоимость не трогает вообще (комментарии на строках 498–500 и 577–578: «Накладные расходы распределяем для отображения (себестоимость не трогаем)»), а grep по репо показывает, что cost_before/stock_before_cost не читает НИ ОДИН код — только costAfter выводится в UI акта. Механика бага при включённом флаге: владелец проводит приход с ошибочной ценой (например, 3570 вместо 357) → cost_price пересчитан от неверной цены; затем создаёт корректировку с правильной ценой → откатываются только остатки, cost_price навсегда остаётся «заражён» неверной ценой, и все последующие средневзвешенные пересчёты наследуют ошибку. UI предупреждает текстом, но сценарий «исправил цену корректировкой» — основной сценарий корректировки, и именно он не работает для денег. Та же асимметрия по флагу: recompute OFF при исходном постинге / ON при корректировке — корректировка всё равно ничего не пересчитает. Сейчас на проде флаг OFF (app_settings: recompute_cost_on_receipt=0), поэтому баг латентный, но включается одним чекбоксом в /settings (saveStockCostSettingsAction, src/app/actions.ts:321–327). Попутно проверено по запросу аудита: «гонка» между постингом (безусловный UPDATE products SET cost_price=oldCost при OFF, строки 441–443) и правкой цены владельцем невозможна — better-sqlite3 выполняет транзакцию синхронно в единственном соединении, интерливинг исключён; и отмена проведённого прихода невозможна в принципе (cancelStockDocument:801 бросает «Проведенный акт нельзя отменить»), так что откат cost_price через отмену не теряется — его просто негде получить.

**Доказательство:** schema.ts:927–928: «landed_unit_cost/cost_before/cost_after/stock_before_cost — снимки при ПРОВЕДЕНИИ для средневзвешенного пересчёта products.cost_price и будущей корректировки/переигрывания»; stock-documents.ts:498–500: «Себестоимость (products.cost_price) НЕ пересчитывается — точное переигрывание средневзвешенной невозможно». grep cost_before|stock_before_cost по src/ — читателей нет (только запись в stock-documents.ts:451 и маппинг в UI).

**Рекомендуемый фикс:** Минимум: при проведении корректировки, если у исходных позиций есть снапшоты (cost_before/stock_before_cost), переигрывать средневзвешенную: откатить вклад исходной строки по снапшоту и применить вклад исправленной (или хотя бы громко предупреждать в результате действия, какие товары требуют ручной правки cost_price, со старым/ожидаемым значением). Либо удалить запись неиспользуемых снапшотов и поправить комментарий миграции.

### 23. История склада показывает текущее имя товара (live JOIN), а не имя на момент движения — аудит-трейл переписывается задним числом при перезаписи товара (механика K1)

**Где:** `src/lib/db/queries/history.ts:49` · **Направление:** История склада и отчёты (добор)

В stock_movements нет колонки product_name (подтверждено PRAGMA table_info) — stockMovementsQuery берёт имя через LEFT JOIN products ON products.code = stock_movements.product_code, т.е. всегда ТЕКУЩЕЕ имя. В сочетании с известной K1 (upsertProduct молча перезаписывает товар по занятому коду) вся история движений по коду ретроактивно «переименовывается»: для инцидент-кода 00177165698580 импорт 171 шт от 2026-06-04 и продажи сейчас подписаны «Гортензия местная», хотя в момент движения код мог означать другой товар. Расследовать K1 по /history/stock или XLSX-экспорту невозможно — следов прежних имён в этом отчёте нет (они есть только в movements.product_name для событий stock_update). При полном удалении товара (deleteProduct) JOIN даёт NULL и страница показывает голый код. Это НОВАЯ деталь механики K1: даже починив upsert, испорченную историю не восстановить из stock_movements.

**Доказательство:** history.ts:49: "products.name as productName" + :65 "LEFT JOIN products ON products.code = stock_movements.product_code". PRAGMA table_info(stock_movements) → колонки product_code, type, qty, before/after_stock... product_name ОТСУТСТВУЕТ. SQL по инцидент-коду: SELECT created_at, type, qty FROM stock_movements WHERE product_code='00177165698580' → 2026-06-04 import +171, ... ; SELECT name FROM products WHERE code='00177165698580' → «Гортензия местная» — все 9 движений подписываются этим именем независимо от того, чем был товар в момент операции.

**Рекомендуемый фикс:** Добавить в stock_movements снапшот product_name (ensureColumn) и заполнять его при записи движения; в запросе истории использовать COALESCE(snapshot, products.name, product_code).

### 24. Журнал «Операции» (лист XLSX-экспорта) слеп к складу: акты, инвентаризации, корректировки приходов и XLSX-импорт не пишут в movements

**Где:** `src/app/history/export/route.ts:16` · **Направление:** История склада и отчёты (добор)

Лист «Операции» экспорта строится из таблицы movements (historyOperationsQuery), которая выглядит как общий журнал действий, но складские модули в неё не пишут вовсе. Полный список вызовов addMovement (grep -rn "addMovement(" src/lib): products.ts (stock_update ×2 — ручная правка остатка в карточке, delete_product), sales.ts (sale), order-lifecycle.ts/deal-orders.ts (order_create, order_status), cash.ts (shift_open, shift_close, payment_method_change, cash_reversal), seed.ts (import — только сидинг). НЕ попадают в журнал: проведение/отмена/корректировка актов stock_in/stock_out (stock-documents.ts), инвентаризации (stock-inventory.ts), движения и списания партий (stock-lots.ts), рабочий XLSX-импорт склада (warehouse.ts) — grep по addMovement/INSERT INTO movements в этих четырёх файлах пуст. В проде это видно по данным: stock_movements содержит 221 строку import и 15 строк stock_in/stock_out, а в movements нет НИ ОДНОЙ строки этих типов. Часть событий видна на листе «Склад», но журнал «Операции» с колонками «Цена за ед.»/«Сумма» создаёт ложное впечатление полного аудит-журнала: например, изменение остатка через карточку товара там есть, а массовое поступление актом на 80 шт — нет.

**Доказательство:** grep -rn "addMovement(" src/lib → только seed.ts, cash.ts, products.ts, sales.ts, deal-orders.ts, order-lifecycle.ts; grep "addMovement|INSERT INTO movements" в stock-documents.ts, stock-inventory.ts, stock-lots.ts, warehouse.ts → exit=1 (ничего). SQL: SELECT type, COUNT(*) FROM movements GROUP BY type → sale|560, order_status|79, order_create|53, stock_update|17, shift_open|8, shift_close|7, payment_method_change|4, cash_reversal|2 — складских документных типов нет, при этом в stock_movements: import|221, stock_in|14, stock_out|1.

**Рекомендуемый фикс:** Либо дописывать addMovement при post/cancel/correct акта, инвентаризации и импорте (с total по себестоимости), либо честно переименовать лист и убрать из него претензию на полноту (объединить выгрузку вокруг stock_movements + cash_transactions).

### 25. /history/stock и XLSX-экспорт рендерят весь леджер целиком без лимита, пагинации и фильтров — деградация гарантирована ростом данных

**Где:** `src/lib/db/queries/history.ts:6` · **Направление:** История склада и отчёты (добор)

getHistoryReportData() вызывает historyOperationsQuery()/stockMovementsQuery() БЕЗ аргумента limit, т.е. SELECT всей таблицы (LIMIT добавляется только если limit передан, history.ts:39,69). /history/stock (page.tsx:22) синхронно рендерит каждую строку в серверный HTML-Table без пагинации/фильтра по датам/товару; /history/export строит обе таблицы в один XLSX в памяти. Сейчас 1299 строк stock_movements + 730 movements; темп — 130–446 строк/день (SQL ниже), т.е. ~4–7 тыс/мес: через полгода страница будет рендерить 25–40 тыс. строк таблицы на каждый заход владельца (force-dynamic, без кеша), а экспорт — собирать такой же буфер ExcelJS. Это не «когда-нибудь»: при темпе 2026-06-04 (446/день) 10 тыс. строк набегает за ~3 недели.

**Доказательство:** history.ts:10-11: "client.prepare(historyOperationsQuery()).all()" / "client.prepare(stockMovementsQuery()).all()" — limit не передан; history.ts:39: "${limit ? `\n   LIMIT ${limit}` : \"\"}". SQL: SELECT COUNT(*) FROM stock_movements → 1299; SELECT DATE(created_at), COUNT(*) ... LIMIT 14 → 06-10|19, 06-09|162, 06-08|137, 06-07|167, 06-06|236, 06-05|132, 06-04|446.

**Рекомендуемый фикс:** Для страницы — серверная пагинация (LIMIT/OFFSET или курсор по id) + фильтры по дате/типу/товару; для экспорта — фильтр по периоду (по умолчанию, например, последние 90 дней) и/или стриминговый writer ExcelJS.

### 26. Reset не чистит 4 дочерние таблицы, но сбрасывает AUTOINCREMENT — сироты «прилипают» к будущим записям; на проде уже лежат 7 сообщений, ждущие сделок №12-13

**Где:** `scripts/reset-database-for-launch.ts:6` · **Направление:** Сид/миграции/reset (добор)

tablesToClear (строки 6-33) не обновлялся под новые таблицы: deal_bouquet_messages, stock_document_overheads (v15), stock_lots и stock_lot_movements (v17) в нём отсутствуют, FK-констрейнтов у них нет (CREATE TABLE без REFERENCES — проверено по sqlite_master), поэтому DELETE родителей проходит молча, а дети остаются. При этом строки 123-129 удаляют sqlite_sequence для очищенных таблиц → новые deals/stock_documents переиспользуют id 1,2,3... и осиротевшие строки «усыновляются» чужими записями. УЖЕ ПРОИЗОШЛО на проде: 7 строк deal_bouquet_messages от 2026-06-02 ссылаются на deal_id 12 и 13, при этом текущие deals — id 1-3 (созданы с 2026-06-04, sqlite_sequence deals=3). Когда счётчик дойдёт до 12/13 (осталось ~9 сделок), в карточках двух новых сделок отрисуются чужие прошлогодние сообщения «Букет 1»/«Логотип» с картинками — listDealBouquetMessages (src/lib/db/queries/bouquets.ts:183) выбирает строго `WHERE deal_id = ?`. Тот же механизм после СЛЕДУЮЩЕГО reset ждёт stock_document_overheads (сейчас 1 строка: document_id=9, delivery 600) — будущий 9-й приходной акт унаследует чужие 600 сом накладных расходов и исказит landed cost при проведении; и stock_lots/stock_lot_movements, как только включат партионный учёт. Бонус: app_settings не входит ни в clear, ни в preserve-список — сохраняется молча и не виден в логе скрипта.

**Доказательство:** SQL: `SELECT group_concat(DISTINCT deal_id) FROM deal_bouquet_messages` → `12,13`; `SELECT MAX(id) FROM deals` → 3; `SELECT seq FROM sqlite_sequence WHERE name='deals'` → 3; sent_at сирот = 2026-06-02 (до reset 2026-06-04), created_at живых сделок = 2026-06-04+. `SELECT * FROM stock_document_overheads` → `1|9|delivery||600.0`. Код: tablesToClear (строки 6-33) — deal_bouquet_messages/stock_document_overheads/stock_lots/stock_lot_movements отсутствуют; строки 123-129 — `DELETE FROM sqlite_sequence WHERE name = ?`.

**Рекомендуемый фикс:** Добавить deal_bouquet_messages, stock_document_overheads, stock_lots, stock_lot_movements в tablesToClear (и app_settings — в явный preserve-список для лога). На проде до следующих 9 сделок: удалить 7 осиротевших строк deal_bouquet_messages (после бэкапа).

### 27. «Бэкап» в reset-скрипте — небезопасный copyFileSync живой WAL-БД: результат wal_checkpoint игнорируется, -wal не копируется

**Где:** `scripts/reset-database-for-launch.ts:110` · **Направление:** Сид/миграции/reset (добор)

Строки 110-111: `db.pragma("wal_checkpoint(FULL)")` (результат {busy, log, checkpointed} отбрасывается) и затем `fs.copyFileSync(dbPath, backupPath)` — копируется только app.db, без app.db-wal. Скрипт запускается при ЖИВОМ сервере (доказано reset'ом 2026-06-04: бэкап 00:00:09, владелец работал в UI в 00:01:30). Два механизма поломки: (1) если у живого next-процесса есть активный читатель, FULL-checkpoint после 5-сек busy_timeout возвращает busy=1 НЕ перенеся кадры WAL — и бэкап молча теряет все транзакции, оставшиеся в WAL (сейчас WAL = 4 136 512 байт против app.db = 1 118 208 — в WAL живёт в ~4 раза больше данных, чем в основном файле; auto-checkpoint срабатывает редко); (2) copyFileSync не берёт sqlite-блокировок — если параллельно живой сервер запустит auto-checkpoint (порог 1000 страниц ≈ 4 МБ — текущий размер WAL ровно на пороге), копия может получить «рваную» смесь старых/новых страниц, т.е. битый бэкап. После чего скрипт сразу необратимо удаляет данные, полагаясь на этот бэкап как единственную точку отката. Косвенное подтверждение хроники: размер основного файла в бэкапах не менялся неделями (1003520 байт с 12 мая по 4 июня) — почти вся активность жила в WAL.

**Доказательство:** Код (строки 110-111): `db.pragma("wal_checkpoint(FULL)")` / `fs.copyFileSync(dbPath, backupPath)` — возврат pragma не проверяется, -wal/-shm не копируются. Файлы: app.db = 1118208 байт, app.db-wal = 4136512 байт (ls -la). Бэкапы app.db.backup-before-launch-reset-2026-05-12..2026-06-04 — все ровно 1003520 байт.

**Рекомендуемый фикс:** Использовать `db.backup(path)` (онлайн-бэкап better-sqlite3) или `VACUUM INTO` вместо copyFileSync; проверять результат checkpoint (busy === 0) и прерывать reset при неуспехе; в идеале — требовать остановленный сервис.

### 28. Проверка дубликата имени поставщика чувствительна к регистру и внутренним пробелам — можно создать почти-дубль

**Где:** `src/lib/db/queries/suppliers.ts:80` · **Направление:** Поставщики (добор)

upsertSupplier проверяет дубль точным сравнением: SELECT id FROM suppliers WHERE name = ? (BINARY-коллация). UNIQUE-индекс на suppliers.name тоже BINARY. При этом список сортируется с COLLATE NOCASE (suppliers.ts:12), т.е. намерение «без учёта регистра» в коде есть, но проверка дубля его не реализует. clean() триммит только края строки — внутренние двойные пробелы не схлопываются. Итог: «Поставщик 1» и «поставщик 1» (или «Женя,  Голландия» с двойным пробелом) сосуществуют как два разных поставщика → два пункта во всех селектах (фильтр актов, форма акта пополнения), история закупок и партии разъезжаются по двум карточкам. Это тот же паттерн поведения клиента, что и в инциденте K1 (повторное «добавление» вместо поиска существующего). Для кириллицы NOCASE в SQLite не складывает регистр, поэтому исправление должно быть на уровне приложения (сравнение lower-case в JS).

**Доказательство:** suppliers.ts:80: const duplicate = client.prepare("SELECT id FROM suppliers WHERE name = ?").get(name); suppliers.ts:12: ORDER BY is_active DESC, name COLLATE NOCASE. Прод-БД: sqlite3 -readonly app.db "SELECT id FROM suppliers WHERE name = 'поставщик 1'" → пусто; "...WHERE name = 'Поставщик 1'" → 1 (запись существует, но проверка её не видит при другом регистре). DDL: name TEXT NOT NULL UNIQUE (BINARY).

**Рекомендуемый фикс:** В upsertSupplier нормализовать имя перед проверкой (toLowerCase() + схлопывание пробелов \s+ → ' ') и сравнивать выборку всех имён в JS: listSuppliers().some(s => normalize(s.name) === normalize(name) && s.id !== id). Само хранимое имя оставлять как ввёл пользователь.

### 29. Переименование поставщика не обновляет supplier_name в актах и партиях; UI смешивает живое и замороженное имя

**Где:** `src/lib/db/queries/suppliers.ts:110` · **Направление:** Поставщики (добор)

stock_documents.supplier_name и stock_lots.supplier_name — денормализованные копии, снимаемые в момент сохранения черновика/проведения (getSupplierSnapshot, stock-documents.ts:206-219). upsertSupplier при UPDATE (suppliers.ts:110-127) меняет только suppliers.name и НЕ трогает копии. При этом UI использует имя из РАЗНЫХ источников: (а) фильтр актов по поставщику строит пункты по ЖИВОМУ имени (stock-acts-supplier-filter.tsx:48), а строки таблицы актов показывают ЗАМОРОЖЕННОЕ document.supplierName (stock/acts/page.tsx:188) — после переименования владелец выбирает в фильтре «НовоеИмя» и видит акты, подписанные «СтароеИмя»; (б) форма редактирования черновика резолвит имя живьём по id (stock-document-form.tsx:251), а страница деталей того же черновика показывает замороженное (stock/acts/[id]/page.tsx:76) — один и тот же черновик в двух местах подписан по-разному; (в) createStockCorrectionDraft (stock-documents.ts:697-698) копирует УСТАРЕВШЕЕ имя из исходного акта вместо повторного снапшота, и при проведении корректировки это старое имя штампуется в НОВЫЕ партии (stock-documents.ts:639 → stock-lots.ts:120), которые показываются в контроле свежести (stock-lots-client.tsx:188). Сейчас расхождений в данных нет (переименований ещё не было — проверено SQL), баг латентный, но обе формы поставщика позволяют менять name свободно.

**Доказательство:** suppliers.ts:113-120: UPDATE suppliers SET name = @name ... WHERE id = @id — никаких UPDATE stock_documents/stock_lots. stock-documents.ts:698: supplierName: String(original.supplier_name ?? "") — копия из исходника, не из suppliers. Контрольный SQL (сейчас пусто, расхождений ещё нет): SELECT sd.id FROM stock_documents sd LEFT JOIN suppliers s ON s.id=sd.supplier_id WHERE sd.supplier_id IS NOT NULL AND sd.supplier_name <> s.name; → 0 строк.

**Рекомендуемый фикс:** Минимум: в upsertSupplier при переименовании обновлять supplier_name у ЧЕРНОВИКОВ актов (status='draft') и в createStockCorrectionDraft снапшотить живое имя по supplier_id. Лучше: в списках/деталях актов и партий выводить живое имя JOIN'ом по supplier_id с фолбэком на замороженное (для проведённых исторических документов решить продуктово: снапшот или живое).

### 30. История закупок поставщика задваивает поставки: корректировки и их отменённые черновики выглядят как отдельные закупки

**Где:** `src/lib/db/queries/suppliers.ts:165` · **Направление:** Поставщики (добор)

getSupplierPurchaseHistory выбирает ВСЕ stock_in поставщика без фильтра по статусу и без маркировки корректировок (corrects_document_id не отдаётся в UI страницы). Страница /suppliers/[id] (src/app/suppliers/[id]/page.tsx:110-127) показывает только Номер/Дату/Статус/Позиций — ни признака «это корректировка акта X», ни сумм. В прод-БД у поставщика id=1 это уже даёт 5 строк «истории закупок» при 2 реальных поставках: IN-000001 (Проведен), IN-000002 и IN-000003 (Отменен — брошенные черновики корректировок IN-000001), IN-000004 (Скорректирован) и IN-000005 (Проведен — корректировка IN-000004). Пара IN-000004+IN-000005 в глазах владельца — две поставки с позициями в каждой; отменённые черновики корректировок дополнительно раздувают список. Комментарий в коде («его проведённые/черновые приходные акты») не соответствует фактическому поведению — выбираются и cancelled, и corrected. Дополнительно: сортировка по created_at, а колонка показывает operationAt ?? createdAt — задним числом датированные приёмки выводятся не по порядку дат.

**Доказательство:** suppliers.ts:171: WHERE stock_documents.supplier_id = ? AND stock_documents.type = 'stock_in' — без фильтра статуса и без corrects_document_id в выводе страницы (grep "corrects" по src/app/suppliers/[id]/page.tsx — 0 совпадений). Прод-SQL: SELECT number, status, corrects_document_id FROM stock_documents WHERE supplier_id=1 AND type='stock_in' → IN-000005|posted|5; IN-000004|corrected|; IN-000003|cancelled|1; IN-000002|cancelled|1; IN-000001|posted| — 5 строк на 2 физические поставки.

**Рекомендуемый фикс:** В истории закупок скрывать cancelled-черновики, для актов с corrects_document_id выводить бейдж «Корректировка акта N» (или схлопывать пару corrected+его корректировку в одну строку), сортировать по COALESCE(operation_at, created_at).

### 31. Проведение затирает параллельные движения: stock := counted, а quick-fill подставляет устаревший снапшот — проведение «всего склада» в рабочий день откатило бы продажи

**Где:** `src/lib/db/queries/stock-inventory.ts:231` · **Направление:** Инвентаризация

Дизайн (по согласованной записи): дельта = counted − expected(снапшот), применяется К живому остатку. Код делает иначе: delta = counted − живой stock и `UPDATE products SET stock = counted` — то есть остаток просто перезаписывается фактом. Комментарий в коде («параллельные продажи не затираются») неверен: если товар физически посчитан (counted=95), а ПОСЛЕ подсчёта продали 5 шт (живой stock=95−5... т.е. продажа уменьшила живой остаток), проведение вернёт stock к counted и сотрёт эффект продажи. Хуже всего в связке с «Остальные совпадают»: туда подставляется expectedQty — СНАПШОТ на момент создания акта, а не текущий остаток. В магазине продажи идут каждые несколько минут (см. movements 05:11–08:45); проведение инвентаризации по всему складу через bulk-fill вернуло бы остатки всех 230 позиций к значениям на момент снапшота, откатив все промежуточные продажи/приходы как «излишки» с движением adjustment.

**Доказательство:** stock-inventory.ts:231 `const delta = roundMoney(counted - beforeStock)` и :238-239 `UPDATE products SET stock = ? ... .run(counted, productCode)` при комментарии :197-199 «дельта = counted_qty − ЖИВОЙ products.stock (не от снимка → параллельные продажи не затираются)»; inventory-detail-client.tsx:92 `counted: String(item.expectedQty ?? 0)` — подставляется снапшот, хотя живой остаток (item.currentStock) доступен в той же строке таблицы (колонка «Текущий», :284).

**Рекомендуемый фикс:** Либо применять дельту от снапшота к живому остатку (stock += counted − expected), либо в quick-fill подставлять currentStock; перед проведением предупреждать, если живой остаток разошёлся со снапшотом по сосчитанным строкам.

### 32. Каждое сохранение черновика стирает комментарий документа и сбрасывает operation_at на «сейчас»

**Где:** `src/lib/db/queries/stock-inventory.ts:133` · **Направление:** Инвентаризация

saveInventoryDraft безусловно обновляет comment и operation_at из FormData, но форма подсчёта (buildSaveFormData, inventory-detail-client.tsx:115-125) отправляет только documentId/itemId/countedQty/varianceReason. В итоге clean(null) = "" затирает комментарий, введённый при создании инвентаризации, а fromDatetimeLocalValue(null) возвращает new Date().toISOString() — operation_at молча переписывается на момент сохранения. Комментарий с экрана списка (/stock/inventory, колонка «Комментарий») пропадает после первого же «Сохранить».

**Доказательство:** stock-inventory.ts:131-135: `const comment = clean(formData.get("comment")); const operationAt = fromDatetimeLocalValue(formData.get("operationAt")); client.prepare("UPDATE stock_documents SET comment = ?, operation_at = ? WHERE id = ?")...`; в buildSaveFormData нет ни formData.set("comment"), ни "operationAt"; datetime.ts:11-19: пустое значение → `new Date().toISOString()`.

**Рекомендуемый фикс:** Обновлять comment/operation_at только если поля присутствуют в FormData (formData.has(...)), либо отправлять текущие значения из клиента.

### 33. Сохранение — полная перезапись всех 230 строк из состояния клиента: устаревшая вкладка молча обнуляет ранее сохранённый подсчёт; несохранённый ввод теряется при навигации

**Где:** `src/components/stock/inventory-detail-client.tsx:44` · **Направление:** Инвентаризация

Состояние rows инициализируется один раз при монтировании (useState с инициализатором) из doc.items и далее не синхронизируется с сервером. buildSaveFormData всегда отправляет ВСЕ позиции, а saveInventoryDraft пишет NULL для пустых значений. Сценарий: вкладка/устройство Б открыто до того, как на А сохранили подсчёт; любое «Сохранить»/«Провести» на Б отправит пустые countedQty и сотрёт весь сохранённый прогресс (counted_qty → NULL) без предупреждения — нет ни оптимистичной блокировки, ни проверки версии. Обратная сторона: автосохранения нет — уход со страницы (sidebar-навигация, перезагрузка) теряет весь набранный, но не сохранённый факт. Оба эффекта дают «факты то пропадали»: в БД все 4 документа так и остались с counted=0.

**Доказательство:** inventory-detail-client.tsx:44-53 — `useState<Record<number, RowState>>(() => {...})` (инициализация однократная); :118-123 — `for (const item of doc.items) { formData.append("countedQty", row?.counted ?? "") }`; stock-inventory.ts:152-163 — пустая строка → `countedQty = null` и UPDATE без какого-либо сравнения версий документа.

**Рекомендуемый фикс:** Передавать в save метку версии (например updated_at/count_started_at) и отклонять устаревшую запись; обновлять только изменённые строки; добавить автосохранение или предупреждение beforeunload при несохранённом вводе.

### 34. Предоплата молча теряется при «Сохранить черновик» на кассе

**Где:** `src/components/cash/cash-page.tsx:1158` · **Направление:** Леджер и резервы

Кнопка «Сохранить черновик» (data-intent="draft", cash-page.tsx:1578) находится в той же форме, что и поле «Предоплата» (name="prepaid", строка 1397-1405). Для черновика handleSubmit пропускает ВСЕ проверки (включая needsShift и prepaidTooHigh) и сразу отправляет форму (строки 1155-1161). Сервер createOrderDraft (order-lifecycle.ts:311-373) поле prepaid полностью игнорирует — в INSERT жёстко прошито prepaid=0, paid=0 (строка 339), кассовая операция не создаётся. Оператор вводит предоплату 2000, жмёт «Сохранить черновик» — успех без единого предупреждения, деньги физически в кассе, но нигде не учтены (expectedCash смены разойдётся, клиентская предоплата потеряна). Вернуть её некуда: updateOrderDraft предоплату тоже не принимает, а finalizeOrderDraftAction(orderId, priceMode) (actions.ts:1003) не имеет параметра предоплаты — ветка prepaid>0 внутри finalizeOrderDraft (строки 574-585) мёртвая (prepaid у черновика всегда 0) и вдобавок жёстко прошивает paymentMethod: "cash" (строка 581), что стрельнёт неверным способом оплаты, если ветку когда-нибудь оживят.

**Доказательство:** cash-page.tsx:1155-1161: // Черновик ... предоплата необязательны ... if (submitter?.getAttribute("data-intent") === "draft") { onSubmit(event, resetForm); return } — до проверок prepaid; order-lifecycle.ts:338-339: ... 'Черновик', ... @totalBeforeDiscount, @total, 0, 0, (prepaid, paid); order-lifecycle.ts:581: paymentMethod: "cash" в finalizeOrderDraft.

**Рекомендуемый фикс:** При intent=draft либо блокировать сохранение с ненулевой предоплатой (toast «Черновик не принимает предоплату»), либо обнулять поле в UI при сохранении черновика. На сервере createOrderDraft — бросать ошибку при prepaid>0 вместо молчаливого игнора.

### 35. Детализация K1: коллизия кода сбрасывает настройки партий (track_lots/vase_life_days) жертвы

**Где:** `src/lib/db/queries/products.ts:42` · **Направление:** Карточки товаров (CRUD)

Новая деталь известной проблемы K1. Форма товара ВСЕГДА отправляет скрытый маркер lotSettingsPresent=on (src/components/stock/stock-page.tsx:912), а в форме «Новый товар» чекбокс «Вести по партиям» по умолчанию снят и vaseLifeDays пуст. При сохранении «нового» товара с занятым кодом upsertProduct берёт значения партий ИЗ ФОРМЫ (hasLotSettings=true), и ON CONFLICT перезаписывает track_lots=0 и vase_life_days=NULL у существующего товара. Т.е. коллизия не только переименовывает товар (K1), но и молча отключает у него учёт по партиям. Полный список затираемых полей при коллизии: name, category_path, article, unit, cost_price, sale_price, track_lots, vase_life_days. НЕ затираются: stock/reserved/expected (защищены через before, строки 35–37), image_path и is_active (не входят в UPDATE). Пока track_lots_enabled=0 в проде — спящая бомба: после включения флага любая коллизия кода будет тихо ломать партионный учёт.

**Доказательство:** products.ts:42-49: `const hasLotSettings = formData.get("lotSettingsPresent") === "on"; const trackLots = hasLotSettings ? formData.get("trackLots") === "on" ? 1 : 0 : ...` + ON CONFLICT(code) DO UPDATE SET ... track_lots = excluded.track_lots, vase_life_days = excluded.vase_life_days (строки 77-78). stock-page.tsx:912: `<input type="hidden" name="lotSettingsPresent" value="on" />` — маркер в форме безусловный. SQL: app_settings → track_lots_enabled|0.

**Рекомендуемый фикс:** В upsertProduct разделить пути create/insert и edit/update: для создания — INSERT без ON CONFLICT с ошибкой «Код уже занят товаром …»; настройки партий брать из формы только в режиме редактирования.

### 36. Детализация K1: коллизия с архивным товаром — «новый» товар сохраняется невидимым (is_active остаётся 0)

**Где:** `src/lib/db/queries/products.ts:60` · **Направление:** Карточки товаров (CRUD)

Новая деталь K1. INSERT ... ON CONFLICT(code) DO UPDATE не трогает колонку is_active. Если владелец создаёт «новый» товар с кодом, который занят АРХИВНЫМ товаром (is_active=0), upsert переименует архивный товар, вернёт «Товар сохранен.», но товар не появится ни в списке активных (getDashboardData: WHERE COALESCE(is_active,1)=1, src/lib/db/queries/dashboard.ts:34), ни в подборах кассы/заказов. Пользователь видит успех, товара нигде нет; при этом архивная позиция получила чужое имя/цены. Сейчас архив пуст (SQL: 0 строк с is_active=0), но архив задеплоен и будет использоваться — сценарий реалистичен (повторное использование штрих-кода).

**Доказательство:** Колонки UPDATE в products.ts:67-79 — is_active отсутствует: `ON CONFLICT(code) DO UPDATE SET category_path=..., article=..., name=..., unit=..., stock=..., reserved=..., expected=..., cost_price=..., sale_price=..., track_lots=..., vase_life_days=..., updated_at=...`. dashboard.ts:33-38: `WHERE COALESCE(is_active, 1) = 1 ... LIMIT 234`.

**Рекомендуемый фикс:** При создании запрещать коллизию вовсе (см. предыдущую находку); если оставлять upsert — при конфликте с архивным товаром явно сообщать «код занят товаром в архиве» и предлагать восстановление.

### 37. Детализация K1: аудит перезаписи почти слепой — в movements нет старых/новых значений, инцидент не диагностируется

**Где:** `src/lib/db/queries/products.ts:116` · **Направление:** Карточки товаров (CRUD)

Новая деталь механики K1, объясняющая, почему инцидент с кодом 00177165698580 продолжался часами. upsertProduct пишет в аудит-журнал movements только строку 'Обновлен товар <code>' с НОВЫМ именем; старое имя, старые/новые цены и категория не фиксируются нигде. stock_movements (adjustment) пишется только при изменении stock/reserved (строка 102), а при коллизии stock сохраняется из before — т.е. перезапись имени и цен вообще не оставляет числовых следов. По данным прода: остаток 243 шт под «Гортензия местная» физически состоит из 171 шт импорта «Хризантема Китай кустовая» (04.06) + 80 шт прихода по акту IN-000007 (09.06); продажи зафиксированы под обоими именами; reserved=10 по двум заказам — какие реально цветы зарезервированы, по данным БД установить невозможно.

**Доказательство:** SQL movements по коду 00177165698580: id 598 sale «Хризантема Китай кустовая» → 617 «Аллиум (агапантус)» → 620 «Хризантема» → 627 «Гортензия местная» → 637-639 «юкка» → 642-643 «Аллиум» → 646 «юкка» → 647 «Гортензия» → 703 sale «Гортензия местная». SQL stock_movements: id 97 import 171 шт (под Хризантему), id 1159 stock_in +80 «Акт IN-000007», текущий продукт: stock 243, reserved 10, cost_price 60. Код: addMovement(... note: `Обновлен товар ${code}`) — без diff (products.ts:116-122).

**Рекомендуемый фикс:** В addMovement при обновлении товара писать diff (старое имя → новое, старые/новые цены); при смене name у существующего кода — отдельный тип записи rename.

### 38. deleteProduct не проверяет сделки, букеты, черновики заказов, черновики актов и партии — UI при этом обещает обратное

**Где:** `src/lib/db/queries/products.ts:181` · **Направление:** Карточки товаров (CRUD)

deleteProduct проверяет только: reserved>0, позиции АКТИВНЫХ заказов (черновики 'Черновик' явно исключены из проверки) и sale_items. НЕ проверяются: (1) deal_items — товар в сделках CRM, хотя диалог удаления прямо обещает «Если товар встречается в продажах, заказах или сделках — удаление не выполнится» (stock-page.tsx:453-455) — для сделок это ложь, createOrderFromDeal потом упадёт с «Товар … не найден.» (src/lib/db/domain/deal-orders.ts:65-66); (2) order_items черновиков заказов — после удаления finalizeOrderDraft бросает «Товар … не найден — обновите позицию» (src/lib/db/domain/order-lifecycle.ts:492-494), черновик застревает; (3) stock_document_items черновиков актов — postStockDocument бросает «Товар … не найден.» (src/lib/db/queries/stock-documents.ts:407-409), черновик акта непроводим; (4) bouquet_template_items — состав букета молча осиротевает, букет навсегда «недоступен» (LEFT JOIN → stock 0) без объяснения; (5) stock_lots — активные партии с qty_remaining остаются status='active' и продолжают попадать в отчёт по партиям (LEFT JOIN products в stock-lots.ts:327-328 не отфильтрует их). Осиротевших строк в БД пока 0 (удаление применялось редко), но все пути подтверждены кодом — баг латентный.

**Доказательство:** products.ts:181-198: проверки только `orders.status NOT IN ('Черновик', 'Выдан', 'Отменен')` и `SELECT COUNT(*) FROM sale_items WHERE product_code = ?` — упоминаний deal_items/bouquet_template_items/stock_document_items/stock_lots в функции нет. stock-page.tsx:454-455: «Если товар встречается в продажах, заказах или сделках — удаление не выполнится». SQL: все 6 проверок на осиротевшие ссылки = 0 (пока).

**Рекомендуемый фикс:** Добавить в транзакцию deleteProduct проверки: deal_items активных сделок, order_items черновиков, stock_document_items документов status='draft', bouquet_template_items, активные stock_lots (или закрывать их в той же транзакции). Либо привести текст диалога к реальности и рекомендовать архив.

### 39. Архивный товар остаётся продаваемым через букеты — вопреки «скроется из продаж и подборов»

**Где:** `src/lib/db/queries/bouquets.ts:238` · **Направление:** Карточки товаров (CRUD)

setProductArchived блокируется только при reserved>0 (products.ts:238). Состав букета берёт остаток через LEFT JOIN products БЕЗ фильтра is_active, поэтому букет с архивным компонентом продолжает считаться доступным (stock архивного товара не списывается при архивации). createSale тоже не проверяет is_active — только существование товара (src/lib/db/queries/sales.ts:35-37) — продажа букета спишет остаток архивного товара и пройдёт успешно. Это противоречит диалогу архивации: «товар скроется из продаж, заказов и подборов» (stock-page.tsx:428-429). Аналогично черновик акта пополнения с товаром, заархивированным после сохранения черновика, проводится без предупреждения — приход ложится на скрытый товар (postStockDocument проверяет только существование, stock-documents.ts:406-409).

**Доказательство:** bouquets.ts:238-242: `COALESCE(products.stock, 0) as stock ... LEFT JOIN products ON products.code = bouquet_template_items.product_code` — фильтра is_active нет. sales.ts:35-37: `const product = getProduct(client, productCode); if (!product) throw ...` — is_active не проверяется (ledger.getProduct: `SELECT * FROM products WHERE code = ?`).

**Рекомендуемый фикс:** При архивации предупреждать о вхождении в активные букеты (или помечать букет недоступным); в createSale/доступности букетов учитывать is_active.

### 40. Сторнированная продажа в «Хронологии кассы» выглядит как обычный приход: пометки «Сторнировано» нет, а её cash_refund вообще не попадает в ленту

**Где:** `src/components/cash/cash-page.tsx:1950` · **Направление:** Продажи/возвраты и остатки

buildTimelineRows собирает ленту из трёх источников: (1) все detail.sales — включая сторнированные, всегда с положительной суммой и без бейджа (запрос sales в getShiftDetails, shifts.ts:514-538, не фильтрует и даже не выбирает reversed_at; rowToSale в db-row.ts:165-187 поля reversedAt не имеет); (2) relatedOrders — только cash_transactions с order_id IS NOT NULL; (3) ручные операции — строка 1950 пропускает всё с saleId !== null, т.е. и проводку 'sale', и её возврат 'cash_refund' (у сторно продажи order_id=NULL, sale_id задан). Итог: после сторно кассир видит в хронологии «+12 551.80 Продажа» без какого-либо следа возврата, видимая сумма ленты не сходится с expectedCash/выручкой смены, и эта же строка предлагает активный селект смены метода оплаты (см. находку про updatePaymentMethod). На странице /history (cash-ledger.tsx) флаги reversed есть — рассинхрон только в ленте кассы.

**Доказательство:** cash-page.tsx:1913-1926: `for (const sale of detail.sales) { rows.push({ ... outflow: false, refund: false, ... editTarget: { target: "sale", id: sale.id } }) }` — без проверки reversed; cash-page.tsx:1950: `if (tx.orderId !== null || tx.saleId !== null) { continue }` — возврат по продаже (order_id NULL, sale_id задан) отфильтровывается. Прод: в смене 5 продажи #88 и #95 сторнированы (sales.reversed_at IS NOT NULL), их возвраты tx 174/177 в ленту не попадают.

**Рекомендуемый фикс:** Выбирать reversed_at в запросе sales (shifts.ts), помечать строку бейджем «Сторнировано», отключать editTarget; возвраты с sale_id показывать отдельной строкой-расходом (или вместе с продажей).

### 41. Черновик инвентаризации (type=count) можно открыть и «пересохранить» в общем редакторе актов — снимок и подсчёты уничтожаются

**Где:** `src/lib/db/queries/stock-documents.ts:255` · **Направление:** Акты склада (приход/списание/корректировка)

Гейт «инвентаризацию проводите через её раздел» стоит только в postStockDocumentInTransaction (строка 355-356), но НЕ в saveStockDocumentDraftInTransaction (строки 248-257 проверяют только status='draft'). Страница /stock/acts показывает и count-документы (listStockDocuments не исключает type='count'; в прод-БД 4 акта INV-* видны в списке), карточка акта показывает кнопку «Редактировать» для любого черновика (src/app/stock/acts/[id]/page.tsx:134), а /stock/acts/[id]/edit/page.tsx:26 проверяет только status, не type. В результате черновик инвентаризации открывается в StockDocumentForm с подписью «Пополнение» (isWriteOff=false для count), и «Сохранить черновик» выполняет DELETE всех stock_document_items + INSERT только (qty, unit_cost, comment) — теряются expected_qty (снимок), counted_qty, counted_at, variance_reason, applied по всем строкам. Часы подсчёта (инвентаризация по всей номенклатуре — ~230 строк) уничтожаются без возможности восстановления. Инвентаризация на проде ВКЛЮЧЕНА (app_settings: enable_inventory=1), сценарий реален.

**Доказательство:** saveStockDocumentDraftInTransaction: `if (String(existing.status) !== "draft") throw ...` — проверки типа нет; далее `client.prepare("DELETE FROM stock_document_items WHERE document_id = ?").run(documentId)` и insertItem только с (document_id, product_code, product_name, qty, unit_cost, comment). Для сравнения postStockDocumentInTransaction:355: `if (String(document.type) === "count") { throw new Error("Инвентаризацию проводите через её раздел.") }`. SQL: app_settings → enable_inventory=1; в stock_documents есть INV-000001..INV-000004 (type=count), которые отображаются в /stock/acts.

**Рекомендуемый фикс:** В saveStockDocumentDraftInTransaction добавить тот же гейт для existing.type==='count' (и для input.type==='count'); в /stock/acts/[id] и /stock/acts/[id]/edit для type==='count' вести на /stock/inventory/[id] вместо общего редактора.

### 42. Импорт XLSX записывает отрицательную себестоимость без валидации (в БД уже есть товар с cost_price = -3.48)

**Где:** `src/lib/db/queries/warehouse.ts:205` · **Направление:** Акты склада (приход/списание/корректировка)

applyWarehouseImport применяет costPrice из файла как есть: parseImportNumber (form-parsers.ts:92-101) принимает отрицательные числа, и UPDATE/INSERT в products пишет их в cost_price без проверки. Отрицательная себестоимость затем участвует в оценке списаний («Стоимость списания» в актах считается по costPrice) и в любых маржинальных расчётах. Примечание по направлению (г) аудита: сам пересчёт средневзвешенной при приходе от отрицательного остатка защищён — basis = max(0, beforeStock) (stock-documents.ts:431), т.е. знаменатель не может стать отрицательным; единственный найденный в БД отрицательный cost_price пришёл именно через импорт, а не через приход (recompute_cost_on_receipt на проде выключен = 0).

**Доказательство:** SQL: SELECT code,name,stock,cost_price FROM products WHERE cost_price < 0 → 00074|Стифа|-193.0|-3.48; stock_movements: type=import, qty=-193, comment='Импорт склада XLSX: 1' (2026-06-04). Источник — колонка себестоимости в выгрузке МойСклад (в seed-CSV для Стифы значение -3.63). Код: warehouse.ts:205 `item.costPriceProvided ? item.costPrice ?? 0 : numberFromRow(existing.cost_price)` и :223 для INSERT — отрицательные значения проходят без клампа.

**Рекомендуемый фикс:** При построении preview помечать строки с costPrice < 0 (или salePrice < 0) как ошибку, либо клампить к 0 с предупреждением в отчёте импорта; текущий товар 00074 поправить вручную.

### 43. Удаление товара оставляет «бессмертные» активные партии: их нельзя списать и они навсегда зависают в «Контроле свежести»

**Где:** `src/lib/db/queries/products.ts:212` · **Направление:** Партии и сроки годности

deleteProduct проверяет резерв, активные заказы и историю продаж, но НЕ проверяет stock_lots и не чистит их (FK на stock_lots нет — PRAGMA foreign_key_list(stock_lots) пуст). Товар с track_lots=1 и проведённым приходом (партия есть, продаж ещё нет — все гварды пройдены) можно удалить. После удаления: reconcileProductLots выходит досрочно (stock-lots.ts:177-180 `if (!product) return`) — партия больше никогда не сверяется и остаётся active с qty_remaining>0; она вечно отображается на /stock/lots (LEFT JOIN products → имя пустое, показывается голый код) и в виджете просрочки; кнопка «Списать» всегда падает, т.к. writeOffLot → applyProductDelta (stock-lots.ts:291) кидает «Товар … не найден» (ledger.ts:158-161) и транзакция откатывается. Убрать партию из UI невозможно никаким способом.

**Доказательство:** products.ts:170-212 — в транзакции deleteProduct нет ни SELECT/UPDATE/DELETE по stock_lots, ни проверки на активные партии; `client.prepare("DELETE FROM products WHERE code = ?").run(code)`. stock-lots.ts:176-180: `const product = getProduct(client, productCode); if (!product) { return }`. writeOffLot: stock-lots.ts:291-298 вызывает applyProductDelta по удалённому коду → throw. Действие доступно владельцу из UI: actions.ts:768 deleteProductAction, stock-page.tsx:466.

**Рекомендуемый фикс:** В deleteProduct блокировать удаление при наличии партий со status='active' и qty_remaining>0 (по аналогии с проверкой резерва), либо в той же транзакции помечать партии 'reverted' с revert-движением. Дополнительно: предлагать архив вместо удаления для товаров с партиями.

### 44. Поиск на складе не ищет по категории, поиск на кассе — ищет: один и тот же запрос даёт 25 товаров на кассе и 0 на складе

**Где:** `src/components/stock/stock-page.tsx:269` · **Направление:** Видимость и поиск товаров

Оба экрана фильтруют один и тот же массив data.products клиентски через toLowerCase().includes (кириллица сворачивается корректно — JS, не SQLite LIKE), но строки-«стога» разные. Склад (stock-page.tsx:269): `${product.code} ${product.article} ${product.name}` — категория НЕ входит. Касса (product-combobox.tsx:65-70): [product.name, product.code, product.article, product.categoryPath].join(" ") — категория входит. Любой запрос, совпадающий только с category_path, находит товары на кассе (и в подборе для заказов/актов через ProductCombobox), но даёт пусто на складе. Это структурный источник жалоб вида «на кассе находится, на складе нет» для товаров, чьё видовое слово живёт в категории, а не в названии (например, товары категории «Базовый цветок 65%», «Сухоцветы» и т.п. с краткими именами). Плейсхолдер на складе при этом обещает поиск «по названию, коду или артикулу» — категория там и не заявлена, но расхождение с кассой остаётся неочевидным для пользователя.

**Доказательство:** stock-page.tsx:267-269: `const matchesQuery = !normalized || \`${product.code} ${product.article} ${product.name}\`.toLowerCase().includes(normalized)`. product-combobox.tsx:65-70: `.filter((product) => [product.name, product.code, product.article, product.categoryPath].join(" ").toLowerCase().includes(normalizedQuery))`. SQL: запрос «базовый» — category_path LIKE '%азовый%' → 25 активных товаров (найдутся на кассе); name/code/article LIKE '%азовый%' → 0 (на складе пусто).

**Рекомендуемый фикс:** Унифицировать: добавить categoryPath в строку поиска склада (или вынести построение haystack в общий хелпер, используемый и stock-page, и ProductCombobox).

### 45. Выдача поиска на кассе ранжируется «минусовые и пустые первыми» и обрезается до 10 строк — товары с нормальным остатком вытесняются за обрез

**Где:** `src/components/products/product-combobox.tsx:85` · **Направление:** Видимость и поиск товаров

ProductCombobox не ранжирует совпадения — он сохраняет порядок входного массива и обрезает до maxResults (10 по умолчанию: line 32; slice line 85). Входной массив на кассе — data.products из getDashboardData, отсортированный CASE-ом «минус → мало (≤3) → норма» (dashboard.ts:36). Эта сортировка сделана для таблицы склада (проблемные сверху), но на кассе она становится ранжированием поиска: при наборе короткого запроса первые 10 строк — это товары в минусе и с нулевым остатком, а товары, которые реально есть на складе, оказываются в хвосте и при >10 совпадений вообще не показываются. Кассир либо выбирает минусовую позицию (усугубляя K3), либо не видит «продаваемый» товар и считает, что его нет.

**Доказательство:** product-combobox.tsx:85: `return [...productResults, ...bouquetResults].slice(0, maxResults)` (defaultMaxResults = 10, line 32) — ни сортировки по релевантности, ни по наличию. SQL (порядок dashboard-запроса) для «роза»: 1) «Роза микс 40-70см» available −162, 2) «композа» −7, и лишь затем «Онигозантус» 22, «Роза 80 см» 74, «роза Китай» 92 — минусовые возглавляют выдачу уже сегодня.

**Рекомендуемый фикс:** Сортировать результаты комбобокса по релевантности (префиксное совпадение имени выше) и/или по available DESC, не наследуя «диагностическую» сортировку склада; поднять maxResults либо показывать счётчик скрытых совпадений.

### 46. raw:false + числовые коды Excel: код «1.77166E+11» вместо реального — импорт молча плодит товары-дубли вместо обновления

**Где:** `src/lib/db/queries/warehouse.ts:309` · **Направление:** Импорт/экспорт XLSX

Все 230 кодов каталога — длинные цифровые строки с ведущими нулями (например 00177165698580). Если пользователь в Excel вводит/вставляет код как число (Excel делает это сам), то: ведущие нули теряются, а sheet_to_json с raw:false возвращает ОТФОРМАТИРОВАННЫЙ текст ячейки — для General-формата чисел ≥12 цифр это научная нотация. Проверено на установленной в проекте версии xlsx: числовая ячейка 177165698580 читается как строка "1.77166E+11". Валидация кода — только «code пустой» (строка 342–344), формат не проверяется, поэтому такая строка проходит превью как «Новый товар» с мусорным кодом и при apply создаёт товар-дубль, а реальный товар не обновляется. Это массовый родственник инцидента K1: остатки «уезжают» на фантомные позиции. Файл из /warehouse/export безопасен (коды пишутся как текст), но любой файл, набранный или отредактированный в Excel с числовыми ячейками кода, ломается.

**Доказательство:** warehouse.ts:309-312: `XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: false })`. Эмпирическая проверка (node + project xlsx): `aoa_to_sheet([['code','stock'],[177165698580,10]])` → `sheet_to_json(..., {raw:false})` → `[{"code":"1.77166E+11","stock":"10"}]`. В normalizeWarehouseImportRow единственная проверка кода: `if (!cleanCell(row.code)) { errors.push("code пустой") }`.

**Рекомендуемый фикс:** В normalizeWarehouseImportRow помечать ошибкой коды, похожие на научную нотацию (/[eE]\+?\d+$/ для цифровых кодов), и/или читать ячейку code через raw-значение с собственным форматированием (cell.v для type 'n' → String с полной точностью). Дополнительно: предупреждать в превью, если «новый» код состоит из цифр, но не найден, при том что существует код с теми же цифрами без ведущих нулей.

### 47. Импорт молча переименовывает/перекатегоризирует существующий товар; превью не показывает старое имя

**Где:** `src/lib/db/queries/warehouse.ts:194` · **Направление:** Импорт/экспорт XLSX

При совпадении code UPDATE-ветка apply перезаписывает name, category_path, article, unit значениями из файла (пустая ячейка = оставить старое). Это аналог K1 в массовом масштабе, но с экраном подтверждения — проблема в том, что подтверждение НЕ показывает переименование: warehouse_import_items не хранит old_name/old_category (insertWarehouseImportItems, строки 473–481, пишет только code, name, category_path — новые значения), а страница превью /warehouse/imports/[id] выводит только новое имя (page.tsx:121 `{item.name || "-"}`) и старые/новые значения лишь для stock и цен. Строка с опечаткой в коде (или с кодом, искажённым Excel в обратную сторону) выглядит в превью как безобидное «Обновлен», хотя на самом деле перепишет имя чужого товара — увидеть это до apply невозможно.

**Доказательство:** warehouse.ts:194-208: `UPDATE products SET category_path = ?, article = ?, name = ?, unit = ? ... WHERE code = ?` c аргументом `item.name || String(existing.name ?? "")`; в схеме warehouse_import_items (schema.ts:272+) и в INSERT (warehouse.ts:474-480) нет полей old_name/new_name — только `code, name, category_path` без старых значений.

**Рекомендуемый фикс:** Хранить old_name/old_category в warehouse_import_items и подсвечивать в превью строки, где имя/категория существующего товара меняются (бейдж «Переименование: было → станет»).

### 48. Экспорт склада выгружает архивные товары без признака is_active — обратный импорт молча правит скрытые позиции

**Где:** `src/lib/db/queries/warehouse.ts:84` · **Направление:** Импорт/экспорт XLSX

createWarehouseExportWorkbook берёт `SELECT * FROM products` без фильтра по is_active и не включает колонку is_active в выгрузку — архивный товар в файле неотличим от активного. Рабочий цикл «экспорт → правка в Excel → импорт» при наличии архивных позиций молча применит к ним дельты остатка и цены (getProduct в импорте тоже не смотрит на is_active), при этом товар останется невидимым в складском UI — остатки «изменятся в никуда». Импорт также не разархивирует товар. Сегодня архивных товаров 0 (фича архива задеплоена недавно), поэтому баг латентный, но проявится с первым же архивированием при привычке клиента пользоваться экспортом/импортом.

**Доказательство:** warehouse.ts:84: `client.prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE").all()` — ни WHERE is_active, ни поля is_active в маппинге (строки 86–97: code, name, article, category_path, unit, stock, reserved, available, sale_price, cost_price). SQL: `SELECT count(*) FROM products WHERE is_active=0` → 0 (колонка существует, архив пуст).

**Рекомендуемый фикс:** Добавить в экспорт колонку is_active (или archived: да/нет) либо выгружать архивные на отдельный лист; в превью импорта помечать строки по архивным товарам предупреждением.


## Низкая (44)

### 49. Кассовые actions доступны флористу шире, чем UI: reverseCashTransaction и acceptDealPayment вызываемы без доступа к их страницам

**Где:** `src/app/actions.ts:968` · **Направление:** Роли, server actions, инвалидация

reverseCashTransactionAction (отмена служебных внесений/изъятий, по комментарию — «из Истории кассы») и acceptDealPaymentAction (приём оплаты по сделке) обёрнуты в runCashAction, т.е. серверная граница — лишь canUseCash. Для флориста canUseCash = любая открытая смена (auth.ts:192), а страницы, где эти кнопки рендерятся, ему закрыты: /history — owner/manager (src/app/history/page.tsx:14), /deals/[id] — не florist (src/app/deals/[id]/page.tsx). Server Actions — это публичные POST-эндпоинты сборки: аутентифицированный флорист может вызвать их напрямую (без UI) и, например, отменить служебную кассовую операцию чужой смены или провести оплату по сделке, которую даже не может открыть. Это рассинхрон типа «action можно вызвать, но страницу не видно»: серверная проверка слабее видимости UI, в отличие от черновиков заказов, где границу сознательно сделали серверной (["owner","manager"]).

**Доказательство:** actions.ts:968-975: `export async function reverseCashTransactionAction(formData) { return runCashAction((user) => { reverseCashTransaction(formData, user); ... } }`; actions.ts:757-766: `acceptDealPaymentAction ... runCashAction(...)`; auth.ts:192: `return user.role === "florist" && Boolean(getOpenShift())`. UI-вызовы только из закрытых флористу страниц: cash-ledger.tsx:7 (страница /history, guard owner/manager) и deal-detail-page.tsx:21 (страница /deals/[id], florist → AccessDenied).

**Рекомендуемый фикс:** Для reverseCashTransactionAction и acceptDealPaymentAction добавить роль-проверку: runCashAction + requireActionRole(["owner","manager"]) (или отдельная обёртка runManagerCashAction), раз UI этих операций флористу не предъявляется.

### 50. revalidatePath с query-string — но-оп: `/orders?orderId=...` не соответствует семантике API

**Где:** `src/app/actions.ts:728` · **Направление:** Роли, server actions, инвалидация

createOrderFromDealAction (строка 728) и updateOrderFromDealAction (строка 739) вызывают revalidatePath(`/orders?orderId=${orderId}`). По документации Next 16 (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md) параметр path — это «string that represents your route file structure», литеральный путь или паттерн с динамическими сегментами; query-string не является частью файловой структуры маршрута и кэш-записей, поэтому такой вызов ничего не инвалидирует. Безвреден только потому, что строкой выше уже есть revalidatePath("/orders"), но намерение «обновить конкретный вид заказа» не выполняется и вводит в заблуждение при чтении кода.

**Доказательство:** actions.ts:727-728: `revalidatePath("/orders")\n    revalidatePath(\`/orders?orderId=${orderId}\`)`; docs revalidatePath.md:25: "`path`: Either a string that represents your route file structure ... This can be a literal path like `/product/123`, or a route pattern ..." — query-строки не упоминаются и не участвуют в тегировании кэша по route file.

**Рекомендуемый фикс:** Удалить оба вызова с query-string (достаточно revalidatePath("/orders")).

### 51. Системные пробелы revalidatePath (партии, история, дашборд) — сегодня замаскированы временным поведением Next 16

**Где:** `src/app/actions.ts:174` · **Направление:** Роли, server actions, инвалидация

Базовый список runAction (строки 174-182) инвалидирует только /, /stock, /cash, /ready-orders, /orders, /bouquets, /shifts, /users, /settings. Не входят: /dashboard (не инвалидируется НИ ОДНИМ action — grep по файлу подтверждает 0 вхождений), /history, /history/stock, /stock/lots, /stock/acts, /stock/inventory, /suppliers, /deals, /clients. Конкретные дыры: createStockDocumentAction/postStockDocumentAction (проведение stock_in создаёт партии stock_lots) не трогают /stock/lots; markOrderReadyAction (order_fulfill списывает склад и партии) не трогает /stock/lots и /history/stock; updatePaymentMethodAction не трогает /history, где способ оплаты отображается в леджере. Сегодня это НЕ даёт видимых багов по трём причинам: (1) все страницы force-dynamic + cookies() — сервер всегда рендерит свежие данные; (2) staleTimes.dynamic по умолчанию 0 c Next 15 (docs staleTimes.md: "The `dynamic` `staleTimes` default changed from 30s to 0s"); (3) текущая семантика revalidatePath в Server Functions: «it also causes all previously visited pages to refresh when navigated to again. This behavior is temporary and will be updated in the future to apply only to the specific path» (revalidatePath.md, Good to know). Когда Next уберёт временное поведение (п.3), пропущенные пути превратятся в реальные устаревшие списки. Компоненты частично страхуются router.refresh() (cash-page.tsx:154, cash-ledger.tsx:283/342/400, stock-document-form.tsx:178) — это покрывает текущую страницу, но не остальные.

**Доказательство:** actions.ts:174-182 — фиксированный список revalidatePath без /dashboard, /history/stock, /stock/lots и др.; `grep -n 'revalidatePath("/stock/lots")' src/app/actions.ts` → единственное вхождение строка 410 (writeOffLotAction), хотя постинг stock_in тоже создаёт партии; docs revalidatePath.md:16: "Currently, it also causes all previously visited pages to refresh when navigated to again. This behavior is temporary".

**Рекомендуемый фикс:** Перейти на тэги (revalidateTag/updateTag по доменам: products, lots, cash-ledger) или один revalidatePath("/", "layout") в runAction вместо ручного перечня — тогда будущая смена семантики Next не сломает свежесть списков.

### 52. Проверка «Не хватает компонентов» в корзине считается по каждой группе букета изолированно и по raw stock

**Где:** `src/components/products/product-line-items.tsx:118` · **Направление:** Букеты и доступность

В корзине (касса/заказ/редактирование заказа) requiredByCode агрегируется только внутри ОДНОЙ группы букета: два одинаковых букета в чеке — две независимые группы (createBouquetGroupId уникален), каждая сверяется с полным остатком. Букет, требующий 7 роз при остатке 10, добавленный дважды (нужно 14), не покажет ни одного предупреждения. Отдельные строки того же товара вне букета тоже не суммируются с потребностью букета. Плюс getShortfall использует product.stock без вычета reserved (та же проблема, что в getBouquetAvailability), и при отсутствии товара в переданном списке products (архивный или срезанный LIMIT 234 из getDashboardData — смежно с K2) возвращает 0, т.е. молчит. Серверной проверки на продаже нет (K3), так что это единственный заслон — и он дырявый.

**Доказательство:** product-line-items.tsx:118-121: `const requiredByCode = new Map(); for (const item of group.items) { ... requiredByCode.set(item.productCode, (requiredByCode.get(item.productCode) ?? 0) + qty) }` — цикл только по group.items, не по всем items. :532-539: `function getShortfall(requestedQty, product) { if (!product) { return 0 } ... return Math.max(0, qty - stock) }` — без reserved, отсутствующий товар = «всё в порядке».

**Рекомендуемый фикс:** Агрегировать потребность по productCode по ВСЕМ строкам чека (букеты + одиночные позиции) и сравнивать с available = stock - reserved.

### 53. applyWarehouseImport: можно применить сколь угодно старый preview — гард только по status='applied', дельты посчитаны на момент preview

**Где:** `src/lib/db/queries/warehouse.ts:170` · **Направление:** Гонки и транзакционность

applyWarehouseImport отклоняет повторное применение того же импорта (status='applied' → throw), но не ограничивает применение по возрасту/актуальности preview: запись со статусом 'preview' остаётся применимой бессрочно. stock_delta каждой строки зафиксирован в report_json на момент preview (newStock − oldStock_на_момент_preview, для новых товаров — весь newStock), а при apply прибавляется к ТЕКУЩЕМУ остатку. Сценарии: (1) владелец загрузил файл дважды (два preview), применил оба — каждый прибавит свою дельту, остаток задвоится; (2) applyWarehouseImportAction(importId) — публичный server action c ролью owner, его можно вызвать со старым importId (UI-страница /warehouse/imports/[id] кнопки «Применить» не имеет, но сам action не проверяет «свежесть»), и дельты недельной давности лягут на сегодняшний остаток; (3) строка action='create' по товару, появившемуся между preview и apply, уйдёт в UPDATE-ветку и добавит полный файловый stock поверх уже существующего. Сама дельта-схема (комментарий TOCTOU в строках 186–189) корректно защищает от затирания продаж между preview и apply, проблема только в отсутствии границы устаревания/одного активного preview. В прод-данных пока ровно один импорт и он applied — инцидентов нет.

**Доказательство:** warehouse.ts:164-175: `if (current.status === "applied") { throw new Error("Этот импорт уже применен.") }` — других гардов нет; warehouse.ts:188-189: `const intendedStockDelta = numberFromRow(item.stockDelta); const appliedStock = currentStock + intendedStockDelta` (stockDelta — из report_json, снимок на момент preview; для create-строк stockDelta = newStock целиком, см. строку 438). Прод: `SELECT id,status FROM warehouse_imports` → одна запись, applied.

**Рекомендуемый фикс:** При создании нового preview помечать прежние записи 'preview' как 'superseded' (применять можно только последний), и/или при apply сверять old_stock строк со свежим остатком и требовать повторный preview при расхождении; минимум — TTL на применение preview.

### 54. Идемпотентность создания продажи/заказа держится только на disabled-кнопках клиента — серверного ключа идемпотентности нет

**Где:** `src/lib/db/queries/sales.ts:82` · **Направление:** Гонки и транзакционность

Проверка направления (д) по всем мутациям склада/кассы. Проведение/отмена актов, инвентаризации, импорта и сторно кассовых операций идемпотентны на сервере: внутри транзакции повторно перечитывается статус ('draft'/'applied'/reverses_id — например stock-documents.ts:350, warehouse.ts:170, cash.ts:373-376), повторный сабмит получает ошибку. Но createSale и createOrder таких проверок не имеют и иметь не могут (каждый вызов = новая запись): защита от двойного сабмита — исключительно `disabled={pending}` на кнопках (cash-page.tsx: кнопки «Провести продажу»/«Провести заказ» с pending-гардом через useTransition). Окно: два быстрых клика/тапа до ре-рендера на медленном устройстве, либо повтор POST server action на нестабильной сети — создаст вторую идентичную продажу с повторным списанием склада и второй кассовой проводкой. Проверка прод-БД на пары продаж одной смены с одинаковой суммой в пределах 3 секунд дала 0 совпадений — на практике пока не стреляло; фиксирую как осознанный риск, а не инцидент.

**Доказательство:** sales.ts:82-178 (createSale) — в транзакции нет ни клиентского токена, ни проверки на дубликат; SQL-проверка: `SELECT s1.id, s2.id ... FROM sales s1 JOIN sales s2 ON s2.shift_id=s1.shift_id AND s2.total=s1.total AND ABS(strftime('%s',s2.created_at)-strftime('%s',s1.created_at))<=3` → пусто.

**Рекомендуемый фикс:** Добавить в формы продажи/заказа скрытый одноразовый clientRequestId (uuid при открытии формы) и UNIQUE-колонку в sales/orders: повторный сабмит того же id вернёт уже созданную запись вместо дубля.

### 55. Импорт склада принимает отрицательные stock и cost_price без ошибки или предупреждения

**Где:** `src/lib/db/queries/warehouse.ts:345` · **Направление:** Форензика данных (app.db)

Валидация строки импорта (normalizeWarehouseImportRow, строки 340–358) проверяет только «пустой» и «не число», но не знак значения. В результате XLSX-импорт от 2026-06-04 молча записал в прод товар 00074 «Стифа» с stock = −193 и cost_price = −3.48. Отрицательная себестоимость ломает оценку склада (−193 × −3.48 даёт фиктивную ПОЛОЖИТЕЛЬНУЮ стоимость остатка +671) и испортит средневзвешенную себестоимость при будущем приходе этого товара. Та же дыра пропускает отрицательный sale_price.

**Доказательство:** Код (warehouse.ts:345–358): `if (!stockRaw) { errors.push("stock пустой") } else if (stock === null) { errors.push("stock не число") } ... if (costPriceRaw && costPrice === null) { errors.push("cost_price не число") }` — проверок `< 0` нет. SQL: `SELECT code,name,stock,cost_price FROM products WHERE cost_price<0;` → `00074|Стифа|-193.0|-3.48`. Источник: `SELECT type,qty,comment FROM stock_movements WHERE product_code='00074';` → `import|-193.0|Импорт склада XLSX: 1` (2026-06-04 00:01:30).

**Рекомендуемый фикс:** В normalizeWarehouseImportRow добавить ошибки/предупреждения для stock<0, cost_price<0, sale_price<0 (минимум — warning в отчёте предпросмотра импорта). Для «Стифы» — ручная корректировка cost_price.

### 56. Дубликат товара «коробка бренд 26 см» под двумя кодами — оба активны, с остатками

**Где:** `app.db` · **Направление:** Форензика данных (app.db)

Единственная пара полных дубликатов имён в каталоге: коды 00177165698797 (stock 14, cost 483) и 00177165698799 (stock 7, cost 484). Оба созданы одним импортом 2026-06-04, одинаковая категория и цена продажи 1100. На кассе и в заказах их невозможно различить — остаток будет списываться с того кода, который случайно выбрали, и расхождение с физическим остатком гарантировано. Смежно с инцидентом K1 (перезапись по коду), но это отдельный кейс: два живых кода с одним именем.

**Доказательство:** SQL: `SELECT name, COUNT(*), GROUP_CONCAT(code) FROM products GROUP BY name HAVING COUNT(*)>1;` → `коробка бренд 26 см|2|00177165698799,00177165698797`. Детали: 797 → stock 14, cost 483, sale 1100; 799 → stock 7, cost 484, sale 1100; оба is_active=1, created_at 2026-06-04 00:01:30, категория «3.Сопутствующие товары 5%/Коробки, корзины». Нормализованный поиск (LOWER/TRIM/NBSP) других почти-дубликатов не нашёл.

**Рекомендуемый фикс:** Слить остатки в один код (корректировкой), второй архивировать (is_active=0). В UI формы товара — предупреждение при совпадении имени с существующим активным товаром.

### 57. Заказ на 0 руб прошёл весь цикл до «Передан курьеру» — createOrder не требует total > 0

**Где:** `src/lib/db/domain/order-lifecycle.ts:105` · **Направление:** Форензика данных (app.db)

Заказ ORD-20260604-0005: единственная позиция «Букет» с ценой 0, total = 0, paid = 0, статус «Передан курьеру» — товар выдан курьеру бесплатно. В createOrder есть только проверка `prepaid > total`, требования положительной суммы заказа (или явного подтверждения «подарок») нет. В сочетании с 32 активными товарами с sale_price = 0 (включая товары с реальной себестоимостью: «вазон 40 см» cost 492, «свечи на батарейках» cost 151) это открытый путь к выдаче товара без выручки.

**Доказательство:** SQL: `SELECT id,number,status,total,paid FROM orders WHERE id=5;` → `5|ORD-20260604-0005|Передан курьеру|0.0|0.0`; `SELECT name,qty,price FROM order_items WHERE order_id=5;` → `Букет|1.0|0.0`. Код (order-lifecycle.ts:105): `if (prepaid > total && total >= 0) { throw new Error("Предоплата не может быть больше суммы заказа.") }` — это единственная проверка суммы. `SELECT COUNT(*) FROM products WHERE sale_price=0 AND is_active=1;` → 32.

**Рекомендуемый фикс:** Требовать total > 0 при создании/финализации заказа (или явный чекбокс «безвозмездно»); предупреждать при добавлении позиции с ценой 0.

### 58. 98% строк stock_document_items — мёртвые снапшоты четырёх ОТМЕНЁННЫХ инвентаризаций; enable_inventory уже включён на проде

**Где:** `app.db` · **Направление:** Форензика данных (app.db)

920 из 938 строк stock_document_items имеют qty = 0 и принадлежат четырём отменённым документам инвентаризации INV-000001..INV-000004 (каждый снапшотит все 230 товаров при старте). Все четыре попытки сделаны 08–09.06 и отменены через 24 сек – 7 минут после старта — ни одна не доведена до posted. Это и рост мусорных данных (+230 строк за каждую попытку, отменённые снапшоты не чистятся), и сигнал возможной UX-проблемы фичи. Попутный факт: app_settings.enable_inventory = 1 — флаг на проде уже включён (в заметках проекта числился OFF).

**Доказательство:** SQL: `SELECT d.type,d.status,COUNT(*) FROM stock_document_items i JOIN stock_documents d ON d.id=i.document_id WHERE i.qty=0 GROUP BY 1,2;` → `count|cancelled|920` (всего строк в таблице: 938). `SELECT id,number,status,created_at,cancelled_at FROM stock_documents WHERE type='count';` → INV-000001 (23:49:25 → отмена 23:49:49), INV-000002 (23:57:46 → 00:04:48), INV-000003 (10:53:22 → 10:55:00), INV-000004 (11:04:52 → 11:07:12), по 230 позиций каждый. `SELECT key,value FROM app_settings;` → `enable_inventory|1`.

**Рекомендуемый фикс:** Чистить items при отмене черновика инвентаризации (или хранить только изменённые строки); выяснить у пользователей, почему все 4 инвентаризации отменены.

### 59. WAL-файл 3.78 МБ при БД 0.96 МБ — чекпойнта не было с 2026-06-08 23:46 (факт, без действий)

**Где:** `app.db` · **Направление:** Форензика данных (app.db)

app.db-wal вырос до 3 782 192 байт (~918 фреймов по 4120 байт) при основном файле 1 003 520 байт; mtime app.db = 2026-06-08 23:46 (момент последнего чекпойнта, совпадает с рестартом после деплоя), mtime WAL = 2026-06-09 18:28. Дефолтный автопорог SQLite — 1000 страниц, т.е. WAL просто ещё не дошёл до него; при следующем коммите за порогом чекпойнт должен пройти, если его не блокирует долгоживущий читатель Next-процесса. integrity_check = ok, freelist = 0 — повреждений нет. Зафиксировано как факт, никаких checkpoint/VACUUM не выполнялось.

**Доказательство:** `stat`: app.db 1003520 (mtime 2026-06-08 23:46:34), app.db-wal 3782192 (mtime 2026-06-09 18:28:19). `PRAGMA page_count;`→270, `PRAGMA page_size;`→4096, `PRAGMA freelist_count;`→0, `PRAGMA integrity_check;`→ok. 3782192 / (4096+24) ≈ 918 фреймов < 1000 (wal_autocheckpoint по умолчанию).

**Рекомендуемый фикс:** Ничего срочного. При желании — периодический `PRAGMA wal_checkpoint(TRUNCATE)` в тихое время или при штатном рестарте сервиса; в бэкап обязательно включать -wal/-shm (или бэкапить через .backup).

### 60. Контрольная проверка: леджер stock_movements и ссылочная целостность полностью чисты (аномалий нет)

**Где:** `app.db` · **Направление:** Форензика данных (app.db)

Информационная находка для полноты форензики. (а) Replay леджера по всем 230 товарам: base = before_stock первого движения + SUM(qty) движений, меняющих остаток (типы import/sale/order_fulfill/adjustment/stock_in/stock_out; reserve/reserve_cancel остаток не меняют, у всех 403 таких движений after_stock=before_stock) — расхождений с products.stock НОЛЬ. (б) Непрерывность цепочек: по всем товарам after_stock[i]==before_stock[i+1] и after_reserved[i]==before_reserved[i+1] — 0 разрывов из ~1150 переходов: операций «мимо леджера» нет. (в) products.reserved (263 ед. по 25 товарам) точно равен сумме qty позиций 11 заказов с is_reserved=1 — 0 расхождений. (г) Сироты: 13 проверок (movements/sale_items/order_items/doc_items/lots по product_code; document_id/sale_id/order_id/shift_id/customer_id/deal_id/lot_id ссылки) — 0 строк. Math-проверки сумм sale_items/order_items/sales/orders/stock_documents — 0 расхождений. Вывод: отрицательные остатки (K3) — «честный» результат операций и импорта, а не порча данных.

**Доказательство:** Replay: `WITH base AS (первое before_stock), sums AS (SUM(qty) WHERE type NOT IN ('reserve','reserve_cancel')) SELECT ... WHERE ABS(stock - (base+delta))>0.001` → 0 строк. Цепочки: `LAG(after_stock) OVER (PARTITION BY product_code ORDER BY id)` vs before_stock → 0 разрывов (и по reserved → 0). Резервы: сравнение products.reserved с SUM(order_items.qty) по is_reserved=1 → 0 строк. Сироты: 13 × `NOT EXISTS(...)` → все 0.

**Рекомендуемый фикс:** Не требуется — фиксация чистого состояния как базовой линии для будущих аудитов.

### 61. Округление landed_unit_cost на единицу: qty*landed_unit_cost расходится с (qty*unit_cost + allocated_overhead); на проде Σqty*landed по акту IN-000006 = 70488.19 при landed_total = 70488.00

**Где:** `src/lib/db/queries/stock-documents.ts:421` · **Направление:** Себестоимость и накладные (добор)

landedUnitCost = roundMoney((qty*unitCost + allocatedOverhead)/qty) округляется до копейки НА ЕДИНИЦУ, поэтому стоимость строки, восстановленная как qty*landed_unit_cost, отклоняется от точной до ±0.005*qty (на проде до 29 копеек на строку при qty=60). Дрейф попадает дальше в два места: (1) средневзвешенный пересчёт cost_price использует qty*landedUnitCost, а не точную сумму qty*unitCost+allocatedOverhead (строка 434) — при включённом флаге пересчёт систематически чуть смещён; (2) stock_lots.unit_cost хранит округлённую landed-цену (stock-lots.ts:124), так что «стоимость партии» qty*unit_cost тоже не сходится с фактическими затратами. Та же формула продублирована в корректировке (строка 608). Дрейф ограничен на уровне документа и не накапливается между документами (каждое проведение считает от исходных unit_cost), поэтому severity low — но если появится отчёт «стоимость склада по партиям» или сверка с landed_total, расхождения в копейках/десятках копеек на документ гарантированы.

**Доказательство:** Прод, акт 9 (IN-000006): SELECT ROUND(SUM(qty*landed_unit_cost),2), landed_total → 70488.19 vs 70488.0. Построчно: 00012 qty=60 unit_cost=357 alloc=183.89 landed=360.06 → дрейф −0.29; 00177165699030 qty=48 → +0.22; суммарно +0.19 по документу.

**Рекомендуемый фикс:** В средневзвешенном пересчёте использовать точную сумму строки (qty*unitCost + allocatedOverhead) вместо qty*landedUnitCost; в партии при необходимости хранить и точную стоимость партии (line_total), а landed_unit_cost оставить справочным.

### 62. by_value: позиция с нулевой ценой получает нулевую долю накладных и landed=0; при recompute ON условие landedUnitCost > 0 исключает бесплатные поступления из средневзвешенной (бесплатный приход никогда не снижает cost_price)

**Где:** `src/lib/db/queries/stock-documents.ts:430` · **Направление:** Себестоимость и накладные (добор)

При методе by_value вес строки = qty*unit_cost (allocateOverhead, строка 179), поэтому строка с unit_cost=0 среди платных получает вес 0: на неё не ложится ни копейки накладных (вся доставка перераспределяется на платные строки, хотя физически везла и её), и её landed_unit_cost = 0. Деления на ноль нет — если НУЛЕВЫЕ все строки, срабатывает фолбэк на распределение по количеству (строки 181–184, qty всегда ≥1), это проверено и работает. Но дальше включается вторая ступень: гейт пересчёта `landedUnitCost !== null && landedUnitCost > 0` (строка 430) полностью исключает такую строку из средневзвешенного пересчёта — поступление N бесплатных единиц не разбавляет среднюю себестоимость, хотя экономически (basis*oldCost + qty*0)/(basis+qty) должна её снизить. Гейт, судя по комментарию, защищает от затирания cost_price при забытой цене закупки — но он же делает невозможным учёт реально бесплатных/бонусных поставок. Реальный прецедент уже в БД: в акте IN-000006 строка товара 00004 (qty=70, unit_cost=0) получила allocated_overhead=0 и landed=0, а все 600 накладных легли на остальные 9 строк. Сумма распределения при этом сходится точно (Σallocated=600.00=overhead_total — остаток округления корректно докинут в строку с максимальным весом), эта часть багов не содержит.

**Доказательство:** Прод, акт 9: строка 514 → product 00004, qty=70, unit_cost=0, allocated_overhead=0, landed_unit_cost=0; остальные 9 строк в сумме несут ровно 600.00 (SELECT SUM(allocated_overhead) ... document_id=9 → 600.0 при overhead_total=600.0).

**Рекомендуемый фикс:** Различать «цена не указана» и «цена 0»: для строк с заведомо нулевой ценой (бонус) включать их в пересчёт средневзвешенной с landed=0+доля накладных, либо в UI предупреждать при проведении прихода с нулевой ценой строки при выбранном by_value, что накладные на неё не распределятся (и предлагать by_qty).

### 63. След резервов полностью невидим: reserve/reserve_cancel исключены из истории, и больше их не показывает ни один экран

**Где:** `src/lib/db/queries/history.ts:68` · **Направление:** История склада и отчёты (добор)

stockMovementsQuery жёстко фильтрует WHERE stock_movements.type NOT IN ('reserve', 'reserve_cancel'). Этот же запрос питает и /history/stock, и ленту дашборда, а XLSX-экспорт дополнительно дублирует фильтр (route.ts:74). Grep по 'reserve' в src/components и src/app показал: единственные упоминания — скрытый input value={product?.reserved} в stock-page.tsx:859 и нулевое значение в stock-document-form.tsx:85, т.е. показывается только ТЕКУЩЕЕ число резерва, но нигде нет истории. В проде 271 строка reserve + 133 reserve_cancel (31% всего леджера) не видны ни в одном UI и ни в одном экспорте. Владелец не может выяснить, каким заказом и когда был «заблокирован» остаток (особенно осиротевшие резервы: reserve без парного reserve_cancel/order_fulfill), хотя данные в БД есть.

**Доказательство:** history.ts:68: "WHERE stock_movements.type NOT IN ('reserve', 'reserve_cancel')"; export/route.ts:74: ".filter((movement) => ![\"reserve\", \"reserve_cancel\"].includes(movement.type))". SQL: SELECT type, COUNT(*) FROM stock_movements GROUP BY type → reserve|271, reserve_cancel|133. grep -rln "reserve" src/components src/app → только revenue-chart.tsx (ложное срабатывание preserveAspectRatio), stock-page.tsx:859 (hidden input текущего reserved), stock-document-form.tsx:85 (reserved: 0), export/route.ts (сам фильтр).

**Рекомендуемый фикс:** Добавить на /history/stock переключатель/фильтр «показать резервы» (или отдельную вкладку), убрав безусловный NOT IN из запроса; в словарь типов добавить 'reserve' → «Резерв», 'reserve_cancel' → «Снятие резерва».

### 64. Словарь типов в XLSX-экспорте неполный: в выгрузку утекают сырые английские типы stock_in/stock_out/payment_method_change/cash_reversal

**Где:** `src/app/history/export/route.ts:100` · **Направление:** История склада и отчёты (добор)

movementLabel в export/route.ts (один словарь на оба листа) не содержит ключей 'stock_in'/'stock_out' (есть в дубликате словаря на /history/stock/page.tsx:98-107) и 'payment_method_change'/'cash_reversal' (нет нигде). Фактические типы из БД, отображаемые «как есть» в XLSX: лист «Склад» — stock_in (14 строк), stock_out (1); лист «Операции» — payment_method_change (4), cash_reversal (2). Владелец видит в официальной выгрузке «stock_in» вместо «Пополнение по акту». Корень — два рассинхронизированных рукописных словаря вместо общего labels-модуля.

**Доказательство:** export/route.ts:100-110: labels = { import, sale, order_fulfill, stock_update, delete_product, shift_open, shift_close, order_create, order_status } — нет stock_in/stock_out/payment_method_change/cash_reversal; :112 "return labels[movement.type] ?? movement.type". Страница page.tsx:98-104 содержит stock_in: «Пополнение по акту», stock_out: «Списание по акту». SQL: DISTINCT type → в stock_movements есть stock_in(14)/stock_out(1), в movements — payment_method_change(4)/cash_reversal(2).

**Рекомендуемый фикс:** Вынести общий словарь типов движений в src/lib/labels.ts и использовать его и на странице, и в экспорте; добавить недостающие 4 ключа.

### 65. В XLSX-экспорте листа «Склад» теряется связь движения с актом: колонка «Связь» пуста для всех stock_in/stock_out

**Где:** `src/app/history/export/route.ts:115` · **Направление:** История склада и отчёты (добор)

movementSource в экспорте проверяет только saleId/orderId/shiftId и возвращает "" во всех остальных случаях — ветка documentId/documentNumber, которая есть в версии на странице (/history/stock/page.tsx:141-148, ссылка «Акт IN-000007»), отсутствует. По данным БД движения типов stock_in/stock_out имеют ТОЛЬКО document_id (sale/order/shift = NULL), поэтому в выгрузке все 15 актовых движений + 2 документных adjustment идут с пустой «Связью» — в Excel невозможно понять, каким актом сделано пополнение/списание, хотя номер документа уже выбран запросом (documentNumber, history.ts:61).

**Доказательство:** export/route.ts:115-129: movementSource проверяет movement.saleId / orderId / shiftId и "return \"\"" — ветки documentId нет; page.tsx:141-148 для сравнения: "const label = movement.documentNumber ? `Акт ${movement.documentNumber}` : ...". SQL: SELECT type, SUM(document_id IS NOT NULL), SUM(sale_id IS NOT NULL), SUM(order_id IS NOT NULL), SUM(shift_id IS NOT NULL) FROM stock_movements GROUP BY type → stock_in|14|14|0|0|0, stock_out|1|1|0|0|0, adjustment 2 строки с document_id.

**Рекомендуемый фикс:** Добавить в movementSource экспорта ветку: if (movement.documentId !== null) return movement.documentNumber ? `Акт ${movement.documentNumber}` : `Акт #${movement.documentId}`.

### 66. /history/stock не показывает дату операции акта (operation_at): акт задним числом встаёт в хронологию по моменту проведения без какой-либо пометки

**Где:** `src/app/history/stock/page.tsx:64` · **Направление:** История склада и отчёты (добор)

Акты поддерживают пользовательскую дату операции: operation_at вводится в форме (stock-documents.ts:233, datetime-local) и используется как receivedAt партий (:371, :573). Но история склада сортирует и отображает только stock_movements.created_at (момент проведения): в таблице единственная колонка «Дата» = createdAt, operation_at не выбирается запросом вовсе (history.ts:43-69). Если кладовщик проведёт акт за вчера (поставка пришла вечером, акт провели утром), в /history/stock и в XLSX движение встанет сегодняшним числом без указания фактической даты операции — сверка «что пришло вчера» по этому отчёту даст неверный результат. Сейчас в проде реально задним числом проведённых актов нет (по 6 актам operation_at ≈ created_at + 6ч — это известный TZ-сдвиг, не дублирую), но механика открыта для каждого следующего акта.

**Доказательство:** page.tsx:64: "<TableCell>{formatDateTime(movement.createdAt)}</TableCell>" — единственная дата; stockMovementsQuery (history.ts:43-69) не содержит operation_at; сортировка :69 "ORDER BY stock_movements.created_at DESC". SQL: SELECT sd.number, sd.operation_at, MIN(sm.created_at) FROM stock_documents sd JOIN stock_movements sm ON sm.document_id=sd.id GROUP BY sd.id → IN-000007|2026-06-09T16:36:00.000Z|2026-06-09 10:38:16 и т.д. — поле существует и заполняется, но в историю не пробрасывается.

**Рекомендуемый фикс:** Добавить в stockMovementsQuery LEFT JOIN-поле stock_documents.operation_at и выводить для документных движений вторую дату «Дата операции» (или пометку «проведено задним числом» при расхождении > суток).

### 67. getDashboardData выполняет на 7 горячих страницах два мёртвых запроса лент истории — результат не использует ни один компонент

**Где:** `src/lib/db/queries/dashboard.ts:99` · **Направление:** История склада и отчёты (добор)

dashboard.ts:99-105 на каждый рендер выполняет historyOperationsQuery(80) (movements + JOIN users) и stockMovementsQuery(120) (stock_movements + 3 JOIN'а), кладёт их в DashboardData.movements/.stockMovements. getDashboardData() вызывается на /orders, /cash, /bouquets, /stock, /stock/acts/[id]/edit, /ready-orders, /shifts (все force-dynamic, т.е. на каждый запрос). При этом grep по src/components не находит НИ ОДНОГО потребителя: ни один tsx-файл компонентов не упоминает movements/stockMovements/тип Movement; страницы истории используют отдельные getHistoryReportData()/getCashLedger(). 200 строк с джойнами читаются и маппятся (rowToMovement) впустую на каждом заходе на кассу/заказы — лента «последние операции», ради которой это писалось, после рефакторинга в новые шеллы никуда не выводится.

**Доказательство:** dashboard.ts:99-105: "const movements = (client.prepare(historyOperationsQuery(80))..." / "const stockMovements = (client.prepare(stockMovementsQuery(120))...". grep -rl "movements" src/components --include=*.tsx → пусто; grep "movements|Movement" src/components/cash/cash-page.tsx → пусто; getDashboardData вызывается в 7 page.tsx (grep -rn "getDashboardData(" src).

**Рекомендуемый фикс:** Удалить movements/stockMovements из getDashboardData и из типа DashboardData (либо вернуть ленту в UI, если она планировалась).

### 68. getCashLedger молча обрезает хронологию на 1000 записей без индикатора «показаны не все»

**Где:** `src/lib/db/queries/history.ts:76` · **Направление:** История склада и отчёты (добор)

getCashLedger(limit = 1000) отдаёт последние 1000 строк cash_transactions; /history (page.tsx:18) вызывает его без аргумента и рендерит как полную «Историю кассы». Сейчас в таблице 245 строк — лимит не режет, но при текущем темпе продаж (~560 продаж за неделю по stock_movements) порог будет достигнут в течение 1–2 месяцев, после чего старые записи просто исчезнут из «истории» без пометки об усечении, пагинации или фильтра по периоду. Фиксирую как замечание роста по той же схеме, что K2 (LIMIT 234).

**Доказательство:** history.ts:76: "export function getCashLedger(limit = 1000)" + :97 "LIMIT ?"; src/app/history/page.tsx:18: "const entries = getCashLedger()" — индикатора усечения в CashLedger нет. SQL: SELECT COUNT(*) FROM cash_transactions → 245.

**Рекомендуемый фикс:** Добавить пагинацию по периоду/курсору либо хотя бы баннер «показаны последние N операций» при достижении лимита (сравнить entries.length с limit).

### 69. seedDefaultUsers воссоздаёт owner admin/fb2026 (захардкоженный пароль в репозитории) при любой пустой таблице users

**Где:** `src/lib/db/seed.ts:54` · **Направление:** Сид/миграции/reset (добор)

При COUNT(users)=0 на холодном старте создаётся владелец admin с паролем fb2026, захардкоженным в коммитнутом коде (и продублированным в CLAUDE.md). Reset сохраняет users, так что на текущем проде путь не срабатывает, но любая новая инсталляция/восстановление с пустой users получает общеизвестный owner-доступ ко всей кассе и CRM. Проверка прода: login='admin' (id=1, role=owner) существует, однако пароль СМЕНЁН — bcrypt.compareSync('fb2026', password_hash) = false, поэтому это не критическая дыра сейчас, а мина для будущих развёртываний.

**Доказательство:** seed.ts:54: `.run("admin", "Управляющий", "owner", hashPassword("fb2026"))`. Прод: `SELECT id, login, role FROM users` → `1|admin|owner|...`; локальная проверка `bcryptjs.compareSync('fb2026', <hash из БД>)` → false (пароль не дефолтный).

**Рекомендуемый фикс:** Генерировать случайный пароль при сиде и печатать его в stdout один раз (или требовать env ADMIN_INITIAL_PASSWORD); убрать fb2026 из кода и документации.

### 70. Проверено и НЕ является багом: PRAGMA user_version внутри транзакции миграции откатывается корректно; migrateBaseline идемпотентен

**Где:** `src/lib/db/migrate.ts:57` · **Направление:** Сид/миграции/reset (добор)

Зацепка про версионирование не подтвердилась — фиксирую, чтобы не перепроверяли: (1) user_version хранится в заголовке БД (страница 1) и пишется через обычный pager/WAL, т.е. ТРАНЗАКЦИОНЕН — при падении migration.up() внутри client.transaction(...) откат вернёт и схему (DDL в SQLite транзакционен), и старую версию; «проскочить» версия не может. (2) Для БД, созданной до введения user_version (fromVersion=0 при живых данных), повторный прогон migrateBaseline безопасен: все CREATE TABLE — IF NOT EXISTS, все добавления колонок — через ensureColumn с PRAGMA table_info-проверкой (schema.ts:4-14). На проде user_version=18, все 18 миграций применены. (3) connection.ts: better-sqlite3 по умолчанию ставит busy_timeout=5000ms — реального механизма поломки от отсутствия явной настройки не найдено; единственный реальный риск от разросшегося WAL описан в находке про бэкап.

**Доказательство:** migrate.ts:57-60: `client.transaction(() => { migration.up(client); client.pragma(`user_version = ${migration.version}`) })()`; schema.ts:10-13 (ensureColumn через PRAGMA table_info); прод: `PRAGMA user_version` → 18.

**Рекомендуемый фикс:** Действий не требуется (информационная запись для аудита).

### 71. cancelStockDocument позволяет перевести скорректированный акт (status='corrected') в 'cancelled'

**Где:** `src/lib/db/queries/stock-documents.ts:801` · **Направление:** Поставщики (добор)

Гейт в cancelStockDocument блокирует только 'posted' (строка 801: throw) и no-op для 'cancelled' (804); статус 'corrected' проваливается в UPDATE ... SET status='cancelled' (808-810). UI показывает кнопку «Отменить» только для черновиков ([id]/page.tsx:134-141), но cancelStockDocumentAction (actions.ts:835) — это публичный server-action endpoint: любой owner-запрос с id скорректированного акта молча перепишет его историю. Последствия: акт, чьи движения уже откатаны и замещены корректировкой, начинает выглядеть как «Отменен» (т.е. якобы никогда не проводился), пропадает из фильтра «Скорректированные» на /stock/acts и из визуальной связки с корректировкой, хотя corrected_by_document_id и движения в журнале остаются. Связь «исправленный акт ↔ корректировка» становится противоречивой.

**Доказательство:** stock-documents.ts:800-810: if (document.status === "posted") { throw ... } if (document.status === "cancelled") { return } client.prepare("UPDATE stock_documents SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?").run(documentId) — ветки для 'corrected' нет, статус не входит в whitelist.

**Рекомендуемый фикс:** Разрешать отмену только из статуса 'draft': if (document.status !== "draft") throw new Error("Отменить можно только черновик.") (с сохранением текущего no-op для 'cancelled').

### 72. upsertSupplier с нечисловым id молча создаёт нового поставщика вместо ошибки

**Где:** `src/lib/db/queries/suppliers.ts:21` · **Направление:** Поставщики (добор)

const id = Number(clean(formData.get("id"))) — при испорченном значении (например, id="3a" из устаревшей/чужой формы) Number(...) даёт NaN, который falsy. Ветка if (id && !existing) не срабатывает, existing остаётся undefined, и выполнение уходит в INSERT (строка 129): вместо ошибки «Поставщик не найден» молча создаётся ДУБЛЬ поставщика со значениями из формы (все отсутствующие в короткой форме реквизиты — пустые). Через штатный UI не воспроизводится (hidden input всегда содержит корректный id), но это server action — формы доступны для прямого вызова. Тот же паттерн «тихого создания вместо ошибки», что и в K1.

**Доказательство:** suppliers.ts:21: const id = Number(clean(formData.get("id"))); suppliers.ts:29-34: const existing = id ? ... : undefined; if (id && !existing) throw — NaN falsy, обе проверки пропускаются; suppliers.ts:110: if (id) { UPDATE ... } — NaN falsy → выполняется INSERT (129-143).

**Рекомендуемый фикс:** Парсить id строго: пустая строка → null (создание); иначе требовать Number.isInteger(parsed) && parsed > 0, при нарушении — throw new Error("Некорректный идентификатор поставщика.").

### 73. Фильтр «Расхождения» в черновике смотрит на сохранённые поля, а колонка «Разница» — на живой ввод: строки с введённым расхождением исчезают из фильтра до сохранения

**Где:** `src/components/stock/inventory-detail-client.tsx:75` · **Направление:** Инвентаризация

В режиме черновика фильтр variance: `item.countedQty != null && item.countedQty - expectedQty !== 0` — это СОХРАНЁННОЕ counted_qty, тогда как колонка «Разница» (:279) считается из живого ввода rows. Пользователь вводит факт с расхождением, нажимает «Расхождения» — строка не показывается (counted_qty ещё NULL); после «Сохранить» + refresh — появляется. Аналогично «Не сосчитано» продолжает показывать строки с уже введённым (но не сохранённым) фактом, и они «исчезают» из этого фильтра только после сохранения. Для «uncounted» это осознанное решение (комментарий :62-63 и коммит ea7f8d8), но для «Расхождения» рассинхрон фильтра с видимой колонкой «Разница» — готовое объяснение феномена «позиции то пропадали, то появлялись» в форме подсчёта. Дополнительно: клиентский diff не понимает запятую (Number("1,5") = NaN → в колонке «NaN»), хотя сервер через toNumber запятую принимает.

**Доказательство:** inventory-detail-client.tsx:64-78: `if (filter === "uncounted") return item.countedQty == null; ... if (isDraft) return item.countedQty != null && item.countedQty - (item.expectedQty ?? 0) !== 0` против :279 `const diff = hasFact ? Number(row.counted) - expected : null` (живой rows-state).

**Рекомендуемый фикс:** Для фильтра «Расхождения» в черновике учитывать живой ввод (rows), как в колонке «Разница»; нормализовать запятую на клиенте тем же правилом, что toNumber.

### 74. Охват «По категории»: литеральный % в реальных названиях категорий работает как wildcard в LIKE, плюс префиксное перекрытие соседних категорий

**Где:** `src/lib/db/queries/stock-inventory.ts:66` · **Направление:** Инвентаризация

Запрос охвата категории: `category_path = ? OR category_path LIKE ?` с шаблоном `${category}%` без ESCAPE. Реальные категории в проде содержат литеральный %: «Декор 7.5%», «Базовый цветок 65%», «3.Сопутствующие товары 5%». В LIKE-шаблоне этот % становится метасимволом: «Зелень 7.5%%» матчит «Зелень 7.5<что угодно>», а не только точную категорию и её подкатегории. Кроме того, чистый префикс без разделителя захватывает соседние категории с общим началом (категория «Горшечные цветы» поймала бы «Горшечные цветы новые»). Сейчас фактических коллизий в данных нет, но при появлении похожих названий охват инвентаризации станет шире заявленного.

**Доказательство:** stock-inventory.ts:64-69: `WHERE COALESCE(is_active, 1) = 1 AND (category_path = ? OR category_path LIKE ?)` + `.all(category, `${category}%`)`. Данные: `SELECT DISTINCT category_path FROM products WHERE COALESCE(is_active,1)=1` → «Декор 7.5%», «Базовый цветок 65%», «3.Сопутствующие товары 5%/Ваза» — % в названиях литеральный.

**Рекомендуемый фикс:** Экранировать спецсимволы: `LIKE ? ESCAPE '\\'` с заменой %/_ в category, и матчить подкатегории как `category || '/%'` вместо голого префикса.

### 75. Товары, созданные после снапшота, молча отсутствуют в инвентаризации «весь склад»; из-за K1 одна и та же позиция меняла имя между попытками подсчёта

**Где:** `src/lib/db/queries/stock-inventory.ts:71` · **Направление:** Инвентаризация

Снапшот строится один раз при создании; товары, добавленные позже, в акт не попадают, и ни recalcInventoryExpected (обновляет только существующие строки по product_code), ни проведение об этом не предупреждают — подсчёт «весь склад» по факту неполный. Новая деталь механики K1, наложившаяся на это: клиент «добавлял» товары под занятым кодом 00177165698580, upsert их перезаписывал, и в снапшотах последовательных инвентаризаций один и тот же код фигурирует под РАЗНЫМИ именами — в доках 7/8 (08.06 23:49/23:57) это «Хризантема Китай кустовая», в доках 11/12 (09.06 10:53/11:04) — «Гортензия местная». Для клиента это выглядело ровно как «позиции то пропадали, то появлялись»: «добавленный» товар не появлялся отдельной строкой, а существующая строка меняла название между попытками. Смежно: getProduct в postInventoryInTransaction не фильтрует is_active — строка по заархивированному между снапшотом и проведением товару всё равно применится (вероятно, приемлемо, но стоит зафиксировать осознанно).

**Доказательство:** SQL: `SELECT document_id, product_name FROM stock_document_items WHERE product_code='00177165698580' AND document_id IN (7,8,11,12)` → 7|Хризантема Китай кустовая, 8|Хризантема Китай кустовая, 11|Гортензия местная, 12|Гортензия местная; movements 617-626: четыре stock_update этого кода с чередованием имён «Аллиум (агапантус)»/«Хризантема Китай кустовая» 09.06 07:52–09:13. Код: createInventoryDraftWithSnapshot (:70-74) — выборка только на момент создания; recalcInventoryExpected (:185-191) обновляет лишь существующие строки.

**Рекомендуемый фикс:** При recalc и/или перед проведением показывать список активных товаров охвата, отсутствующих в акте, с кнопкой «добавить строки»; первопричину дублирующихся имён лечит фикс K1 (запрет молчаливого upsert по занятому коду).

### 76. Заказ из сделки: цена доставки не обнуляется при смене на самовывоз (рассинхрон с updateOrder)

**Где:** `src/lib/db/domain/deal-orders.ts:321` · **Направление:** Леджер и резервы

В updateOrderFromDeal (строка 316-321) и createOrderFromDeal (строки 109-115) orderTotal = totals.total + deliveryPrice безусловно — для pickup обнуляется только address, но не deliveryPrice. Для сравнения, updateOrder (прямой заказ) делает effectiveDeliveryPrice = deliveryType === 'delivery' ? deliveryPrice : 0 (строка 548), а кассовый диалог обнуляет на клиенте (cash-page.tsx:1056). В карточке сделки поле «Платит клиент за доставку» скрывается при выборе самовывоза (deal-detail-page.tsx:1712: {orderDraft.deliveryType === "delivery" && ...}), но значение остаётся в state и ВСЕГДА отправляется (строка 880: formData.set("deliveryPrice", String(normalizedPrice(orderDraft.deliveryPrice)))). Итог: менеджер меняет доставку на самовывоз — невидимые 500 сом доставки остаются в total заказа и сделки, клиент должен больше, заказ нельзя выдать без «доплаты» за несуществующую доставку.

**Доказательство:** deal-orders.ts:321: const orderTotal = totals.total + deliveryPrice (deliveryType не учитывается); deal-detail-page.tsx:880: formData.set("deliveryPrice", ...) — отправляется всегда, хотя инпут скрыт при pickup; ср. updateOrder deal-orders.ts:548: const effectiveDeliveryPrice = deliveryType === "delivery" ? deliveryPrice : 0.

**Рекомендуемый фикс:** В createOrderFromDeal/updateOrderFromDeal применять ту же нормализацию effectiveDeliveryPrice (и courierPayout) по deliveryType, что и в updateOrder; в UI сбрасывать deliveryPrice/courierPayout при переключении на самовывоз.

### 77. Закрытие сделки (этап is_closed) не трогает связанный активный заказ — резерв остаётся висеть

**Где:** `src/lib/crm.ts:562` · **Направление:** Леджер и резервы

updateDealStage при переводе сделки на закрывающий этап ставит deals.status='cancelled', но связанный заказ ('Новый'/'В работе', is_reserved=1) не отменяется и резерв склада не снимается — нигде в crm.ts/actions.ts нет вызова cancelOrder при закрытии сделки. Сделка в CRM выглядит отменённой, а заказ продолжает держать резерв (товар недоступен для продажи/других заказов), пока кто-то вручную не отменит его на «Столе заказов». Обратная связь (cancelOrder → сделка) тоже отсутствует, см. находку про acceptDealPayment. Возможно, это осознанный workflow, но защиты/подсказки нет ни на сервере, ни в данных — рассинхрон «сделка отменена / заказ активен» ничем не детектится.

**Доказательство:** crm.ts:560-563: const status = stage.isWon ? "won" : stage.isClosed ? "cancelled" : "open"; client.prepare("UPDATE deals SET stage_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(...) — заказы не затрагиваются; grep по crm.ts: импортов cancelOrder/order-lifecycle нет.

**Рекомендуемый фикс:** При переводе сделки на is_closed-этап проверять наличие активного заказа и либо блокировать перевод («Сначала отмените заказ»), либо предлагать каскадную отмену через cancelOrder.

### 78. deleteDraftOrder удаляет заказ физически без записи в журнал movements

**Где:** `src/lib/db/domain/order-lifecycle.ts:599` · **Направление:** Леджер и резервы

deleteDraftOrder делает DELETE FROM order_items / DELETE FROM orders и не пишет ничего ни в movements, ни в stock_movements (currentUser демонстративно проигнорирован: void currentUser). Создание черновика тоже не журналируется (по дизайну), поэтому после удаления от черновика не остаётся вообще никаких следов, кроме дыры в нумерации orders.id. В проде уже есть пример: id 55 отсутствует (54 → 56). Для прод-системы с деньгами и несколькими операторами это слепая зона аудита: нельзя выяснить, кто и когда удалил черновик (например, черновик с введённой и потерянной предоплатой из находки про драфты).

**Доказательство:** order-lifecycle.ts:599-616: export function deleteDraftOrder(orderId: number, currentUser: CurrentUser) { void currentUser ... client.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId); client.prepare("DELETE FROM orders WHERE id = ?").run(orderId) } — без addMovement; SQL: в orders id 54 и 56 существуют, 55 отсутствует.

**Рекомендуемый фикс:** Добавить addMovement(type: 'order_delete', note: `Удалён черновик ${number}: ${customer}`) с userId перед удалением.

### 79. НЕ баг (ответ на вопросы (в)/(г) задания): записи 'Резерв при создании заказа' с before_stock==after_stock — норма; сверка reserved сошлась

**Где:** `src/lib/db/ledger.ts:176` · **Направление:** Леджер и резервы

Проверка подозрительных stock_movements id 1146-1155: это штатная запись. applyProductDelta для type='reserve' получает только reservedDelta (stockDelta не передаётся), поэтому afterStock = beforeStock + 0 — двигается только пара before_reserved → after_reserved (в данных она корректно растёт: 3→4, 4→5, 0→2 и т.д.). Резерв поверх отрицательного остатка (например 00177165699006 при stock=-9) объясняется включённой настройкой allow_oversell (=1 в app_settings) — enforceAvailable отключён. Сверка прода: products.reserved == SUM(order_items.qty) по заказам с is_reserved=1 и статусами не из (Выдан, Отменен, Черновик, Готов, Передан курьеру) — расхождений 0 строк; reserved<0 нет; следов срабатывания клампа Math.max(0,...) (строка 179) в журнале нет (0 строк, где after_reserved != before_reserved + qty для reserve/reserve_cancel/order_fulfill); чистый нетто-резерв по всем терминальным заказам = 0. Повторное списание при «Букет готов» исключено: markOrderReady ранний return для 'Готов'/'Передан курьеру'/'Выдан', обратных переходов из 'Готов' в коде нет. Повторный finalize черновика блокируется проверкой статуса 'Черновик' + is_reserved (order-lifecycle.ts:475-480).

**Доказательство:** ledger.ts:176: const afterStock = beforeStock + (input.stockDelta ?? 0) — при резерве stockDelta отсутствует; stock_movements 1148: 00177165698647|reserve|1.0|58.0|58.0|1.0|2.0|50 (stock не изменился, reserved 1→2); SQL-сверка reserved vs активные заказы — пустой результат; SELECT value FROM app_settings (allow_oversell) = 1.

**Рекомендуемый фикс:** Действий не требуется; полезно добавить периодическую сверку reserved против активных заказов как health-check.

### 80. Гонка формы товара: сохранение затирает cost_price/sale_price устаревшим снапшотом (stock защищён, цены — нет)

**Где:** `src/lib/db/queries/products.ts:75` · **Направление:** Карточки товаров (CRUD)

Проверка пункта (г) задачи: для stock/reserved/expected гонки НЕТ — при существующем товаре значения берутся из БД, форма игнорируется (products.ts:35-37, это корректно). Но cost_price/sale_price/category_path/unit берутся из формы безусловно: defaultValue в форме (stock-page.tsx:870, 881) — снапшот на момент открытия. Сценарий: владелец открыл «Редактировать товар», в это время проведён акт пополнения, который при включённом recompute_cost_on_receipt пересчитал бы средневзвешенную себестоимость (stock-documents.ts:430-438), затем владелец нажал «Сохранить» — пересчитанная себестоимость откатывается к снапшоту. Сейчас в проде recompute_cost_on_receipt=0, поэтому фактический риск ограничен ручными правками цен с двух устройств, но при включении флага (фазы склада уже задеплоены) гонка станет регулярной: каждое редактирование карточки во время приёмки будет портить себестоимость.

**Доказательство:** products.ts:75-76: `cost_price = excluded.cost_price, sale_price = excluded.sale_price` — безусловно из формы; ср. защиту строк 35-37: `const stock = before ? numberFromRow(before.stock) : toNumber(formData.get("stock"))`. SQL: app_settings → recompute_cost_on_receipt|0. stock-documents.ts:430: `if (recomputeCost && type === "stock_in" ...) newCost = roundMoney((basis * oldCost + qty * landedUnitCost) / (basis + qty))`.

**Рекомендуемый фикс:** По аналогии со stock: передавать в форме снапшот costPrice/salePrice и при сохранении сравнивать с текущим значением БД (optimistic lock) либо обновлять цены только если пользователь их менял.

### 81. Предупреждение кассиру «Не хватает остатков» сравнивает корзину с products.stock, игнорируя reserved — продажа молча съедает цветы, зарезервированные под заказы

**Где:** `src/components/cash/cash-page.tsx:452` · **Направление:** Продажи/возвраты и остатки

Новая деталь к K3: единственное предупреждение при продаже в минус — клиентский Alert (cash-page.tsx:776-786), сервер не проверяет ничего (ledger.ts:166-174: enforceAvailable срабатывает только при reservedDelta>0, т.е. для заказов; createSale его не передаёт). При этом сам Alert считает нехватку как requiredQty > product.stock, не учитывая product.reserved. Если на складе 10 роз и 10 зарезервированы под заказ, касса продаст их без единого предупреждения (10 <= 10), после чего сборка заказа (order_fulfill) уведёт stock в минус. Available (stock − reserved) — единственно корректная база для предупреждения. В проде 49 товаров уже с отрицательным stock.

**Доказательство:** cash-page.tsx:443-457: `const cartShortageCount = ... if (product && requiredQty > product.stock) { count += 1 }` — поле reserved не используется; ledger.ts:166: `// Запрет перепродажи при резервировании (заказы/сделки). Касса остаётся без проверки.`; SQL: SELECT COUNT(*) FROM products WHERE stock < 0 → 49.

**Рекомендуемый фикс:** В cartShortageCount сравнивать с (product.stock − product.reserved); опционально — отдельная формулировка «съест резерв заказов» при requiredQty > stock − reserved, но <= stock.

### 82. Продажу с total = 0 (100% скидка) невозможно сторнировать — товар не вернуть на склад через UI

**Где:** `src/lib/db/queries/sales.ts:163` · **Направление:** Продажи/возвраты и остатки

createSale создаёт денежную проводку только при total > 0 (sales.ts:163-174), но сток списывает всегда (sales.ts:142-151). Единственный путь отмены продажи — reverseCashTransaction, который работает ОТ проводки cash_transactions type='sale' (cash.ts:406-409): для бесплатной продажи проводки нет, кнопки сторно нет, reversed_at не выставить и сток не вернуть иначе как ручной корректировкой склада. Сейчас в БД таких продаж 0 (SELECT COUNT(*) FROM sales WHERE total <= 0 → 0), т.е. баг пока не выстрелил, но скидка 100% на чек допустима валидацией (discountValue >= 0 без верхней границы по позиции/чеку).

**Доказательство:** sales.ts:163: `if (total > 0) { recordCashTransaction(...) }` — при total=0 проводки нет; cash.ts:406-409: сторно ищется по `original.type === "sale"` из cash_transactions, затем `const saleId = numberFromRow(original.saleId)`; других путей выставить sales.reversed_at и вернуть sale_items на склад в коде нет (grep reversed_at по src/lib).

**Рекомендуемый фикс:** Писать проводку 'sale' и при total = 0 (recordCashTransaction сейчас запрещает amount <= 0 — ослабить до >= 0 для типа 'sale') либо добавить сторно по sale.id, не зависящее от cash_transactions.

### 83. Сторно продажи возвращает сток, но не восстанавливает списанные партии (stock_lots) — лента партий течёт в одну сторону

**Где:** `src/lib/db/queries/stock-lots.ts:176` · **Направление:** Продажи/возвраты и остатки

Ответ на вопрос (в): продажа партии НЕ списывает вообще — дизайн «сверка от истины»: reconcileProductLots срабатывает лениво при просмотре партий/виджета свежести и FEFO-списывает разницу (sum(lots) − products.stock). Это одностороннее: reconcile только уменьшает qty_remaining и никогда не восстанавливает. Сценарий: продажа товара с track_lots → кто-то открыл /stock (reconcile списал партию) → сторно продажи вернуло stock (+qty, type 'adjustment') → партия остаётся depleted навсегда, физически вернувшиеся на витрину цветы выпадают из контроля свежести/виджета сроков. Сейчас риск нулевой: track_lots_enabled = 0 в app_settings и активных партий нет, но при включении флага сторно начнёт тихо «терять» партии.

**Доказательство:** stock-lots.ts:191-193: `let toConsume = roundMoney(sum - target); if (toConsume <= 0) { return }` — ветка восстановления отсутствует (комментарий строк 173-175: «Если партий меньше остатка — оставляем как есть»); cash.ts:426-437 — сторно делает applyProductDelta(stockDelta: +qty) без какого-либо обращения к stock_lots; SQL: SELECT value FROM app_settings WHERE key='track_lots_enabled' → 0.

**Рекомендуемый фикс:** При сторно продажи возвращать количество в последнюю затронутую партию (через stock_lot_movements type 'reconcile' с положительным qty) либо явно задокументировать и показывать «остаток без партии» в карточке товара.

### 84. cancelStockDocument позволяет перевести акт со статусом 'corrected' в 'cancelled'

**Где:** `src/lib/db/queries/stock-documents.ts:801` · **Направление:** Акты склада (приход/списание/корректировка)

Проверки в cancelStockDocument: posted → ошибка, cancelled → no-op, всё остальное (включая 'corrected') → UPDATE в 'cancelled'. Скорректированный акт — это проведённый и откатанный корректировкой документ с заполненным corrected_by_document_id; его перевод в «Отменен» ломает аудит-цепочку: акт пропадает из фильтра «Скорректированные», статусы перестают соответствовать связке corrects/corrected_by, а в истории выглядит как никогда не действовавший. UI кнопку для corrected не показывает (StockDocumentActions рендерится только для draft), но server action cancelStockDocumentAction (src/app/actions.ts:835) принимает любой documentId от любого owner-запроса — защита должна быть на сервере, как и для posted.

**Доказательство:** stock-documents.ts:801-810: `if (document.status === "posted") { throw ... } if (document.status === "cancelled") { return } client.prepare("UPDATE stock_documents SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?").run(documentId)` — ветки для 'corrected' нет. В прод-БД есть документ id=5 (IN-000004, status='corrected', corrected_by_document_id=6), который этим путём можно перевести в 'cancelled'.

**Рекомендуемый фикс:** Отменять только черновики: `if (document.status !== "draft") throw new Error(...)` (с сохранением идемпотентности для cancelled).

### 85. Можно создать несколько черновиков корректировки одного прихода — лишние становятся «вечными» черновиками

**Где:** `src/lib/db/queries/stock-documents.ts:680` · **Направление:** Акты склада (приход/списание/корректировка)

createStockCorrectionDraft блокирует создание только если original.corrected_by_document_id != null, а это поле заполняется лишь при ПРОВЕДЕНИИ корректировки. Пока корректировка в черновике, кнопка «Создать корректировку» на карточке исходного акта остаётся доступной (условие в page.tsx — status==='posted' && correctedByDocumentId == null) и плодит дубликаты. После проведения одной из них остальные навсегда зависают черновиками: их проведение падает с «Исходный акт уже не проведён», пользователю остаётся только отменять вручную; каждый дубликат к тому же расходует номер IN-xxxxxx. Это уже происходило на проде.

**Доказательство:** Прод-БД: документы id=2 (IN-000002) и id=3 (IN-000003) оба имеют corrects_document_id=1 — два черновика корректировки одного акта IN-000001 (оба потом отменены вручную). Код: createStockCorrectionDraft проверяет только `if (original.corrected_by_document_id != null) throw` (строки 680-682), наличие существующего draft-черновика с тем же corrects_document_id не проверяется.

**Рекомендуемый фикс:** Перед созданием проверять существование draft-корректировки: SELECT id FROM stock_documents WHERE corrects_document_id = ? AND status = 'draft' — если есть, возвращать её id (или ошибку со ссылкой).

### 86. Новая механика K2: формы актов склада питаются списком товаров с LIMIT 234 — товары за лимитом нельзя добавить в приход/списание

**Где:** `src/app/stock/acts/[id]/edit/page.tsx:30` · **Направление:** Акты склада (приход/списание/корректировка)

Не дубль K2, а её новое следствие за пределами UI склада: страница редактирования черновика акта берёт товары из getDashboardData() (products c LIMIT 234, dashboard.ts:38), и тот же ограниченный список идёт в пикер новой формы акта на /stock. При росте каталога свыше лимита товар молча перестанет находиться в поиске формы акта — приход на него оформить нельзя. Дополнительно: если строка существующего черновика ссылается на товар, отсутствующий в переданном списке (за лимитом или в архиве — getDashboardData отдаёт только is_active=1), StockDocumentForm подставляет товар-заглушку со stock = beforeStock ?? 0 (stock-document-form.tsx:76-94), а для непроведённого черновика beforeStock = NULL → колонки «Остаток»/«После» показывают расчёт от нуля, т.е. неверные числа, хотя проведение на сервере посчитает корректно.

**Доказательство:** edit/page.tsx:30: `const data = getDashboardData()` → :49 `<StockDocumentForm ... products={data.products} ...>`; dashboard.ts:38: `LIMIT 234`. stock-document-form.tsx:83-84: заглушка `stock: item.beforeStock ?? 0, ... available: item.beforeStock ?? 0` — для черновика beforeStock ещё NULL.

**Рекомендуемый фикс:** Для форм актов отдавать полный список активных товаров отдельной выборкой без LIMIT (или серверный поиск в пикере); в заглушке строки помечать «товар вне списка» вместо показа нулевого остатка.

### 87. writeOffLot не умеет списывать дробные остатки партий: партия с остатком <1 становится несписываемой, а дробный ввод молча усекается

**Где:** `src/lib/db/queries/stock-lots.ts:266` · **Направление:** Партии и сроки годности

writeOffLot делает `const qty = Math.floor(input.qty)` и требует qty≥1 целое. Партии создаются целыми (приход валидируется parsePositiveInteger), но дробный остаток у партии достижим штатно: reconcileProductLots подгоняет qty_remaining к products.stock (stock-lots.ts:202-210, take может быть дробным), а дробные стоки в проде существуют (продажи/правки товара допускают дробь). Партия с остатком, скажем, 0.5: списать нельзя (минимальное qty=1 > 0.5 → «Нельзя списать больше остатка партии (0.5)»), reconcile её не выработает, пока stock не упадёт — просроченная партия с хвостом <1 зависает в «Контроле свежести» без способа закрыть её с причиной. Второй эффект: ввод 2.9 молча floor'ится до 2 — списывается меньше запрошенного без сообщения (диалог UI шлёт строку qty как есть, stock-lots-client.tsx:112).

**Доказательство:** stock-lots.ts:266-271: `const qty = Math.floor(input.qty); if (!Number.isFinite(qty) || qty <= 0) throw …; if (qty > remaining) throw new Error(`Нельзя списать больше остатка партии (${remaining})`)`. Дробный сток в проде: sqlite3 -readonly app.db "SELECT code,name,stock FROM products WHERE stock != CAST(stock AS INTEGER)" → 00177165698843|ягода декор|9.5.

**Рекомендуемый фикс:** Убрать Math.floor: валидировать qty как положительное число с допуском дробей (или автоматически списывать весь остаток, если remaining < 1), и отклонять ввод, не равный floor'у, вместо молчаливого усечения.

### 88. Списание партии игнорирует резерв: остаток товара может уйти ниже reserved без предупреждения

**Где:** `src/lib/db/queries/stock-lots.ts:291` · **Направление:** Партии и сроки годности

writeOffLot уменьшает products.stock через applyProductDelta без enforceAvailable и без сравнения с products.reserved. reconcileProductLots тоже сверяет только к stock (target = max(0, stock), строка 181), не к stock-reserved. Владелец может списать как испорченные те единицы, что уже зарезервированы под заказы/сделки: после списания stock < reserved, доступный остаток отрицательный, последующее выполнение заказа уведёт stock в минус (усиливает известную K3). Для сравнения: архивирование товара резерв блокирует (products.ts:238-242), а реальное списание — нет, и даже предупреждения нет.

**Доказательство:** stock-lots.ts:290-298: `applyProductDelta(client, { productCode, stockDelta: -qty, type: "adjustment", … })` — без enforceAvailable и без проверки reserved; ledger.ts:167 проверка available выполняется только при `input.enforceAvailable && reservedDelta > 0`.

**Рекомендуемый фикс:** Физическую потерю запрещать нельзя, но стоит проверять qty > stock - reserved и возвращать предупреждение/требовать подтверждение («списание затронет зарезервированные N шт — проверьте заказы»), плюс writeOffLot мог бы дописывать в комментарий движения факт ухода ниже резерва.

### 89. Новая деталь K1: молчаливая перезапись товара по занятому коду дополнительно сбрасывает партионные настройки (track_lots, vase_life_days)

**Где:** `src/lib/db/queries/products.ts:77` · **Направление:** Партии и сроки годности

Дополнение к известной K1 (не дубль): форма «Новый товар» и «Редактировать» — один диалог в stock-page.tsx, который ВСЕГДА содержит маркер lotSettingsPresent=on (stock-page.tsx:912) и чекбокс trackLots с defaultChecked=Boolean(product?.trackLots) — для «нового» товара чекбокс выключен и vaseLifeDays пуст. При сабмите «нового» товара под занятым кодом ON CONFLICT-апдейт перезапишет не только имя/цены (известная механика K1), но и `track_lots = excluded.track_lots` (=0) и `vase_life_days = excluded.vase_life_days` (=NULL). После включения партионного учёта инцидент типа «Гортензия 00177165698580» будет дополнительно молча отключать учёт по партиям у перезаписанного товара: новые приходы перестанут создавать партии, товар выпадет из контроля свежести без какого-либо следа в UI.

**Доказательство:** products.ts:42-49: `const hasLotSettings = formData.get("lotSettingsPresent") === "on"; const trackLots = hasLotSettings ? formData.get("trackLots") === "on" ? 1 : 0 : …`; products.ts:77-78: `track_lots = excluded.track_lots, vase_life_days = excluded.vase_life_days`; stock-page.tsx:912: `<input type="hidden" name="lotSettingsPresent" value="on" />` — присутствует и в режиме создания (product может быть null, строка 919 defaultChecked={Boolean(product?.trackLots)}).

**Рекомендуемый фикс:** В рамках фикса K1 (запрет молчаливого ON CONFLICT для формы создания) проблема уйдёт сама; до тех пор — не отправлять lotSettingsPresent в режиме создания товара, чтобы upsert сохранял существующие track_lots/vase_life_days.

### 90. Новые детали K2: LIMIT 234 срезает товары предсказуемо — кириллица с конца алфавита и здоровым остатком первой, и срез общий для склада, кассы и актов

**Где:** `src/lib/db/queries/dashboard.ts:36` · **Направление:** Видимость и поиск товаров

Дополнение к известной K2 (LIMIT 234). Кто именно пропадёт при росте каталога — не случайные товары: ORDER BY CASE ставит минусовые/малоостаточные в начало, поэтому под срез попадают товары с НОРМАЛЬНЫМ остатком; внутри них сортировка name COLLATE NOCASE, а NOCASE в SQLite сворачивает регистр только для ASCII — кириллица сравнивается побайтно и вся идёт ПОСЛЕ латиницы и цифр, причём строчные кириллические («юкка», «композа», «роза Китай» — таких в каталоге уже много) — после прописных. То есть первыми исчезнут ходовые товары с именами на Х/Ц/Ч/Ш/Э/Ю/Я и все «строчные» — например «Хризантема...». Второй новый момент: этот же обрезанный массив — единственный источник для поиска на кассе (cash-page.tsx:199 products={data.products}), для подбора в акты пополнения/списания (stock-page.tsx:374 StockDocumentDialog products={products}) и для счётчика «Активные (N)» (stock-page.tsx:316 activeCount={products.length}, застрянет на 234). Товар за лимитом одновременно нельзя найти на складе, продать на кассе и оприходовать актом — при этом в /deals он будет виден (listProducts() в crm.ts:126-139 без LIMIT), что породит новые «у вас в сделках есть, а на складе нет». Сейчас 230 активных из 234 — до срабатывания осталось 4 товара.

**Доказательство:** dashboard.ts:33-38: `ORDER BY CASE WHEN stock - reserved < 0 THEN 0 WHEN stock - reserved <= 3 THEN 1 ELSE 2 END, name COLLATE NOCASE LIMIT 234`. SQL: COUNT активных = 230. Контраст: crm.ts listProducts — `ORDER BY name COLLATE NOCASE` без LIMIT (используется /deals/[id] и /stock/inventory).

**Рекомендуемый фикс:** Убрать LIMIT (230-1000 строк better-sqlite3 отдаёт мгновенно) или перевести подбор товара на серверный поиск; счётчик «Активные» брать отдельным COUNT.

### 91. Статус 'failed' недостижим: UPDATE откатывается собственным throw внутри той же транзакции

**Где:** `src/lib/db/queries/warehouse.ts:170` · **Направление:** Импорт/экспорт XLSX

В applyWarehouseImport при наличии error-строк выполняется `UPDATE warehouse_imports SET status='failed'` и сразу `throw` — но обе операции находятся внутри `client.transaction(...)`, а better-sqlite3 при исключении делает ROLLBACK всей транзакции, включая этот UPDATE. В итоге статус навсегда остаётся 'preview', а ветки UI под 'failed' (бейдж «Ошибка» в imports/page.tsx:109-110, mappers.ts:86) — мёртвый код: ни один другой участок кода 'failed' не пишет (проверено grep'ом). Функционально пользователь всё равно не может применить такой импорт (исключение пробрасывается), но история импортов вводит в заблуждение, показывая «Предпросмотр» для заведомо неприменимого файла.

**Доказательство:** warehouse.ts:170-175 внутри `const applyImport = client.transaction(() => { ... })`: `client.prepare("UPDATE warehouse_imports SET status = 'failed' WHERE id = ?").run(importId); throw new Error("Исправьте ошибки в XLSX и загрузите файл снова.")` — throw откатывает только что выполненный UPDATE. grep по репо: единственный писатель 'failed' — эта строка.

**Рекомендуемый фикс:** Проверять error-строки и помечать 'failed' ДО входа в транзакцию (или сразу при создании превью ставить статус 'failed', если error_count > 0).

### 92. Apply «update»-строки после удаления товара воскрешает его с дельтой вместо абсолютного остатка (возможен отрицательный stock)

**Где:** `src/lib/db/queries/warehouse.ts:209` · **Направление:** Импорт/экспорт XLSX

Превью живёт неограниченно долго (статус 'preview', применить можно когда угодно), а товары можно удалять навсегда (deleteProductAction в stock-page.tsx). Если между превью и apply товар из «update»-строки удалили, getProduct вернёт undefined → выполняется INSERT-ветка с appliedStock = 0 + stockDelta = newStock − oldStockНаМоментПревью. Пример: на превью old=100, new=90 (delta −10) → товар пересоздаётся со stock = −10 вместо 90; цены при costPriceProvided=false станут 0 вместо прежних. Удалённый товар молча воскресает с бессмысленным остатком. Смежно: и для живых товаров импорт принимает отрицательный целевой stock без ошибки/предупреждения (normalizeWarehouseImportRow проверяет только «не число») — рядом с известной проблемой K3 это ещё один легальный путь загнать остаток в минус.

**Доказательство:** warehouse.ts:183,188-189: `const currentStock = existing ? numberFromRow(existing.stock) : 0; ... const appliedStock = currentStock + intendedStockDelta`, затем INSERT-ветка (209-226) вставляет `appliedStock`, который для бывшей update-строки равен дельте, а не целевому значению из файла; валидации stock >= 0 нет (строки 345-349).

**Рекомендуемый фикс:** В apply: если existing отсутствует, а item.action === 'update' (oldStock !== null) — падать с понятной ошибкой «товар удалён, обновите превью» вместо INSERT; плюс валидация stock >= 0 на превью (или явное предупреждение).


## Опровергнутые находки (для прозрачности)

- **Флорист может править заказ из сделки (и deal_items/итоги сделки) в обход ролевой границы** — Механика описана верно: actions.ts:733 ограничивает updateOrderFromDealAction ролями owner/manager, actions.ts:746 даёт updateOrderAction и флористу, а deal-orders.ts:505-510 делегирует deal-связанный заказ в updateOrderFromDeal без проверки роли, что переписывает deal_items (deal-orders.ts:382,405) и итоги сделки (deal-orders.ts:454-469); UI это реально экспонирует флористу (orders-page.tsx:457-468, /orders доступен флористу). ОДНАКО это не «обход ролевой границы», а задокументированное осознанное решение: комментарий прямо над updateOrder (deal-orders.ts:477-481) явно говорит «Редактирование

- **updateDealItem считает сумму строки без правила букета (qty=1 при price>0) — латентно, маскируется пересчётом** — Цитаты кода в находке точны: crm.ts:685 действительно считает сумму строки через calculateLineTotal без учёта bouquet_group_id, а crm.ts:792-811 (recalculateDealTotals, вызывается на :708 в той же транзакции) переписывает суммы ВСЕХ строк через calculateComponentLineTotal (crm.ts:762: qty=1 при bouquetGroupId && price>0). Но как баг находка не подтверждается: (1) Единственный заявленный сценарий закрепления кривой суммы — ранний выход recalculateDealTotals при привязанном заказе (crm.ts:784-791) — недостижим в связке с updateDealItem: на crm.ts:689 ПЕРЕД UPDATE вызывается assertDealItemsEditab
