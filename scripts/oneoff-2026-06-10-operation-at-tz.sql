-- Одноразовая правка данных к TZ-фиксу fromDatetimeLocalValue (10.06.2026).
-- Введённые руками даты операций актов записаны бишкекским временем как UTC (+6ч);
-- документ 6 редактировали повторно — сдвиг накопился дважды (+12ч).
-- Документы инвентаризации 7, 8, 11, 12 корректны (серверное UTC) — не трогаем.
-- Выверено построчно по created_at, проверено на копии БД. Применять ОДИН раз.
UPDATE stock_documents
   SET operation_at = strftime('%Y-%m-%dT%H:%M:%S', datetime(operation_at, '-6 hours')) || '.000Z'
 WHERE id IN (1,2,3,4,5,9,10);
UPDATE stock_documents
   SET operation_at = strftime('%Y-%m-%dT%H:%M:%S', datetime(operation_at, '-12 hours')) || '.000Z'
 WHERE id = 6;
