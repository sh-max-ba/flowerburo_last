# План реализации модуля "База знаний"

## Цель

Добавить в CRM раздел `/knowledge` для внутренней базы знаний: список статей, категории, поиск, просмотр, создание и редактирование статей со статусами `draft`, `published`, `archived`.

План не затрагивает Wazzup, сделки, задачи, шахматку и существующие бизнес-таблицы. Внедрение должно быть изолированным: новые таблицы, новые функции чтения/записи, новые страницы и минимальное подключение к App Shell.

## Текущий контекст проекта

- В `AGENTS.md` есть требование читать актуальные Next.js docs из `node_modules/next/dist/docs/` перед кодом. Проект на Next `16.2.6`, App Router, страницы лежат в `src/app`.
- В репозитории не найден `prisma/schema.prisma`. Текущий слой данных реализован через `better-sqlite3` в `src/lib/db.ts`, база `app.db`, миграция выполняется в функции `migrate()`.
- Текущие роли в коде: `owner`, `manager`, `florist` (`UserRole` в `src/lib/db.ts`). Ролей `OWNER`, `ADMIN`, `SALES_LEAD`, `SALES_MANAGER`, `VIEWER` сейчас нет.
- Текущий App Shell: новый `CrmShell` в `src/components/crm-shell.tsx` для маршрутов `/deals`, `/clients`, `/stock/acts` и др.; также есть legacy `BackofficeRoute`/`Backoffice` для части страниц. Для нового модуля лучше идти через `CrmShell`.
- UI основан на локальных shadcn-компонентах (`components.json`, base-nova, RSC, lucide).

## Архитектурное решение

Если проект будет переведен на Prisma, добавить модели ниже в `schema.prisma`. Если проект остается на текущем `better-sqlite3`, использовать ту же структуру таблиц в SQL-миграции, но не смешивать реализацию с существующими таблицами.

Для MVP достаточно `KnowledgeCategory` и `KnowledgeArticle`. `KnowledgeArticleRevision` лучше заложить сразу в схему как отдельную таблицу, но включать UI истории отдельным этапом. `KnowledgeAttachment` лучше не включать в MVP UI, но спланировать таблицу заранее или добавить позже отдельной миграцией.

## Prisma Models

```prisma
enum KnowledgeArticleStatus {
  draft
  published
  archived
}

model KnowledgeCategory {
  id          Int                @id @default(autoincrement())
  name        String
  slug        String             @unique
  description String?
  sortOrder   Int                @default(0)
  isActive    Boolean            @default(true)
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  articles    KnowledgeArticle[]

  @@index([isActive, sortOrder])
  @@index([name])
}

model KnowledgeArticle {
  id          Int                    @id @default(autoincrement())
  title       String
  slug        String                 @unique
  content     String
  status      KnowledgeArticleStatus @default(draft)
  categoryId  Int?
  authorId    Int
  updatedById Int?
  publishedAt DateTime?
  archivedAt  DateTime?
  createdAt   DateTime               @default(now())
  updatedAt   DateTime               @updatedAt

  category    KnowledgeCategory?      @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  author      User                    @relation("KnowledgeArticleAuthor", fields: [authorId], references: [id], onDelete: Restrict)
  updatedBy   User?                   @relation("KnowledgeArticleUpdatedBy", fields: [updatedById], references: [id], onDelete: SetNull)
  revisions   KnowledgeArticleRevision[]
  attachments KnowledgeAttachment[]

  @@index([status, updatedAt])
  @@index([categoryId, status, updatedAt])
  @@index([authorId])
  @@index([updatedById])
  @@index([title])
}

model KnowledgeArticleRevision {
  id          Int                    @id @default(autoincrement())
  articleId   Int
  title       String
  slug        String
  content     String
  status      KnowledgeArticleStatus
  categoryId  Int?
  authorId    Int
  updatedById Int?
  createdAt   DateTime               @default(now())

  article     KnowledgeArticle        @relation(fields: [articleId], references: [id], onDelete: Cascade)
  author      User                    @relation("KnowledgeRevisionAuthor", fields: [authorId], references: [id], onDelete: Restrict)
  updatedBy   User?                   @relation("KnowledgeRevisionUpdatedBy", fields: [updatedById], references: [id], onDelete: SetNull)

  @@index([articleId, createdAt])
  @@index([updatedById])
}

model KnowledgeAttachment {
  id          Int              @id @default(autoincrement())
  articleId   Int
  filename    String
  mimeType    String
  sizeBytes   Int
  storagePath String
  uploadedById Int?
  createdAt   DateTime         @default(now())

  article      KnowledgeArticle @relation(fields: [articleId], references: [id], onDelete: Cascade)
  uploadedBy   User?            @relation("KnowledgeAttachmentUploadedBy", fields: [uploadedById], references: [id], onDelete: SetNull)

  @@index([articleId, createdAt])
  @@index([uploadedById])
}
```

## Relations с User

В `User` при Prisma-подходе нужно добавить обратные связи:

```prisma
knowledgeArticlesAuthored KnowledgeArticle[] @relation("KnowledgeArticleAuthor")
knowledgeArticlesUpdated  KnowledgeArticle[] @relation("KnowledgeArticleUpdatedBy")
knowledgeRevisionsAuthored KnowledgeArticleRevision[] @relation("KnowledgeRevisionAuthor")
knowledgeRevisionsUpdated  KnowledgeArticleRevision[] @relation("KnowledgeRevisionUpdatedBy")
knowledgeAttachmentsUploaded KnowledgeAttachment[] @relation("KnowledgeAttachmentUploadedBy")
```

Для текущего `better-sqlite3` подхода это будут nullable/integer поля `author_id`, `updated_by_id`, `uploaded_by_id` с чтением через `LEFT JOIN users`.

## Поля

`KnowledgeArticle`:

- `title`: обязательный заголовок, отображается в списке и карточке.
- `slug`: уникальный человекочитаемый идентификатор. Для MVP можно генерировать из title и добавлять суффикс при конфликте.
- `content`: тело статьи. MVP: plain text/markdown. Rich editor лучше оставить на следующий этап.
- `status`: `draft`, `published`, `archived`.
- `categoryId`: nullable, чтобы статья не ломалась при удалении категории.
- `authorId`: создатель статьи, обязательная связь с `User`.
- `updatedById`: последний редактор, nullable для старых/seed-записей.
- `publishedAt`: заполняется при первом переходе в `published`, сбрасывать не нужно.
- `archivedAt`: заполняется при переходе в `archived`, очищается при возврате из архива.

`KnowledgeCategory`:

- `name`, `slug`, `description`, `sortOrder`, `isActive`, `createdAt`, `updatedAt`.

`KnowledgeArticleRevision`:

- хранит снимок статьи перед изменением или после сохранения. Для аудита предпочтительнее сохранять снимок предыдущей версии перед update.

`KnowledgeAttachment`:

- планируется позже. Не добавлять загрузку файлов в MVP, чтобы не расширять поверхность безопасности и storage.

## Indexes / Unique Constraints

- `KnowledgeCategory.slug` unique.
- `KnowledgeArticle.slug` unique.
- Индексы для списка: `(status, updatedAt)`, `(categoryId, status, updatedAt)`.
- Индексы для аудита: `authorId`, `updatedById`, `articleId + createdAt` у revisions.
- Для SQLite-поиска в MVP можно начать с `LIKE` по `title` и `content`. Если поиск станет медленным, добавить FTS5-таблицу `knowledge_articles_fts` отдельным этапом.

## Permissions

Целевые роли из требований:

| Роль | Чтение `published` | Чтение `draft/archived` | Создание | Редактирование |
| --- | --- | --- | --- | --- |
| `OWNER` | да | да | да | все статьи |
| `ADMIN` | да | да | да | все статьи |
| `SALES_LEAD` | да | опционально | опционально | опционально |
| `SALES_MANAGER` | да | нет | нет | нет |
| `VIEWER` | да | нет | нет | нет |

Текущий проект пока имеет только `owner`, `manager`, `florist`. До расширения ролей нужен compatibility layer:

- `owner` считать аналогом `OWNER`.
- `manager` временно считать аналогом `SALES_MANAGER` или `ADMIN` только если бизнес явно разрешит менеджерам редактировать базу знаний.
- `florist` временно считать reader-only, аналогом `VIEWER`, если им нужен доступ к опубликованным статьям.

Рекомендуемые helper-функции:

- `canReadKnowledgeArticle(user, article)`: true для `published`; для `draft/archived` только writer/admin.
- `canManageKnowledge(user)`: `OWNER/ADMIN`, плюс `SALES_LEAD`, если включим разрешение.
- `canEditKnowledgeArticle(user, article)`: в MVP равно `canManageKnowledge(user)`.
- Server actions и route loaders должны проверять права на сервере, UI-кнопки только скрывают недоступные действия.

## UI Pages

### `/knowledge`

Список статей внутри `CrmShell`.

Состав:

- поиск по title/content;
- фильтр категории;
- фильтр статуса для пользователей с правами редактирования;
- список/таблица статей: title, category, status, author, updatedAt;
- кнопка создания только для writer/admin;
- empty state через существующий `Empty`;
- статусы через `Badge`;
- поиск через `Input`/`InputGroup`, действия через `Button` с lucide-иконками.

Reader-only пользователи видят только `published`. Writer/admin видят все статусы.

### `/knowledge/[articleId]`

Просмотр статьи внутри `CrmShell`.

Состав:

- title;
- category;
- status badge;
- author;
- updatedAt;
- publishedAt/archivedAt при наличии;
- content;
- кнопка edit только для writer/admin.

Маршрут в требовании называется `[articleId]`, поэтому MVP может использовать numeric id. `slug` нужен для уникальности и будущих URL вида `/knowledge/[slug]`, но не обязан быть публичным routing key на первом этапе.

### Create/Edit

Для MVP безопаснее страница или dialog:

- `create/edit dialog` подходит, если контент plain text и форма компактная.
- `create/edit page` лучше, если сразу планируется markdown/rich editor, preview, автосохранение или длинные статьи.

Рекомендуемый MVP: отдельные страницы `/knowledge/new` и `/knowledge/[articleId]/edit`, чтобы не перегружать список и сохранить серверную загрузку данных. Dialog можно добавить позже.

Поля формы:

- title;
- slug с автогенерацией и ручной правкой для writer/admin;
- category;
- status;
- content;
- кнопки save draft / publish / archive в зависимости от текущего статуса и прав.

## Осторожное добавление в CRM

1. Перед миграцией остановить приложение и сделать backup:

   ```bash
   cp app.db "app.db.backup-before-knowledge-$(date +%Y%m%d%H%M%S)"
   ```

2. Добавить только новые knowledge-таблицы. Не менять существующие таблицы `users`, `deals`, `orders`, `wazzup_*`, `stock_*`, `cash_transactions`.
3. Если проект остается на `better-sqlite3`, добавить SQL `CREATE TABLE IF NOT EXISTS ...` и индексы в `migrate()`, без destructive DDL.
4. Если вводится Prisma, сначала отдельно согласовать переход, потому что сейчас Prisma отсутствует в зависимостях и runtime-коде.
5. Seed: добавить demo category/article идемпотентно, например категория "CRM" и опубликованная статья "Как работать с базой знаний". Seed не должен очищать данные.
6. Навигация: добавить новый nav item в `CrmShell` отдельным изменением. Legacy `Backoffice` трогать только если `/knowledge` решат подключать туда, что не рекомендуется.
7. Revalidation: server actions модуля должны revalidate только `/knowledge` и конкретную статью.
8. Тестировать сборкой `npm run build`; для SQL-миграции дополнительно проверить запуск на копии `app.db`.

## Roadmap

1. Schema + seed:
   - добавить таблицы/модели;
   - добавить типы и mapper-функции;
   - seed demo category/article;
   - backup перед миграцией.

2. Read-only list/view:
   - `/knowledge` со списком published-статей;
   - `/knowledge/[articleId]` с просмотром;
   - серверная проверка доступа;
   - навигация в `CrmShell`.

3. Create/edit:
   - server actions для create/update/status transitions;
   - формы new/edit;
   - запись `authorId`, `updatedById`, `publishedAt`, `archivedAt`;
   - revalidate `/knowledge`.

4. Categories:
   - управление категориями для writer/admin;
   - фильтрация по категории;
   - обработка статуса `isActive`.

5. Revisions/history:
   - запись ревизии при каждом update;
   - просмотр истории для writer/admin;
   - восстановление версии отдельным действием.

6. Attachments later:
   - таблица attachments;
   - storage policy;
   - ограничения размера/MIME;
   - удаление/скачивание с проверкой доступа.

## Первый маленький implementation slice

Самый безопасный первый slice:

1. Добавить только таблицы `knowledge_categories` и `knowledge_articles` плюс индексы.
2. Добавить идемпотентный seed одной категории и одной published-статьи.
3. Добавить read-only функции `listKnowledgeArticles()` и `getKnowledgeArticle()`.
4. Добавить `/knowledge` и `/knowledge/[articleId]` только для просмотра published-статей.
5. Не добавлять create/edit, revisions, attachments и управление категориями в первом slice.

## Commit Message

```text
docs: plan knowledge base module
```
