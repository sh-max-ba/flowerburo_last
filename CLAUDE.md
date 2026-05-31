# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Non-standard Next.js (read this first)

This repo runs **Next.js 16.2.6** (App Router) with **React 19**. APIs and conventions differ from older Next.js you may know. Before writing any Next-specific code, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices. This rule (from `AGENTS.md`) overrides training-data assumptions.

## What this is

Flower Ops MVP — a Russian-language backoffice/CRM for a flower shop: cash register, orders ("стол заказов"), warehouse/stock, bouquet templates, shifts, a deals/clients CRM, and a Wazzup (WhatsApp/Instagram/Telegram) integration. The entire UI is in Russian; enum values and statuses are frequently stored as Russian strings.

Stack: Next.js App Router + React 19 + TypeScript (strict), Tailwind v4, shadcn components on `@base-ui/react` (see `components.json`), `better-sqlite3` for storage. No external DB, no ORM — despite planning docs in `docs/knowledge/`, there is **no Prisma**.

## Commands

```bash
npm run dev          # local development only (do NOT use to serve users)
npm run build        # production build + full type check
npm run start        # production server (the intended runtime; PORT=3001 to change port)
npm run lint         # eslint (flat config: next core-web-vitals + typescript)
npm run test:ui      # Playwright UI smoke test (needs a running server + env, see below)
npm run smoke:wazzup # tsx scripts/wazzup-smoke.ts — Wazzup integration smoke check
```

There is no unit-test runner; `npm run build` is the type-check gate. The only automated test is the Playwright smoke spec.

Playwright (`tests/ui-smoke.spec.ts`) requires a server reachable at `PLAYWRIGHT_BASE_URL` (default `http://localhost:3000`) and credentials in `E2E_LOGIN` / `E2E_PASSWORD`. Run a single test by name:

```bash
npx playwright test tests/ui-smoke.spec.ts -g "owner UI smoke audit"
```

Destructive DB reset before a launch (backs up `app.db`, clears working data, preserves `users`/`integration_settings`/`suppliers`/`deal_pipelines`/`deal_stages`):

```bash
CONFIRM_RESET=YES npm run reset-database-for-launch
```

Helper PowerShell scripts in `scripts/` (`dev-start.ps1` / `dev-stop.ps1`) set up a Windows→WSL port proxy; note their hardcoded paths may be stale relative to the current checkout.

## Architecture

### Data + business logic monolith — `src/lib/db.ts` (~5700 lines)

This single file holds the SQLite schema, migrations, and most domain logic (products, sales, orders, shifts, cash transactions, stock movements, stock documents, suppliers, bouquet templates, warehouse imports, users/sessions).

- DB is opened lazily at `path.join(process.cwd(), "app.db")` on the first `db()` call → **always run commands from the project root.** Single connection, `journal_mode = WAL`, `foreign_keys = ON`.
- First-run side effects (in `db()`): `migrate()` creates all tables, then seeds a default owner (`admin` / `fb2026`), a default deal pipeline "Основная воронка" with stages, and products imported from the committed `moysklad_stock_report_2026-05-09.csv`.
- **Schema changes:** the `CREATE TABLE` blocks use `IF NOT EXISTS` and are never edited for existing DBs. Add new columns via `ensureColumn(table, column, "ALTER TABLE ... ADD COLUMN ...", client)` — there are dozens of these; follow the pattern instead of mutating `CREATE TABLE`.
- `app.db`, `app.db-wal`, `app.db-shm` are gitignored; the seed CSV is committed. Never commit the DB.

### CRM + integrations

- `src/lib/crm.ts` — deals, customers, pipelines/stages, deal items.
- `src/lib/wazzup.ts` (~2000 lines) + `src/lib/wazzup-webhook.ts` — Wazzup integration. **All keys are server-side only** (`integration_settings` table, with `WAZZUP_API_KEY`/`WAZZUP_CRM_KEY` env as fallback); never expose them to client code. Webhook endpoint `POST /api/wazzup/webhook`, chat iframe via `/api/wazzup/iframe`, configured in `/settings`. See `README.md` and `docs/integrations/wazzup/`.

### Two app shells coexist (legacy + new)

- **`Backoffice`** (`src/components/backoffice.tsx`, ~5500 lines) rendered via `BackofficeRoute` — a big client monolith keyed by a `section` prop. Used by `/` (cash), `/cash`, `/orders`, `/ready-orders`, `/stock`, `/bouquets`, `/settings`, `/users`, `/history`.
- **`CrmShell`** (`src/components/crm-shell.tsx`) — newer per-route shell. Used by `/deals`, `/clients`, `/shifts`, `/stock/acts`, `/history/stock`. **Prefer `CrmShell` for new routes.**

### Pages, mutations, and the request flow

- Pages are React Server Components under `src/app/`. They guard access (`requireUser()` + role check → `<AccessDenied>`), fetch via `db.ts`/`crm.ts` functions directly, and render a shell. Data-driven pages set `export const dynamic = "force-dynamic"`.
- **All mutations go through Next.js Server Actions** in `src/app/actions.ts` (and `auth-actions.ts`) — never call DB writes from components directly. The pattern: thin wrappers `runRoleAction(roles, fn, msg)` / `runCashAction(fn, msg)` / `runAction(fn, msg)` that (1) enforce role/cash access, (2) call a `db`/`crm`/`wazzup` function, (3) `revalidatePath(...)`, and (4) return `{ ok, message, messages? }`. New mutations should add an action here following this shape.
- Realtime is **polling, not websockets**: client components hit count endpoints (`/api/deals/incoming-count`, `/api/ready-orders/count`) every ~5s and `router.refresh()`.

### Auth & roles — `src/lib/auth.ts`

- Session is a stateless **HMAC-signed cookie token** (`flower_ops_session`, 7-day TTL); secret from `AUTH_SECRET` / `NEXTAUTH_SECRET` (falls back to a dev constant — **set a real secret in production**). A DB `sessions` fallback also exists.
- Roles: `owner` | `manager` | `florist`. Guards: `requireUser`, `requireRole`, `canUseCash` (a florist needs an open *night* shift), `canCloseShift`. Default landing: florist → `/orders`, others → `/cash`.
- **Role/access rules are duplicated in three places that must stay in sync** when adding or gating a feature: `navItems` (`crm-shell.tsx`), `canAccessSection` (`backoffice-route.tsx`), and the per-action `roles` lists in `actions.ts`.

### Shared domain helpers

- `src/lib/pricing.ts` is the single source of truth for line totals, discounts, and grand totals (`calculateLineTotal`, `calculateCommercialTotals`). Discount types are `none|percent|amount`; money is rounded to 2 dp. Reuse these — don't recompute totals ad hoc in components or actions.
- `src/lib/labels.ts` maps enum/status values to Russian display labels (payment methods, cash transaction types, stock document statuses, sources). Note legacy mixed values: order statuses are RU strings ("Новый", "В работе", …) but older `new`/`in_progress`/`ready` are still treated as active in places like `activeDealOrderStatuses`.

## Conventions

- Import alias `@/*` → `src/*`.
- Env: see `.env.example` (`AUTH_SECRET`/`NEXTAUTH_SECRET`, `WAZZUP_API_KEY`, `WAZZUP_CRM_KEY`, `NEXT_PUBLIC_APP_URL`, `SESSION_COOKIE_SECURE`, `PORT`).
- User-facing strings are Russian; match surrounding tone and existing labels.
- Warehouse import/export uses `xlsx` + `exceljs` (runtime deps, not dev-only).
