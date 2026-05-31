# Приложение: полный перечень находок UI/UX (по модулям)

> Сгенерировано из структурированных аудитов 10 субагентов (по одному на модуль). Полная детализация всех находок с приоритетом, категорией, расположением `file:line`, проблемой, влиянием, рекомендацией и оценкой объёма. Сводный план и дорожная карта — в [ui-ux-audit-2026-05-31.md](./ui-ux-audit-2026-05-31.md).

## Дизайн-система и навигация (cross-cutting) — 6/10

**Основная роль / задача:** Every role inherits this. Owner/manager live in the full sidebar (CRM + Работа + Склад + Администрирование) on desktop; florists see a minimal nav (Стол заказов, plus Касса during a night shift) and are the most likely to be on a tablet at the counter under time pressure.

**Маршруты:** (global) src/app/layout.tsx, (global shell) src/components/crm-shell.tsx, (global) src/app/globals.css

**Оценка:** The design system is a competently-built shadcn/base-ui foundation: clean primitives, a sensible collapsible sidebar with grouped IA, a sticky topbar with shift status, and a consistent radius/spacing scale. But the headline decision — a fully monochrome (chroma=0) palette with a single red `--destructive` — is the wrong call for a fast-paced flower-shop CRM where status legibility at a glance matters, and the codebase already proves it: 14 modules hand-roll colored badges (47 occurrences of bg-emerald/amber/red/etc.), fighting the theme because the monochrome Badge can't express "Готов / Передан курьеру / оплачен / просрочен." Worse, the theme is half-finished: a full `.dark` token block and `dark:` variants exist across primitives, and `sonner.tsx` imports `useTheme` from `next-themes`, yet there is no ThemeProvider or theme toggle anywhere — so dark mode is dead code and toasts silently follow OS theme (plus `richColors` contradicts the monochrome intent). The shell is desktop-first and largely solid, but the topbar wastes its right side on a near-static shift badge, collapsed-icon mode hides group structure with no separators, and touch targets/density aren't tuned for the tablet use at the counter. The right move is a focused design-system pass: add a small set of semantic status tokens (success/warning/info) + Badge tones, either wire up or delete dark mode, and tighten the shell for tablet.

### 🟠 P1 — Monochrome theme has no semantic status colors, so 14 modules hand-roll inconsistent colored badges

- **Категория:** `color-visual-signal` · **Объём:** M · **Где:** `src/app/globals.css:51-84; src/components/ui/badge.tsx:10-22; src/components/orders/order-shared.tsx:575-585`
- **Проблема:** The palette is fully chroma=0 with only one red `--destructive`. Badge variants are all grayscale (default=black, secondary=gray, outline=white, destructive=red). But a flower CRM needs to signal 'Готов', 'Передан курьеру', 'Курьер оплачен/не оплачен', 'просрочено' at a glance. The result: modules bypass the system and inline raw Tailwind palette classes — `<Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Готов</Badge>` and `bg-amber-100 text-amber-900` in order-shared.tsx and ready-orders-page.tsx. A grep finds 47 occurrences of bg-emerald/amber/green/red/yellow/blue across 14 component files, with inconsistent shades and inconsistent hover handling. So the 'monochrome' system isn't actually monochrome in practice — it's monochrome-plus-uncoordinated-ad-hoc-color, which is the worst of both: no single source of truth, drift guaranteed.
- **Влияние:** Status becomes legible at a glance under counter time-pressure (the recurring weakness), and color stops drifting across modules.
- **Рекомендация:** Add a small semantic token set to globals.css (`--success`, `--success-foreground`, `--warning`, `--warning-foreground`, `--info` — low-chroma oklch, e.g. green ~0.6/0.13/150, amber ~0.8/0.12/85) and expose them as `--color-*` in the @theme block. Add Badge variants `success | warning | info` (and matching subtle bg/foreground) so status renders as `<Badge variant="success">Готов</Badge>`. Then migrate the 47 ad-hoc usages. This keeps the calm gray UI for chrome but gives status one coordinated color vocabulary.

### 🟠 P1 — Dark mode is dead code: full .dark tokens + dark: variants exist but no ThemeProvider/toggle; sonner uses next-themes with no provider

- **Категория:** `consistency` · **Объём:** M · **Где:** `src/app/globals.css:86-118; src/components/ui/sonner.tsx:3-9; src/app/layout.tsx:25-38`
- **Проблема:** globals.css ships a complete `.dark` token block, and primitives (button, badge, tabs, input, select, etc.) carry `dark:` classes — yet there is no `next-themes` ThemeProvider anywhere, no `.dark` class ever applied, and no theme toggle. So dark mode can never activate; it's maintained-but-unreachable code that every primitive edit must keep in sync for no benefit. Meanwhile `sonner.tsx` calls `useTheme()` from next-themes WITHOUT a provider, so `theme` is undefined → defaults to `"system"`. That means toast color follows the OS dark/light preference independently of the app, which is locked light — on a dark-mode OS the toasts can render dark while the whole app is light. Additionally `layout.tsx` sets `<Toaster richColors closeButton />`, and richColors paints success green / error red — directly contradicting the 'monochrome with single red' design intent.
- **Влияние:** Removes a silent toast-theme bug, eliminates dead-code maintenance tax, and makes the palette decision coherent.
- **Рекомендация:** Pick one: (A) actually ship dark mode — add `next-themes` ThemeProvider in layout.tsx with `attribute="class"` and a toggle in the sidebar footer or topbar; or (B) delete dark mode — drop the `.dark` block, strip `dark:` variants, and replace `useTheme()` in sonner.tsx with a hardcoded `theme="light"`. Given the deliberate monochrome direction, (B) is lower-risk and removes a whole class of sync bugs. Either way, decide on `richColors` deliberately (it's currently fighting the palette).

### 🟡 P2 — PageHeader and several primitives bypass theme tokens, hardcoding zinc-* — undermines the token system

- **Категория:** `consistency` · **Объём:** M · **Где:** `src/components/page-header.tsx:21-23; src/components/ui/table.tsx:11,26,73,86; src/components/ui/card.tsx:15,41,53; src/components/ui/sidebar.tsx:447,522,636`
- **Проблема:** globals.css defines a full token set (--foreground, --muted-foreground, --border, --card, --sidebar-*), but many primitives hardcode raw `zinc-*` / `white` instead: PageHeader uses `text-zinc-950`/`text-zinc-500`, Table uses `border-zinc-300`/`bg-zinc-100`/`text-zinc-700`/`text-zinc-900`, Card uses `border-zinc-300`/`bg-white`/`text-zinc-950`, the SidebarMenuButton hardcodes `text-zinc-800`/`data-active:bg-zinc-950 ...text-white`, and SidebarGroupLabel hardcodes `text-zinc-600`. This is why dark mode (above) can't work even if enabled — the surfaces are pinned to light zinc values that ignore the tokens. It also means a single token tweak (e.g. softening borders) won't propagate.
- **Влияние:** Tokens become the real source of truth; palette/contrast changes propagate; dark mode becomes feasible.
- **Рекомендация:** Replace hardcoded zinc/white in the shared primitives with the existing tokens (`text-foreground`, `text-muted-foreground`, `border-border`, `bg-card`, `bg-muted`, `text-sidebar-foreground`, etc.). Do this as part of the dark-mode decision (finding above): if keeping light-only, at least centralize on tokens so future palette changes are one-file edits.

### 🟡 P2 — No loading/route-transition feedback on navigation; Link clicks give no pending state

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/crm-shell.tsx:121-129; src/app/layout.tsx:20-39`
- **Проблема:** Sidebar items are plain `<Link>`s with no pending indicator, and there is no top-level route loading bar or `loading.tsx` convention surfaced in the shell. Data pages are `force-dynamic`, so navigation to a heavy page (deals, stock, history) can hang for a beat with the previous screen frozen and no signal that the click registered — exactly the moment a counter user double-clicks or assumes the app is stuck. SidebarMenuSkeleton exists in the primitive but is unused.
- **Влияние:** Removes the 'did my click work?' dead-air on every cross-section navigation.
- **Рекомендация:** Add an active-pending affordance: wrap nav with `useTransition`/`useLinkStatus` (Next 16) to show a spinner on the clicked SidebarMenuButton, or add a global top progress bar in the shell. At minimum, ensure each dynamic route has a `loading.tsx` that renders skeletons using the existing Skeleton/SidebarMenuSkeleton primitives.

### 🟡 P2 — Collapsed-icon sidebar loses all group structure — labels vanish with no separators, only hover tooltips

- **Категория:** `navigation` · **Объём:** S · **Где:** `src/components/crm-shell.tsx:104-139; src/components/ui/sidebar.tsx:437-459`
- **Проблема:** In collapsed mode the SidebarGroupLabel is hidden via `group-data-[collapsible=icon]:-mt-8 ...:opacity-0`, but nothing replaces it: the four groups (CRM / Работа / Склад / Администрирование) collapse into one undifferentiated vertical stack of ~11 icons with zero visual grouping. Several icons collide semantically — `ClipboardListIcon` is used for BOTH 'Стол заказов' (orders) and 'Акты склада' (stock-acts) (nav-icons.tsx:24,27), and `BanknoteIcon` is reused for both 'Касса' context and 'Смены'. So in icon-only mode two different sections show the same glyph and the only disambiguation is the hover tooltip, which is slow under time pressure and unavailable on touch.
- **Влияние:** Collapsed mode stays navigable and unambiguous, especially on tablet where tooltips don't fire.
- **Рекомендация:** Render a thin `SidebarSeparator` (already exported) between groups when collapsed so the four clusters stay visually distinct. Give orders vs stock-acts distinct icons (e.g. keep ClipboardList for orders, use FileText/ScrollText for акты) and give Смены a distinct icon from Касса (e.g. CalendarClock). Optionally keep a tiny uppercase group initial in icon mode instead of fully hiding the label.

### 🟡 P2 — Tables overflow horizontally with no sticky header and tap-unfriendly density on tablet

- **Категория:** `responsive-touch` · **Объём:** M · **Где:** `src/components/ui/table.tsx:7-19,68-92`
- **Проблема:** The Table container is `overflow-x-auto` with whitespace-nowrap cells (TableHead and TableCell both `whitespace-nowrap`), so wide tables (orders, stock, history) scroll sideways on a tablet with no sticky header and no responsive card fallback. Row height is driven by `p-3` cells (~40px header via h-10) which is acceptable for mouse but tight for finger taps, and `hover:bg-zinc-50` is the only row affordance — there's no touch/active feedback, so on a tablet a tapped row gives no signal.
- **Влияние:** Tablet users at the counter can read/act on tables without two-axis scrolling and blind taps.
- **Рекомендация:** For the data-heavy modules used on tablet, provide a responsive card list below ~md (the codebase already has card patterns), or at least make the header sticky (`thead` `sticky top-0`) and add `active:bg-zinc-100` for touch feedback. Audit which columns can wrap vs must stay nowrap so the horizontal scroll is the exception, not the rule.

### 🟡 P2 — Two heading-typography systems with different scales: topbar/PageHeader vs CardTitle/EmptyTitle are inconsistent

- **Категория:** `visual-design` · **Объём:** S · **Где:** `src/components/page-header.tsx:21; src/components/app-topbar.tsx:44; src/components/ui/card.tsx:41; src/components/ui/empty.tsx:62`
- **Проблема:** Page titles render in at least three different sizes/weights depending on surface: AppTopbar title is `text-base font-semibold` (16px), PageHeader h1 is `text-2xl font-semibold` (24px), CardTitle is `font-heading text-base`, EmptyTitle is `font-heading text-sm font-medium`. Some use the Cal Sans `font-heading`, some don't (PageHeader's h1 inherits font-heading via the globals `h1` rule, but AppTopbar's title is a `div`, so the most prominent on-screen title is NOT in the display font). There's no documented type scale, so 'the page title' looks materially different between the sticky bar and the page body, and the heading font is applied unevenly.
- **Влияние:** Coherent typographic hierarchy; the brand display font actually shows where it matters.
- **Рекомендация:** Define a small type scale (e.g. page-title 24/600 heading-font, section-title 16/600 heading-font, body 14/400) and apply it consistently. Make AppTopbar's title use `font-heading` so the always-visible title matches the brand font. Consider whether PageHeader and the topbar title should both exist — they often duplicate the same string.

### 🟡 P2 — Topbar right side is low-value: a near-static shift badge dominates, no quick actions, no global search

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/app-topbar.tsx:51-86`
- **Проблема:** The topbar's right cluster spends its space on a 'Смена открыта/закрыта' Badge that rarely changes during a session, plus user name/role (already shown in the sidebar footer). There is no global search, no 'new sale / new order / new deal' quick action, and no notification surface — even though the app polls for incoming deals and ready orders (badges live only in the collapsed-friendly sidebar). For a counter tool, the most valuable persistent affordance — start the next transaction — is absent from the always-visible bar. The shift badge also uses `variant={openShift ? 'secondary' : 'outline'}`: 'open' (the safe state) and 'closed' (the state that blocks florist cash work) look almost identical in gray, so the one truly important status here is not visually distinct.
- **Влияние:** Turns dead topbar real estate into the fastest path to the role's core action and makes shift state unmistakable.
- **Рекомендация:** Slim the shift badge (consider success/destructive tones once semantic colors land so open vs closed reads instantly), drop the duplicated user name/role (keep it only in the sidebar footer), and add a primary context action slot to the topbar (e.g. a `+` button that maps to the section's main create action). Optionally surface the incoming-deals/ready-orders counts here too so they're visible when the sidebar is collapsed.

### ⚪ P3 — Sidebar keyboard shortcut is Ctrl/Cmd+B but undiscoverable, and there's no other keyboard support for a counter tool

- **Категория:** `accessibility` · **Объём:** M · **Где:** `src/components/ui/sidebar.tsx:34,141-154; src/components/app-topbar.tsx:40-42`
- **Проблема:** The only keyboard shortcut is hardwired Ctrl/Cmd+B to toggle the sidebar, with no hint anywhere (the topbar trigger's only label is the sr-only 'Toggle Sidebar'). For a repeat-use register/order tool, there's no keyboard path to jump between sections or trigger the primary action, and the one shortcut that exists is invisible. Ctrl+B can also collide with browser/rich-text expectations.
- **Влияние:** Speeds up repeat navigation for the staff who use this all day; improves a11y discoverability.
- **Рекомендация:** Surface the shortcut in the SidebarTrigger tooltip (e.g. 'Меню · Ctrl+B'). Consider a Command palette (the `command` primitive already exists in ui/) bound to Ctrl/Cmd+K for fast section jumps and create actions — high leverage for power users at the counter.

### ⚪ P3 — Empty-state primitive ships without a visible border and is rarely given an icon/action — empty screens read as 'broken'

- **Категория:** `feedback-states` · **Объём:** S · **Где:** `src/components/ui/empty.tsx:5-16; src/components/orders/ready-orders-page.tsx:96`
- **Проблема:** Empty wraps content with `border-dashed` but no `border` width/color class, so the dashed container border doesn't actually render (border-style with no border-width = invisible). Combined with the all-gray theme and EmptyTitle being only `text-sm font-medium`, empty states are a faint centered line of gray text with no framing and frequently no icon or call-to-action (e.g. ready-orders 'Готовых заказов пока нет'). On a fresh/empty shop screen this looks like a load failure rather than an intentional empty state.
- **Влияние:** Empty states look intentional and offer a next step instead of reading as errors.
- **Рекомендация:** Add `border border-dashed border-border` (with a width) to the Empty base so the dashed frame shows, and establish a convention: every empty state gets an EmptyMedia icon + an EmptyContent action button (the primitives already support both). Bump EmptyTitle to a slightly larger weight for scannability.

### ⚪ P3 — Brand identity is text-only ('FlowerBuro | sellz' / 'FB') — a flower shop CRM with zero warmth or logo

- **Категория:** `visual-design` · **Объём:** S · **Где:** `src/components/crm-shell.tsx:94-103; src/app/layout.tsx:15-18`
- **Проблема:** The sidebar header is a plain text string that collapses to the initials 'FB' in icon mode; there's no logo mark, no favicon-quality brand asset surfaced in-app, and combined with the strictly grayscale palette the product feels like a generic admin template rather than a tool for a flower business. For staff using it all day, a touch of brand/identity aids orientation and ownership; for a flower shop specifically, the total absence of any warmth is a notable miss.
- **Влияние:** Stronger orientation and a product that feels purpose-built rather than a default template.
- **Рекомендация:** Add a small logo/mark to the SidebarHeader (and a proper icon variant for collapsed mode) using the existing `apple-icon.png`/`icon.png` assets already in the repo. This pairs naturally with introducing a restrained accent color (see status-color finding) so the brand has at least one signature hue.

### ⚪ P3 — Sidebar active state uses pure black fill (bg-zinc-950/white text), heavier than the rest of the calm UI

- **Категория:** `visual-design` · **Объём:** S · **Где:** `src/components/ui/sidebar.tsx:522`
- **Проблема:** Active nav item is `data-active:bg-zinc-950 data-active:text-white` — a full black pill. In an otherwise light, low-contrast gray shell this is a very heavy treatment, and because there's no accent color it's the single boldest element on screen at all times, pulling the eye to the nav rather than the content. It also makes the active icon/text the same near-black as primary buttons, so 'where am I' and 'primary action' share the strongest visual weight.
- **Влияние:** Visual weight goes to content and primary actions instead of permanently to the nav.
- **Рекомендация:** Soften the active treatment to a subtle filled state (`bg-sidebar-accent text-sidebar-accent-foreground` + a left active bar or font-semibold) rather than full black, reserving the strongest black for actual primary actions. If semantic color lands, an accent-tinted active state would read even better.

> **Предложение по редизайну:** A focused design-system pass (not a full redesign — the shell architecture is sound). Three workstreams: (1) Semantic color layer: add low-chroma `--success/--warning/--info` tokens (plus subtle bg/fg pairs) to globals.css and expose them in the @theme block; add `success|warning|info` Badge variants; migrate the 47 ad-hoc bg-emerald/amber/red usages onto them. Keep the calm gray chrome, but let STATUS (Готов / Передан курьеру / оплачен / просрочен / смена открыта-закрыта) carry one coordinated, accessible color vocabulary. (2) Theme coherence: resolve the dead dark mode — either wire `next-themes` ThemeProvider + a sidebar toggle and migrate hardcoded zinc-* in primitives to tokens, OR delete the .dark block + dark: variants and hardcode sonner to light. (3) Shell tightening for tablet/counter: slim the topbar shift badge and add a primary-action slot + optional global search/command palette (Ctrl+K, command primitive already present); make data tables responsive (card fallback below md or sticky header + active:touch states); add route-transition pending feedback on nav. This yields a system that is still deliberately restrained but legible under time pressure, internally consistent (no per-module color drift), and usable on the tablet at the register.

**Quick wins:**

- Add `border border-dashed border-border` to ui/empty.tsx so empty states actually show their frame, and standardize an icon + action in each empty state
- Give 'Стол заказов' and 'Акты склада' distinct icons (currently both ClipboardListIcon) and Смены a distinct icon from Касса in nav-icons.tsx
- Render a SidebarSeparator between nav groups in collapsed-icon mode so the 4 groups stay distinguishable
- Make AppTopbar's title use font-heading and surface the Ctrl+B shortcut in the SidebarTrigger tooltip
- Decide richColors deliberately: either remove it (monochrome intent) or keep it as the start of a semantic color set; fix sonner's useTheme-without-provider

---

## Касса (cash register) — 5/10

**Основная роль / задача:** Florist/manager at the physical counter ringing up walk-in cash sales fast, and managers creating delivery/pickup orders with prepayment. Core task = add items, pick payment method, take money, complete — repeated many times per shift under time pressure.

**Маршруты:** /, /cash

**Оценка:** The cash register is a two-tab screen (Быстрая продажа / Новый заказ) built on a search-combobox + line-item cart + sticky payment panel. The skeleton is sound and the pricing/discount math is centralized and correct, but the screen is not optimized for the speed-critical counter context it serves. The biggest gaps are operational: there is no cash-tendered / change-due calculation (a cashier handed 5000 for a 3200 sale gets no help computing change), no full keyboard flow through the combobox results or line items, an over-sized line-item table that horizontally scrolls inside a constrained column, and a destructive cash-withdrawal that fires with no confirmation. Status/availability signals lean on hardcoded amber/emerald colors that violate the monochrome design system and will read inconsistently. For a florist running a busy counter, completing a simple cash sale takes more mouse work and more visual hunting than it should.

### 🔴 P0 — Destructive cash withdrawal has no confirmation

- **Категория:** `feedback-states` · **Объём:** S · **Где:** `src/components/cash/cash-page.tsx:617-626, 1168-1224`
- **Проблема:** 'Изъятие наличных' opens a dialog with amount + comment and a single 'Изъять' button that immediately posts a money-out cash transaction against the shift. There is no review/confirmation of the amount and no undo. A mistyped digit (e.g. 50000 vs 5000) silently corrupts the shift cash balance. Cash-out is exactly the kind of irreversible money operation that should require a deliberate confirmation.
- **Влияние:** Prevents accidental, hard-to-reverse cash drawer corruption.
- **Рекомендация:** Either (a) add an AlertDialog confirmation showing the formatted amount before posting ('Изъять 5 000 сом из кассы?'), or (b) echo the parsed/formatted amount inline in the dialog before the submit button. The codebase already has alert-dialog primitives; reuse them.

### 🔴 P0 — No cash-tendered / change-due calculation for cash sales

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/cash/cash-page.tsx:555-567`
- **Проблема:** The payment panel shows only 'Итого после скидок'. For the most common transaction — a cash walk-in — the cashier has no field to enter the amount received and no computed change ('Сдача'). They must do mental arithmetic at the counter (e.g. 5000 given, 3220 total). This is the single highest-value missing affordance on a cash-register screen and a direct source of counter errors.
- **Влияние:** Eliminates manual change math, the most error-prone step in every cash sale.
- **Рекомендация:** When paymentMethod === 'cash', show a 'Получено от клиента' Input below Итого and render 'Сдача' = max(0, received − saleTotal) in a large line (reuse the existing 3xl total styling). Highlight if received < total. Keep it client-side only; nothing needs to be persisted unless desired.

### 🟠 P1 — Hardcoded amber/emerald colors violate the monochrome design system

- **Категория:** `color-visual-signal` · **Объём:** M · **Где:** `src/components/cash/cash-page.tsx:165, 474, 868, 1130, 1144; src/components/products/product-line-items.tsx:270; src/components/products/product-combobox.tsx:314-320, 350`
- **Проблема:** The global theme is fully monochrome with only one --destructive accent, yet this module sprinkles literal Tailwind colors: amber alert ('Откройте смену'), emerald 'Скидка клиента N%' badge, amber 'Цена 0' badge, amber 'Не хватает'/destructive stock badge, amber/emerald 'Остаток' balance. These are inconsistent with the rest of the app, won't track theme changes, and the emerald-on-emerald discount badge and amber-on-amber balance carry low contrast. Status signaling is exactly the recurring weakness flagged for this codebase.
- **Влияние:** Consistent, theme-correct, higher-contrast status signaling across the screen.
- **Рекомендация:** Route all of these through Badge variants / design tokens: use variant='outline'/'secondary' for neutral info, variant='destructive' (or the single --destructive token) for the genuinely negative ones (negative stock, price 0, balance owed). Define one shared 'warning' approach in the design system rather than inline amber. Keep semantics legible in grayscale by pairing icon + label, not color alone.

### 🟠 P1 — Payment-method and discount-type controls are raw native <select>, inconsistent with the form

- **Категория:** `consistency` · **Объём:** M · **Где:** `src/components/cash/cash-page.tsx:499-512, 524-534, 1071-1083, 1091-1101; src/components/products/product-line-items.tsx:276-291`
- **Проблема:** Payment method, discount type (per-line and per-check), and order delivery type all use bare <select className='h-8 ...'> elements while the rest of the app uses the shadcn Select primitive (used even in this same file's CustomerCreateDialog at line 271). The native selects are 32px tall (below comfortable touch target), don't match focus/hover styling, and look visibly different. Payment method is chosen on every single sale, so this inconsistency is hit constantly.
- **Влияние:** Consistent look/behavior and adequate tap targets on the most-used control.
- **Рекомендация:** Replace these native selects with the existing Select component (SelectTrigger/SelectContent/SelectItem) already imported in this file. For payment method specifically, consider a segmented control of buttons given it's a per-sale choice.

### 🟠 P1 — Line-item cart forces horizontal scrolling at the counter

- **Категория:** `responsive-touch` · **Объём:** L · **Где:** `src/components/products/product-line-items.tsx:96-110`
- **Проблема:** The cart Table is hard-coded to min-w-[900px] with 8 columns (Товар / Кол-во / Цена / Скидка / До скидки / Скидка / Итого / delete), rendered inside the left 'minmax(0,1fr)' column next to a 360px payment panel. On any realistic desktop and definitely on a tablet, the cart scrolls horizontally, so the cashier cannot see qty, price and line total at once and must scroll a nested ScrollArea horizontally to reach the delete button. Horizontal scroll inside a vertical ScrollArea is a known anti-pattern for fast counter use.
- **Влияние:** Whole cart visible without horizontal scrolling; far faster review before completing.
- **Рекомендация:** For the quick-sale context, replace the wide table with a compact responsive row layout: thumbnail + name on line 1, then a single row of [qty stepper] [line total] [⋯ for price/discount] [delete]. Move per-line price and discount editing into a popover or expandable disclosure. Reserve the full 8-column table for the wider order/deal editors only.

### 🟠 P1 — Quick-sale combobox does not reset focus state, and quantity field has no Enter-to-confirm scanner flow

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/products/product-combobox.tsx:125-150, src/components/products/product-line-items.tsx:228-241`
- **Проблема:** After selecting a product the input refocuses (good), but the typical counter flow 'scan/type → set qty → next item' is broken: the qty <Input> is a plain number field with stepper buttons (icon-sm, 28px) and no Enter handling, so increasing qty to e.g. 12 means many clicks on a tiny button or selecting the field with the mouse. There is no way to add a product with a quantity directly from search.
- **Влияние:** Cuts clicks for multi-quantity lines, common for stems sold by the piece.
- **Рекомендация:** Either allow a 'qty x name' shortcut in search (e.g. type '3 роза' to add 3), or make the qty field auto-select on focus and accept typed values cleanly (it already supports typing but the small steppers dominate). At minimum enlarge the steppers for touch (see separate finding).

### 🟠 P1 — Product search dropdown lacks arrow-key navigation

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/products/product-combobox.tsx:160-176`
- **Проблема:** The custom combobox only handles Enter (selects results[0]) and Escape. There is no ArrowDown/ArrowUp to move through the up-to-10 results and no visually highlighted active item. A cashier who types a query matching several products can only keyboard-select the first; to pick the 3rd they must reach for the mouse. There is also no roving aria-activedescendant, so this is both a speed and an a11y gap.
- **Влияние:** Lets a fast cashier add any matched item without leaving the keyboard.
- **Рекомендация:** Add activeIndex state, handle ArrowDown/ArrowUp/Home/End to move it, Enter selects the active result, and style the active row with the existing hover/accent class. Wire aria-activedescendant + role=option/listbox for screen readers. Reuse the existing ProductComboboxRow styling for the highlight.

### 🟡 P2 — Sale completion has no visible loading state on the button and uses a non-optimistic full refresh

- **Категория:** `feedback-states` · **Объём:** S · **Где:** `src/components/cash/cash-page.tsx:97-110, 564-567`
- **Проблема:** On submit, run() starts a transition, awaits the action, toasts, then router.refresh(). The primary button only goes disabled (no spinner/'Проведение…' text), so during a slow DB write the cashier gets no positive 'working' signal and may click again or assume it failed. The whole page also re-fetches dashboard data on every sale, which on a busy counter adds latency between consecutive sales.
- **Влияние:** Clear in-progress feedback; prevents double-submits and perceived stalls.
- **Рекомендация:** Show a pending state on the button (spinner + 'Проведение…') driven by isPending. Consider scoping the refresh or clearing the form optimistically before the toast so the next sale can start immediately.

### 🟡 P2 — Bouquet 'не хватает позиций' only warns via a transient toast, easy to miss

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/products/product-combobox.tsx:135-150`
- **Проблема:** Selecting a bouquet with insufficient stock fires toast.warning('По букету не хватает позиций на складе') and then still adds it. In the cart there is no persistent indicator that the added bouquet is short on stock — the warning vanishes in ~4s. A cashier who looked away will complete a sale for an unbuildable bouquet without realizing it.
- **Влияние:** Stock shortfall stays visible through to checkout, preventing impossible sales.
- **Рекомендация:** Carry the availability flag onto the cart line and render a persistent badge/inline note ('Не хватает компонентов') on the bouquet group row in ProductLineItems, not just a transient toast. The getBouquetAvailability data is already available at selection time.

### 🟡 P2 — Primary action button gives no reason when disabled

- **Категория:** `feedback-states` · **Объём:** S · **Где:** `src/components/cash/cash-page.tsx:564-567, 1152-1158`
- **Проблема:** 'Провести продажу' / 'Провести заказ' is disabled when items.length === 0, shift closed, prepaid too high, etc., but just greys out with no explanation. A florist seeing a dead button doesn't know whether the cart is empty, the shift is closed, or the prepayment is invalid. The top amber alert covers the shift case but not the empty-cart case, and the order button has multiple silent disabled reasons.
- **Влияние:** Cashier instantly understands why they can't complete the sale.
- **Рекомендация:** Show the blocking reason near the button (FieldDescription or a small muted line): 'Добавьте хотя бы один товар' when empty, 'Откройте смену' when no shift, 'Предоплата выше итога' (already an alert) — or use a Tooltip on the disabled button. Cheap to add and removes confusion.

### 🟡 P2 — Stepper and delete tap targets are 28px — too small for touch/counter

- **Категория:** `responsive-touch` · **Объём:** S · **Где:** `src/components/products/product-line-items.tsx:219-250, 318-330`
- **Проблема:** Qty +/- and the delete button use size='icon-sm' which maps to size-7 (28px). The brief states some screens are used on tablets and at the counter under time pressure; 28px is below the ~44px recommended touch target, and these are the most-tapped controls in the cart. The bouquet/single delete buttons share the same issue.
- **Влияние:** Fewer mis-taps and faster qty edits on tablet/touch.
- **Рекомендация:** Use size='icon' (40px) or at least 'icon-lg' (36px) for the qty steppers and delete in the cart, especially in the quick-sale layout. The Button primitive already exposes these sizes.

### ⚪ P3 — Customer combobox and 'Новый клиент' button compete; phone-only search is good but defaults hide most customers

- **Категория:** `forms-input` · **Объём:** M · **Где:** `src/components/customers/customer-combobox.tsx:38-51, src/components/cash/cash-page.tsx:457-472`
- **Проблема:** With no query the combobox shows only customers.slice(0,20) with no hint that the list is truncated, and there's no count. At the counter a regular's name typed slightly wrong returns 'Клиент не найден' with no quick 'create with this name' path — the separate 'Новый клиент' button opens an empty dialog, losing the typed query. Phone digit-normalized search is a nice touch and works well.
- **Влияние:** Faster regular-customer attach and one-step create from a typo.
- **Рекомендация:** When search yields no match, offer an inline 'Создать клиента "<query>"' CommandItem that opens the create dialog pre-filled with the typed name/phone. Optionally show '+N ещё' when results are truncated.

### ⚪ P3 — Quick-sale 'Скидка на чек' value field and per-line price use step='1' but money/discount can be fractional

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/cash/cash-page.tsx:538-551, src/components/products/product-line-items.tsx:255-268, 292-305`
- **Проблема:** Price, discount value, delivery and prepaid inputs use step='1'. The customer default-discount field allows step='0.01' (line 294 of the create dialog) and pricing math rounds to 2dp, so there's an inconsistency: a cashier nudging via spinners can only move in whole units, and percent discounts with decimals (e.g. 2.5%) can be typed but feel unsupported. Minor, but inconsistent across the same screen.
- **Влияние:** Consistent numeric entry; avoids surprise rounding mismatches.
- **Рекомендация:** Standardize step (e.g. step='any' or '0.01' for money/percent) so spinner increments and typed precision agree with the 2dp pricing model.

> **Предложение по редизайну:** The Quick-Sale tab warrants a focused redesign around a "tender & change" flow, since that is the actual counter task. Concretely: (1) Keep the left search + cart, but render cart lines as compact rows (thumbnail, name, qty stepper, line total) instead of an 8-column table that forces horizontal scroll; move price/discount editing into a per-line popover or an expandable row so the default view is scannable in one glance. (2) In the sticky Оплата panel, after the big Итого, add a 'Получено от клиента' (cash tendered) number input that appears for cash/наличные payment, and show 'Сдача' (change) = tendered − total in a large, prominent line. This is the single most useful missing affordance for a cashier and removes mental math at the counter. (3) Make payment method a segmented row of large tap targets (Наличные / Карта / Перевод…) rather than a dropdown, since it is chosen on every sale. (4) Give the primary 'Провести продажу' button a clearer disabled reason (e.g. 'Добавьте товар' / 'Откройте смену') instead of silently greying out. This keeps all existing primitives (Card, Input, Button, Badge) and the pricing helpers, but reorients the layout toward the 3-second cash transaction.

**Quick wins:**

- Add a confirmation (AlertDialog) before 'Изъятие наличных' cash-out — it currently posts a money-out transaction on a single click
- Add arrow-key navigation + highlighted active row to ProductCombobox results (currently only Enter selects the first match)
- Replace the bare native <select> for payment method with the existing Select primitive so it matches the rest of the form and is touch-friendly
- Replace hardcoded amber/emerald badges (skidka, ostatok, 'Цена 0') with design-system tokens / Badge variants for monochrome consistency
- Drop the line-item table's min-w-[900px] or switch to a compact card layout so the cart stops horizontally scrolling inside the 1fr column

---

## Стол заказов + Готовые заказы — 5/10

**Основная роль / задача:** Флорист (work queue at /orders) собирает букеты по очереди под таймпрессингом у стола; owner/manager работают на /ready-orders для выдачи клиенту, передачи курьеру и закрытия доставки (кассовые операции).

**Маршруты:** /orders, /ready-orders

**Оценка:** Стол заказов — это рабочая очередь флориста, но в списочном виде он не дает главного: визуального приоритета по сроку. Карточки ранжируются по статусу/сроку, однако крупно показанная дата «К сроку» никак не подсвечивается (просрочено/сегодня/будущее) — подсветка срочности живет ТОЛЬКО в календарном виде (orderUrgencyClass), которым флорист пользоваться у стола не будет. Передача статусов работает, но необратимое действие «Букет готов» (списывает склад) визуально равнозначно кнопке «В работу» и не имеет подтверждения, а «Отменить» — деструктивное действие без alert-dialog. Готовые заказы наоборот перегружены цветными бейджами (amber/emerald/red), которые прямо нарушают монохромную дизайн-систему и при этом отсутствуют на соседнем экране /orders — статусная сигнализация между двумя экранами несогласована. Формы доплаты используют сырой HTML select вместо shadcn Select и не имеют валидации суммы. В сумме: функционально работает, но как ежедневный инструмент у прилавка теряет в скорости, приоритизации и предсказуемости опасных действий.

### 🔴 P0 — В списке стола заказов нет визуального приоритета по сроку (просрочено/сегодня)

- **Категория:** `color-visual-signal` · **Объём:** S · **Где:** `src/components/orders/orders-page.tsx:122-129`
- **Проблема:** Карточка работы показывает срок крупно через dateTime(order.dueAt), но не подсвечивает срочность вообще. Функция orderUrgencyClass (border-destructive bg-destructive/5 для просрочки, amber для «сегодня») применяется ИСКЛЮЧИТЕЛЬНО в календарном виде (order-shared.tsx:419, 451-471). В основном списочном виде, которым флорист и пользуется у стола, все карточки выглядят одинаково серыми — просроченный заказ ничем не отличается от заказа на послезавтра. Это прямой риск пропустить дедлайн под нагрузкой.
- **Влияние:** Флорист берет заказы в правильном порядке, перестает пропускать дедлайны.
- **Рекомендация:** Переиспользовать orderUrgencyClass на корневом div WorkOrderCard (orders-page.tsx:122) точно так же, как в OrderCalendarCard. Дополнительно показывать рядом со сроком текстовую метку «Просрочено» / «Сегодня» / «Через N ч» (Badge variant=destructive / outline) — цвет в монохроме читается плохо, нужна и иконка/текст. Время до срока — главный сигнал на этом экране, он должен быть самым заметным.

### 🔴 P0 — «Букет готов» необратимо списывает склад, но не отличается от «В работу» и не требует подтверждения

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/orders/orders-page.tsx:144-159`
- **Проблема:** Кнопки «В работу» и «Букет готов» обе variant=default (одинаковый вес), стоят рядом. При этом markOrderReadyAction необратимо списывает склад (тост «Букет готов, склад списан»), и сама карточка позже честно предупреждает Alert «склад автоматически не восстанавливается» (строки 138-143). То есть опасное действие выполняется одним кликом без подтверждения, легко промахнуться мимо «В работу». «Отменить» (cancelOrderAction) — тоже деструктивно (откат брони/склада), но это всего лишь variant=outline без confirm.
- **Влияние:** Меньше ошибочных списаний склада и случайных отмен — это деньги и пересборки.
- **Рекомендация:** 1) Сделать визуальную иерархию: основное действие по текущему статусу — primary, второстепенные — variant=outline/ghost. Для «Новый» главная кнопка «В работу», «Букет готов» вторична; для «В работе» — наоборот. 2) Обернуть «Букет готов» и «Отменить» в AlertDialog (primitive уже есть в ui/alert-dialog) с текстом про необратимое списание/возврат склада. 3) Для «Отменить» использовать variant=destructive, а не outline.

### 🟠 P1 — Готовые заказы используют цветные бейджи вне дизайн-системы; статусная сигнализация несогласована с /orders

- **Категория:** `consistency` · **Объём:** M · **Где:** `src/components/orders/ready-orders-page.tsx:82,176-192; src/components/orders/order-shared.tsx:575-585`
- **Проблема:** ReadyOrdersPage и ReadyStatusBadge активно используют сырые tailwind-цвета (bg-amber-100/emerald-100/red-100) для статуса и баланса, в то время как тема в globals.css полностью монохромна и для статусов в остальном приложении должны использоваться токены. На соседнем экране /orders статус показывается монохромным OrderBadge (variant=outline) вообще без этих цветов. Итог: «Готов» на одном экране зелёный бейдж, на другом — серый outline; пользователь видит два разных языка статусов для одного и того же заказа. Эти цвета также не происходят из токенов темы и сломаются при любой смене палитры.
- **Влияние:** Единый, считываемый язык статусов между рабочей очередью и выдачей; устойчивость к теме.
- **Рекомендация:** Свести статус-бейджи к одному набору на обоих экранах. Если решено использовать цвет как сигнал — вынести семантические токены (--status-ready / --status-overdue / --balance-due) в globals.css @theme и применять их и на /orders, и на /ready-orders; OrderBadge и ReadyStatusBadge должны давать одинаковый вид для одинакового статуса. Минимум — добавить иконку к каждому статусу, чтобы он читался без опоры на цвет.

### 🟠 P1 — Формы доплаты используют сырой <select> вместо shadcn Select — неконсистентно и мелкий таргет

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/orders/ready-orders-page.tsx:244-256,338-349`
- **Проблема:** Поля «Оплата»/«Способ оплаты» в инлайн-форме выдачи и в CourierSheet — нативный <select class="h-8 ...">, тогда как во всём приложении используется компонент Select на @base-ui. Это даёт другой вид, другой фокус-стиль, и высота h-8 (~32px) — маленький таргет для тача на планшете у прилавка. Поля «Доплата»/«Сумма» — type=number с defaultValue={balance}, но без min/валидации: можно отправить отрицательную или 0, ошибка вернётся только тостом из экшена.
- **Влияние:** Единый ввод, удобнее на планшете, меньше ошибочных платежей.
- **Рекомендация:** Заменить оба <select> на shadcn Select (как в OrderToolbar). Поднять высоту контролов до стандартных 36-40px для тача. На number-инпуты добавить min=0 и (если бизнес-логика позволяет) max=balance с инлайн-подсказкой остатка. Поскольку paymentMethodOptions уже импортируются — это прямой свап.

### 🟠 P1 — Нет связи карточки заказа с его источником (сделка/редактирование) — флорист не может уточнить детали

- **Категория:** `navigation` · **Объём:** M · **Где:** `src/components/orders/orders-page.tsx:108-163; src/components/orders/ready-orders-page.tsx:146-279`
- **Проблема:** Заказ имеет dealId, customerId, source, но карточка не даёт перейти к сделке/клиенту или открыть полную карточку заказа. Если в составе непонятен букет, нет фото-референса (showcase), или клиент звонит уточнить — флористу/менеджеру некуда кликнуть. order.source («WhatsApp»/«Сайт»/«Телефон») вообще не отображается, хотя помогает понять контекст и срочность.
- **Влияние:** Меньше переключений и звонков-уточнений, быстрее сборка.
- **Рекомендация:** Добавить на карточку ненавязчивую ссылку «Открыть сделку» (Link на /deals/{dealId}) когда dealId есть, и показать source бейджем (sourceLabel уже есть в labels.ts). Состав букета (OrderComposition) уже тянет ProductThumbnail — стоит явно показывать комментарий-референс если он есть в note.

### 🟡 P2 — Пустое состояние стола заказов не отличает «нет заказов» от «нет смены/нет доступа»

- **Категория:** `feedback-states` · **Объём:** S · **Где:** `src/components/orders/orders-page.tsx:70-76`
- **Проблема:** Empty показывает «Заказов для флористов нет / Новые заказы появятся после создания на кассе». Но флорист видит этот экран и когда у него нет открытой ночной смены (canUseCash зависит от смены), и в норме. Сообщение не объясняет, нужно ли что-то сделать (открыть смену), и не даёт действия. Также нет skeleton-состояния при router.refresh из 5-сек поллинга — при обновлении карточки просто перерисовываются.
- **Влияние:** Меньше растерянности в начале смены, понятный следующий шаг.
- **Рекомендация:** В пустом состоянии, если у роли нет открытой смены, показать подсказку/кнопку перехода к сменам (EmptyDescription + Button). Рассмотреть лёгкий skeleton (ui/skeleton) на время первичной загрузки, чтобы обновления не выглядели как мигание.

### 🟡 P2 — Бейдж «N ожидают действия» — единственный счётчик, не кликабелен и не объясняет, какие именно

- **Категория:** `feedback-states` · **Объём:** S · **Где:** `src/components/orders/ready-orders-page.tsx:82-84`
- **Проблема:** actionCount = заказы со статусом «Готов». Бейдж amber статичный, не фильтрует, не скроллит к ним. При нескольких десятках карточек в сетке 3 колонки непонятно, какие именно «ожидают действия» — те, что «Передан курьеру», тоже визуально присутствуют и конкурируют за внимание.
- **Влияние:** Менеджер сразу видит и работает только с тем, что требует действия.
- **Рекомендация:** Сделать счётчик частью фильтра: Tabs «Ожидают действия (N) / Передан курьеру / Все», по умолчанию «Ожидают действия». Тогда число и список синхронны. Сам цвет привести к токену из дизайн-системы (см. находку про цвета).

### 🟡 P2 — Inline-кнопки управления заказом без индивидуального pending — блокируется вся доска

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/orders/orders-page.tsx:42-54,146-158; src/components/orders/ready-orders-page.tsx:62-75,260-273`
- **Проблема:** isPending — один общий useTransition на всю страницу. При клике по «Букет готов» в одной карточке disabled становятся ВСЕ кнопки во всех карточках, при этом нет точечного спиннера на нажатой кнопке. Под нагрузкой (десятки карточек) это читается как «всё зависло», и непонятно, какое действие выполняется.
- **Влияние:** Понятная обратная связь, ощущение отзывчивости очереди.
- **Рекомендация:** Показывать спиннер/состояние загрузки на конкретной нажатой кнопке (хранить id заказа в работе) — Button поддерживает контент со Spinner/иконкой. Либо хотя бы оставить остальные карточки активными, дизейблить только обрабатываемую.

### 🟡 P2 — Карточка готового заказа перегружена тремя блоками цифр — действие тонет внизу

- **Категория:** `information-architecture` · **Объём:** M · **Где:** `src/components/orders/ready-orders-page.tsx:195-275`
- **Проблема:** ReadyOrderCard рендерит подряд: блок контактов, блок «До скидки/Скидка/Итого/Оплачено/Остаток» (5 значений), блок «Доставка/Курьеру/Выплата» (3 значения), состав, и только потом действие. При выдаче у прилавка главное — кто клиент, что отдать, сколько доплатить и какая кнопка. Полная финансовая разбивка (до скидки/скидка) здесь избыточна — это деталь для сделки, а не для момента выдачи. В сетке 3 колонки (xl:grid-cols-3) карточка получается очень высокой и требует скролла к кнопке.
- **Влияние:** Быстрее выдача, меньше скролла и шума на главном моменте.
- **Рекомендация:** Сократить карточку до сути: клиент + телефон, тип/адрес, срок/готов, остаток к доплате (крупно), состав, действие. Полную финансовую разбивку убрать под раскрытие (Collapsible/«Подробнее») или оставить только в CourierSheet, где она уже есть. Действие закрепить визуально (граница сверху уже есть — усилить).

### 🟡 P2 — Нет фильтра по статусу/срочности на столе заказов — только сортировка и ручной просмотр

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/orders/orders-page.tsx:37-40,60-67`
- **Проблема:** OrderToolbar даёт только сортировку (3 режима) и переключатель список/календарь. Фильтра нет. При наборе заказов флорист не может быстро сказать «покажи только на сегодня» или «только В работе». Все «Новый/В работе/Готов» свалены в одну двухколоночную сетку; «Готов» уже собранные смешаны с тем, что ещё надо делать.
- **Влияние:** Быстрее находить, что собирать дальше, особенно при большом наборе.
- **Рекомендация:** Добавить в OrderToolbar Tabs-фильтр по статусу (Все / Новые / В работе / Готовые) и/или быстрый чип «Сегодня». Альтернатива (см. redesignProposal) — kanban-колонки по статусу, которые сами выполняют роль фильтра и делают очередь самоочевидной.

### ⚪ P3 — Кнопки переключения недели в календаре подписаны одинаково «Неделя» — неоднозначно

- **Категория:** `content-copy` · **Объём:** S · **Где:** `src/components/orders/order-shared.tsx:340-347`
- **Проблема:** Кнопки «предыдущая/следующая неделя» обе имеют текст «Неделя», различаясь только иконкой стрелки слева/справа. Для скринридера и при беглом взгляде это две одинаковые кнопки «Неделя». Нет aria-label.
- **Влияние:** Понятнее навигация по неделям, лучше a11y.
- **Рекомендация:** Дать осмысленные подписи/aria-label: «Пред. неделя» и «След. неделя» (или aria-label при иконочном виде). Это согласует с тем, что кнопка «Сегодня» подписана явно.

### ⚪ P3 — Кнопка «К списку» в календаре сбрасывает весь вид, а не открывает конкретный заказ

- **Категория:** `navigation` · **Объём:** S · **Где:** `src/components/orders/order-shared.tsx:444-446; orders-page.tsx:85; ready-orders-page.tsx:108`
- **Проблема:** OrderCalendarCard принимает onOpenOrder(order), но обе страницы передают onOpenOrder={() => setViewMode('list')} — то есть просто переключают на список, игнорируя сам заказ. Пользователь, кликнувший конкретную карточку в календаре, оказывается в начале списка и должен искать тот же заказ заново. Подпись «К списку» при этом маскирует, что заказ не открывается.
- **Влияние:** Снимает ложное ожидание и лишнюю навигацию.
- **Рекомендация:** Либо честно убрать параметр order и переименовать кнопку в «К списку» (если открытие не предусмотрено), либо реализовать переход к конкретной карточке (scrollIntoView + подсветка по order.id). Сейчас сигнатура обещает открытие заказа, а реализация — нет.

> **Предложение по редизайну:** Стол заказов (/orders) стоит переделать из «двухколоночной сетки вперемешку» в kanban-доску по статусу — это естественная модель рабочей очереди и сама выполняет роль фильтра. Три колонки: «Новые» → «В работе» → «Готов», каждая со счётчиком в заголовке. Внутри колонки карточки сортируются по сроку с обязательной подсветкой срочности (переиспользовать orderUrgencyClass + текстовая метка «Просрочено/Сегодня/через N ч»). Карточка минималистична: номер, КРУПНО срок с цветом срочности, клиент, тип доставки, источник (бейдж), состав (OrderComposition compact). Действие на карточке — одно главное по текущему статусу (primary), остальные под dropdown-menu (ui/dropdown-menu): «В работу» в колонке Новые, «Букет готов» (с AlertDialog-подтверждением про списание склада) в колонке В работе. «Отменить» — всегда во вторичном меню, variant=destructive с подтверждением. Календарный вид остаётся как альтернативный режим для планирования. Для /ready-orders радикальный редизайн не нужен — достаточно: (1) фильтр-Tabs «Ожидают действия / Передан курьеру / Все», (2) сжать карточку до сути (клиент, остаток крупно, состав, действие), спрятав полную финансовую разбивку под «Подробнее», (3) свести цветовые бейджи к токенам дизайн-системы, общим с /orders.

**Quick wins:**

- Применить orderUrgencyClass к карточкам списочного вида стола заказов (orders-page.tsx:122) и добавить текстовую метку Просрочено/Сегодня рядом со сроком
- Обернуть «Букет готов» и «Отменить» в AlertDialog и сделать «Отменить» variant=destructive
- Заменить сырые <select> в формах доплаты на shadcn Select и добавить min=0 на number-инпуты
- Дать кнопкам недели в календаре подписи «Пред. неделя»/«След. неделя» (aria-label)
- Превратить бейдж «N ожидают действия» в Tabs-фильтр по статусу на /ready-orders

---

## Сделки (CRM воронка + карточка сделки) — 5/10

**Основная роль / задача:** Manager (Менеджер) progressing inbound deals from chat → composition → payment → order, day-to-day; owner oversees the pipeline. Florists are blocked from this module entirely.

**Маршруты:** /deals, /deals/[id]

**Оценка:** The deals module has a solid technical foundation — a clean dnd-kit kanban, an auto-saving deal card with optimistic edits, and a well-instrumented Wazzup chat frame with helpful diagnostics. But it is undermined by one severe defect and several structural IA problems. The single most damaging issue: dragging a card between kanban columns does NOT persist — `moveDealToStage` only sets local optimistic state and the wired `updateDealStageAction` is never called, so every drag silently reverts on the next 5s poll (data loss / trust killer for the manager's core pipeline action). The deal card itself is a 2171-line component that crams the Wazzup chat, client/deal fields, line items, payment, order creation and bouquet sending into a 4-tab right rail next to a chat iframe — information density is high and the most important workflow actions (advance stage, accept payment, create order) are buried inside tabs with no persistent action bar. As expected from the all-gray theme, status legibility leans on a handful of inconsistent ad-hoc colors (amber/emerald/sky/red) that violate the monochrome+single-destructive design system and are applied unevenly. Overall the module works for editing a single deal but fails the fast, confident pipeline-progression workflow a counter manager needs.

### 🔴 P0 — Drag-to-move on the kanban is a no-op — stage changes silently revert

- **Категория:** `feedback-states` · **Объём:** S · **Где:** `src/components/deals/deals-kanban.tsx:156-171`
- **Проблема:** moveDealToStage only writes to local optimisticStages state and never calls a server action — the comment at line 161 admits 'UI-only movement for now'. Meanwhile updateDealStageAction (actions.ts:523) and updateDealStage (crm.ts:545) are fully implemented but unused/unimported here. The manager drags a card to a new column, sees it land (optimistic), then DealsAutoRefresh polls every 5s and router.refresh() reverts the card to its real stage. The core daily pipeline action appears to work but loses the change with no error.
- **Влияние:** Eliminates silent data loss on the single most-used pipeline gesture; restores trust that drag actually moves a deal.
- **Рекомендация:** Import updateDealStageAction and call it inside handleDragEnd/moveDealToStage via the existing run() transition helper; on failure roll back optimisticStages and toast.error. Keep the optimistic update so the move feels instant, but reconcile with the server result (and don't clear optimistic state until the refresh reflects it).

### 🟠 P1 — Kanban card hides the due date and gives overdue deals almost no visual weight

- **Категория:** `color-visual-signal` · **Объём:** M · **Где:** `src/components/deals/deals-kanban.tsx:560-575, 654-670`
- **Проблема:** The card's due/overdue info is the third row in a low-contrast gray key/value grid, and an overdue deal only gets a single amber-colored 'Просрочено: dd.mm hh:mm' word competing with everything else. At a glance across 5+ columns a manager cannot spot which deals are overdue or due today. The most time-critical signal for a flower shop (delivery deadline) is the least prominent element on the card.
- **Влияние:** Lets a manager scan the board for at-risk deliveries instantly — directly reduces missed deadlines.
- **Рекомендация:** Elevate due date to a small pill at the top of the card; give overdue/due-today a distinct, systematic treatment (e.g. destructive-bordered badge for overdue, bold for today). Consider sorting/anchoring overdue cards to the top of each column.

### 🟠 P1 — Ad-hoc status colors violate the monochrome design system and are applied inconsistently

- **Категория:** `color-visual-signal` · **Объём:** M · **Где:** `src/components/deals/deal-detail-page.tsx:853, 1256-1277, 1446-1453, 1487-1494, 1506-1517, 1919-1932; src/components/deals/deals-kanban.tsx:570`
- **Проблема:** The theme is fully monochrome with a single --destructive red, yet the deal card sprinkles hardcoded amber (skidka/shift warning/overdue/missing-components/order-balance), emerald (customer discount, 'Оплачено'), sky (active order), and red (cancelled order) Tailwind utilities. SummaryBox uses text-amber-800 for any 'strong' value (line 1932) so a normal Остаток renders amber even when it's a routine total. Kanban only marks overdue with a single amber word (line 570). The result is unsystematic color that won't survive a theme change and gives uneven, sometimes misleading urgency signals.
- **Влияние:** Restores at-a-glance, consistent status legibility and aligns the busiest module with the documented monochrome system.
- **Рекомендация:** Either (a) route all of these through Badge/Alert variants and monochrome emphasis (font weight, borders, the single --destructive) per the design system, or (b) formalize a tiny semantic token set (warning/success/info) in globals.css and use it consistently across kanban + card. Stop using amber as a generic 'this number is bold' style.

### 🟠 P1 — Deal card is a 2171-line monolith — unmaintainable and IA-opaque

- **Категория:** `information-architecture` · **Объём:** L · **Где:** `src/components/deals/deal-detail-page.tsx:127-1875`
- **Проблема:** A single client component holds ~15 useState/useRef hooks, the debounced field-save and per-item-save chains, two large dialogs, four tab panes, and all helper rendering. Cards for Клиент, Детали, Состав, Скидка, Оплата, Заказ, Букеты are all rendered together and merely hidden via `activeTab !== 'x' && 'hidden'` (e.g. lines 799, 863, 1013, 1219, 1317, 1363, 1432, 1478, 1575) rather than conditionally mounted, so every tab's DOM and the heavy save machinery live in one tree. This makes the information architecture hard to reason about and the file hard to change safely.
- **Влияние:** Makes the card's IA legible, reduces re-render/DOM cost, and unblocks safe iteration on the manager's most complex screen.
- **Рекомендация:** Decompose into DealHeader, ClientCard, DealFieldsCard, CompositionPane, PaymentPane, BouquetsPane, PaymentDialog, CreateOrderDialog (separate files under components/deals/). Lift the save-orchestration into a useDealAutosave hook. Mount panes per active tab instead of hiding with CSS to cut DOM weight. See redesignProposal.

### 🟠 P1 — Horizontal-scrolling kanban with drag-only moves is painful on tablet and at the counter

- **Категория:** `responsive-touch` · **Объём:** M · **Где:** `src/components/deals/deals-kanban.tsx:250-296, 461`
- **Проблема:** Columns are fixed-width (300px / clamped ~292-360px) inside a horizontally scrolling board, and the only way to change stage is to drag a card across columns. On a tablet this means dragging a card while the board itself needs to scroll horizontally — an awkward, error-prone gesture — and there is no non-drag fallback (no per-card stage menu). Cards are also wrapped in an <a> with pointer listeners, so distinguishing a tap-to-open from a drag is fragile on touch.
- **Влияние:** Makes pipeline moves reliable on the tablets used in-shop, not just desktop with a mouse.
- **Рекомендация:** Add a lightweight per-card stage control (DropdownMenu 'Переместить в…') as a touch-friendly alternative to dragging, and verify the 8px PointerSensor activation distance plays well with the link tap target on touch. Consider a column overflow menu for far-away stages.

### 🟠 P1 — Money & order actions are buried inside the Оплата tab — no persistent action zone

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/deals/deal-detail-page.tsx:758-792, 1455-1463, 1534-1542`
- **Проблема:** The two highest-value actions a manager performs — Принять оплату and Создать заказ — live only inside the 'Оплата' tab. While editing composition or chatting, the manager cannot accept a payment or create an order without first switching tabs. There is no always-visible primary action area; the only persistent control is the four-way TabsList. The 'Остаток' hint badge on the payment tab is even hidden below sm (line 779).
- **Влияние:** Cuts clicks to close a deal and keeps the money path visible at all times — the core throughput action at the counter.
- **Рекомендация:** Add a sticky DealHeader action bar (see redesignProposal) with Принять оплату and Создать заказ buttons whose disabled state shows a reason (e.g. 'нет товаров', 'смена не открыта', 'есть активный заказ') via tooltip. Reuse existing Button + Tooltip primitives.

### 🟠 P1 — Stage progression on the card requires opening a Select buried in 'Детали'

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/deals/deal-detail-page.tsx:882-901`
- **Проблема:** On the deal card, advancing the deal's stage (the pipeline's whole point) is a plain Select inside the 'Детали сделки' card under the Обзор tab, visually identical to Источник/Ответственный. There's no sense of pipeline position or 'next step', and no quick 'move forward' affordance. The kanban card computes a helpful getNextAction() label (kanban.tsx:611) but the detail card surfaces no such guidance.
- **Влияние:** Makes pipeline progression a first-class, fast action instead of a generic field edit.
- **Рекомендация:** Promote stage to a horizontal stage-stepper or a prominent inline control in the sticky header showing current position and a one-tap 'next stage' button. Optionally surface the same getNextAction hint on the card.

### 🟡 P2 — Wazzup diagnostics checklist is over-exposed to non-technical managers

- **Категория:** `content-copy` · **Объём:** S · **Где:** `src/components/deals/wazzup-deal-frame.tsx:195-227, 161-172`
- **Проблема:** When no chat is available, the empty state shows a 5-row technical checklist (Webhook URL настроен, Интеграция включена, Последний webhook timestamp/status, chatId, etc.) plus raw English-tinged error strings ('Пользователь CRM не синхронизирован с Wazzup'). For a manager this reads as developer debug output rather than an actionable next step; the actually useful guidance ('Добавьте телефон клиента или дождитесь входящего сообщения') is below the noise.
- **Влияние:** Turns a confusing debug panel into a clear next-step for the manager while preserving diagnostics for admins.
- **Рекомендация:** Lead with the one actionable sentence and the 'Проверить чат по клиенту' button; collapse the diagnostic checklist behind a 'Подробнее для администратора' disclosure (e.g. a details/accordion), or gate it to owner role. Soften error microcopy to plain Russian guidance.

### 🟡 P2 — Kanban has no global loading/empty/error state and no manual refresh affordance

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/deals/deals-kanban.tsx:204-296; src/components/deals/deals-auto-refresh.tsx:1-70`
- **Проблема:** There is no board-level empty state (only per-column 'Сделок нет / Перетащите сделку сюда', which is misleading since dragging doesn't persist — see P0). Auto-refresh is invisible: the user gets no indication the board is polling or that new deals arrived, and there's no manual refresh button. If a deal is dropped between columns and reverts, the only feedback is the silent revert. Filters (responsible/source) also have no 'reset' affordance or active-filter indication when results are empty.
- **Влияние:** Clear feedback that the board is live and why it's empty; less confusion under the silent-revert and filtered-empty cases.
- **Рекомендация:** Add a board-level Empty when no stages/deals exist; show a subtle 'обновлено / новые сделки' indicator when the poll detects changes (reuse the count it already fetches); add a 'Сбросить фильтры' link when filtered results are empty. Fix the per-column empty copy once drag persists.

### 🟡 P2 — Destructive item/group removal has no confirmation

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/deals/deal-detail-page.tsx:1093-1102, 1197-1206, 572-613`
- **Проблема:** The destructive trash buttons for a single line item and for a whole bouquet group call removeItem/removeGroup immediately on click with optimistic removal and no AlertDialog confirmation. Removing a bouquet group deletes several lines at once. A mis-tap at a busy counter silently wipes composition (and the change persists server-side).
- **Влияние:** Prevents accidental loss of order composition during fast counter work.
- **Рекомендация:** Wrap group removal (and ideally single-item removal) in the existing AlertDialog primitive with a brief 'Удалить букет «name» из состава?' confirmation. Single items could alternatively offer an undo toast instead of a dialog.

### 🟡 P2 — Create-deal dialog: weak input ergonomics for phone, delivery type, and date

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/deals/deals-kanban.tsx:330-336, 405-418, 379-385`
- **Проблема:** The 'Телефон' input is a plain Input with no type=tel/inputMode=tel (line 333). 'Получение' is a free-text Input with placeholder 'pickup / delivery' (line 409) — a raw English enum hint in an otherwise Russian UI, with no validation, while the deal card uses the same freetext field too (deal-detail-page.tsx:967). Date is datetime-local with no default. There is also no inline validation or required-field indication — the form just succeeds or toasts an error from the server.
- **Влияние:** Faster, less error-prone deal creation; removes a confusing English enum from a Russian form.
- **Рекомендация:** Use inputMode='tel' for phone fields; replace the 'Получение' freetext with the existing Select (Самовывоз/Доставка) used in the order dialog (deliveryOptions); show the address field only when Доставка. Add minimal inline required hints via FieldDescription.

### 🟡 P2 — Composition table overflows on tablet/narrow widths (min-width 620px) with cramped controls

- **Категория:** `responsive-touch` · **Объём:** M · **Где:** `src/components/deals/deal-detail-page.tsx:1029-1211`
- **Проблема:** The Состав table forces min-w-[620px] inside the already-narrow right rail (minmax(420px,520px) on xl), guaranteeing horizontal scroll. Each row packs a qty Input (w-16), price Input (w-24), a discount Select (w-28) + value Input (w-20), total, and a delete icon — controls are ~h-8 with little spacing, hard to hit on touch and visually dense. On a tablet the manager scrolls the inner table horizontally while also scrolling the rail.
- **Влияние:** Makes editing line items usable on tablet without nested horizontal scrolling.
- **Рекомендация:** For narrow widths, render line items as stacked cards (name + a row of qty/price/discount controls) instead of a wide table, or move composition to a full-width modal/sheet for editing. Increase control height/tap targets. Reuse the Card/Field primitives already in the file.

### ⚪ P3 — Two redundant 'Скидка клиента N%' badges and a confusing customer-discount auto-apply

- **Категория:** `consistency` · **Объём:** S · **Где:** `src/components/deals/deal-detail-page.tsx:852-856, 1369-1373, 341-361`
- **Проблема:** The customer's default discount is shown as an emerald badge both under the Клиент card (line 853) and again on the 'Скидка на чек' card (line 1370), with slightly different conditions (selectedCustomer.defaultDiscountPercent vs hasAppliedCustomerDiscount). Selecting a customer silently overwrites the deal discount to the customer's percent only if current discount is none/zero (handleCustomerChange) — but this auto-apply happens with no toast or explanation, so a manager may not realize the check discount changed.
- **Влияние:** Removes duplicate signal and makes an automatic money-affecting change transparent.
- **Рекомендация:** Show the customer-discount badge once (on the Скидка card) and toast 'Применена скидка клиента N%' when auto-applied so the change is visible and reversible.

### ⚪ P3 — Auto-save 'Сохранено' indicator is the only edit feedback and is easy to miss; no failed-save recovery prompt

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/deals/deal-detail-page.tsx:754, 1877-1896, 389-413`
- **Проблема:** All deal-field and line-item edits are debounced auto-saves (650ms) whose only feedback is a small SaveIndicator badge in the card header (Сохраняем…/Сохранено/Ошибка сохранения). On error the badge turns red with a truncated message but there's no toast and no retry button, and the failed value stays in the field — a manager could navigate away believing changes saved. The merged status also means a single item error masks which field failed.
- **Влияние:** Prevents silent loss of edited deal fields and gives managers a recovery path.
- **Рекомендация:** On save error, fire a toast.error in addition to the badge and offer a 'Повторить' affordance; consider a beforeunload guard when fieldDirtyRef/itemDirtyRef is true. Make the error message point at what failed.

> **Предложение по редизайну:** The deal card (deal-detail-page.tsx, 2171 lines) should be decomposed and re-laid-out around the manager's actual flow rather than a generic tab dump. Concretely: (1) Extract a sticky DealHeader that always shows title, number, stage as an inline editable Select or a horizontal stage-stepper (so 'продвинуть этап' is a one-click action visible at all times), the SaveIndicator, and a primary action zone with Принять оплату + Создать заказ buttons whose enabled/disabled reasons are shown inline. (2) Keep the two-column shell (chat left, work rail right) but split the 2171-line file into child components: DealHeader, ClientCard, DealFieldsCard, CompositionTab (table + totals + check discount), PaymentTab (summary + accept + order block), BouquetsTab (suggest + history), and the two dialogs (PaymentDialog, CreateOrderDialog) as their own files. This is the most important structural fix — a single 2000-line client component with ~15 useState/useRef hooks and interleaved debounce/save machinery is unmaintainable and makes the IA hard to reason about. (3) Reduce tab count friction: 'Состав' and 'Оплата' are almost always used together when closing a deal — consider merging composition+totals+payment into one scrollable 'Заказ' pane and keeping 'Обзор' (client/fields) and 'Букеты' separate, dropping to 3 tabs. (4) On the kanban, after fixing persistence, add inline quick-actions on hover (e.g. a small menu to change stage without dragging — important for tablet where drag across 5+ columns that scroll horizontally is painful) and make the column header sum + count the scannable anchor it already is.

**Quick wins:**

- Wire the existing updateDealStageAction into the kanban drag handler so column moves actually persist (currently a no-op).
- Replace the ad-hoc amber/emerald/sky/red color usages with monochrome + Badge variants per the design system, or formalize a small status token set.
- Add an overdue/urgent visual treatment to kanban cards beyond a single amber word, and surface the due date prominently.
- Give the kanban 'Новая сделка' dialog phone/number inputs proper type=tel/inputMode and replace the freetext 'pickup / delivery' field with a Select.
- Add a persistent action bar (Принять оплату / Создать заказ) to the deal card so the two money actions aren't hidden behind the Оплата tab.

---

## Клиенты (список + карточка клиента) — 5/10

**Основная роль / задача:** Менеджер (and owner) — finds an existing client by name/phone, checks their order/deal history and discount before/while taking an order, and edits contact details or discount. Used at the desk, sometimes under time pressure.

**Маршруты:** /clients, /clients/[id]

**Оценка:** The Клиенты module is a functional but shallow CRM surface. The list is a single wide table with full-text search over name/phone, and the detail page is a left form-card plus three stacked history tables (deals, orders, sales). It does the basics, but it underdelivers on the manager's core job: quickly understanding "who is this client and what's our relationship?" Key gaps: there are no client-level totals (lifetime spend, outstanding balance) anywhere, no way to sort or filter the list beyond a text query, no contact actions (call/WhatsApp/Instagram) despite Wazzup chat fields existing on the model, and the detail page is dominated by an always-expanded edit form instead of read-first contact info. The module also violates the stated monochrome design system heavily, hard-coding amber/emerald/slate/zinc colors throughout, which makes it visually inconsistent with the rest of the app and means status signals are ad hoc rather than systematic. Search has no debounce/auto-submit affordance, and the 200/page limit is silently capped with no pagination.

### 🟠 P1 — Hard-coded amber/emerald/slate/zinc colors violate the monochrome design system

- **Категория:** `consistency` · **Объём:** S · **Где:** `src/components/clients/customers-page.tsx:77,109,116,120-122; src/components/clients/customer-detail-page.tsx:60,105; src/components/customers/customer-combobox.tsx:112`
- **Проблема:** The module hard-codes brand-ish colors everywhere: amber 'Нет телефона' badge, emerald discount badges, slate stage badge, and bg-zinc-950 buttons — while the project theme is deliberately fully monochrome (chroma=0) with only a single --destructive red. This makes Clients look unlike every other module and means status signals are improvised rather than systematic. The bespoke bg-zinc-950 buttons also bypass the Button default variant used elsewhere.
- **Влияние:** Visual consistency with the rest of the app; status legibility becomes systematic instead of one-off.
- **Рекомендация:** Replace bg-zinc-950 custom buttons with the standard Button default variant. Replace emerald/slate/amber badges with the design-system Badge variants (default/secondary/outline) and the single destructive token for true warnings. If 'Нет телефона' must stand out, use Badge variant=outline with an icon, not amber. Keep color usage to the defined tokens.

### 🟠 P1 — Detail page is dominated by an always-open edit form instead of read-first info

- **Категория:** `information-architecture` · **Объём:** M · **Где:** `src/components/clients/customer-detail-page.tsx:63-75`
- **Проблема:** The left card immediately renders the full editable CustomerFields form (name, phone, instagram, source, discount, comment) plus a duplicate read-only InfoLine block for source/comment right above it. So the same data appears twice (once read-only, once editable), the comment/source are shown twice, and editing is the default mode for a screen that is opened 95% of the time just to look something up. This is a wall of inputs where a summary should be.
- **Влияние:** Faster comprehension on open; eliminates duplicated/conflicting display; consistent edit pattern with create.
- **Рекомендация:** Default to a read view: contact info + stats + comment shown as labelled lines. Move editing behind an 'Редактировать' button that opens the same CustomerFields inside a Dialog (the create flow already uses this exact dialog pattern in customers-page.tsx:150-167), keeping one source of truth. Remove the duplicated InfoLine block.

### 🟠 P1 — Client card shows no lifetime totals or outstanding balance

- **Категория:** `information-architecture` · **Объём:** M · **Где:** `src/components/clients/customer-detail-page.tsx:51-76`
- **Проблема:** The single most useful CRM fact about a client — how much they have spent with us and whether they owe money — is never shown. The header only repeats the phone and a discount badge. A manager has to mentally sum three separate history tables (deals, orders, sales) to answer 'is this a valuable/regular client?' or 'does this client have an unpaid balance?'. The data is already loaded (deals/orders/sales arrays each carry total/paid).
- **Влияние:** Manager instantly sees client value and unpaid balance — the core reason to open a card.
- **Рекомендация:** Add a compact stats strip in the card header or just under it: 'Всего оплачено', 'Открытый остаток' (sum of max(0,total-paid) over active deals+orders), 'Сделок/Заказов/Продаж'. Compute client-side from the already-passed arrays (or extend listCustomerOrders/Sales/listDeals callers). Use the existing Card + a small grid of stat tiles like other modules; render money via formatMoney.

### 🟠 P1 — No contact actions — phone/Instagram/Wazzup are dead text

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/clients/customers-page.tsx:105-114, src/components/clients/customer-detail-page.tsx:58`
- **Проблема:** Phone numbers render as plain text in both list and card; Instagram is collected (Customer.instagram) but never displayed; and the model carries wazzupChatType/wazzupChatId/wazzupChannelId yet there is no 'написать в WhatsApp/открыть чат' affordance. The whole point of a CRM client card in a shop that runs on Wazzup is one-tap messaging. A manager has to copy the number and switch apps.
- **Влияние:** Turns the card into an actionable contact hub instead of a read-only record; removes app-switching at the counter.
- **Рекомендация:** Make phone a tel: link and add an 'Открыть чат' button when wazzupChatId is present (link to the existing Wazzup iframe/deal chat the app already uses). Surface Instagram as a link when present. On the list, add a small icon-button column for call/chat. Reuse Button size=icon + lucide PhoneIcon/MessageCircleIcon.

### 🟠 P1 — List has no sort or filter beyond free-text search

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/clients/customers-page.tsx:88-137`
- **Проблема:** The list is hard-ordered by created_at DESC (crm.ts:179) with no way to sort by activity, name, or discount, and no filter by source or 'has phone' / 'has open balance'. To find the most active clients or all VIP-discount clients, a manager must eyeball the whole table. The activity column shows three count badges but you can't order by them.
- **Влияние:** Finding the right cohort of clients (active, VIP, by channel) becomes a glance instead of a scan.
- **Рекомендация:** Add a Source Select filter (reuse sourceOptions) next to search, and make at least Name / Активность / Скидка / Создан column headers sortable (client-side sort over the 200 rows, or pass sort param to listCustomers). At minimum, default-order by last activity rather than creation date so recently-touched clients surface first.

### 🟡 P2 — Silent 200-row cap with no pagination or 'showing N of M' indicator

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/clients/customers-page.tsx:76; src/lib/crm.ts:180`
- **Проблема:** listCustomers hard-LIMITs to 200 rows, and the badge says e.g. '200 в списке' which a user will read as 'we have 200 clients total' even when there are more. There is no pagination, no 'показано 200 из …', and clients beyond 200 are simply unreachable except via search. As the base grows this silently hides data.
- **Влияние:** Users trust the count and know when results are truncated.
- **Рекомендация:** Either add pagination/'load more', or compute the true COUNT and show 'Показано 200 из 350 — уточните поиск'. Make the badge label unambiguous (e.g. 'найдено N' when a search is active vs total). Lowest-effort fix: surface the total count and a hint to refine search.

### 🟡 P2 — Edit form lacks inline validation, phone formatting, and confirmation feedback specifics

- **Категория:** `forms-input` · **Объём:** M · **Где:** `src/components/clients/customers-page.tsx:172-245`
- **Проблема:** CustomerFields is a plain field stack: phone is a free-text Input with no mask/normalization hint (the backend normalizes, but the user gets no guidance or format example), the discount number input has no inline reason when out of range, and there's no 'Имя обязательно' inline error — only a post-submit toast. The 'Источник' Select uses an empty-string value item ('Не указан', value="") which is a known fragile pattern with some Select implementations.
- **Влияние:** Fewer malformed entries (especially phone) and clearer correction path.
- **Рекомендация:** Add a placeholder/format hint to phone (e.g. '+7 …') and consider an input mask; rely on the Field primitive's error slot for inline validation; give the discount field a helper note ('0–100%'). Verify the empty-string SelectItem actually clears the value with @base-ui Select, or use a sentinel value mapped to '' in the action.

### 🟡 P2 — Search requires manual Enter and gives no pending/clear feedback

- **Категория:** `forms-input` · **Объём:** M · **Где:** `src/components/clients/customers-page.tsx:71-74`
- **Проблема:** Search is a bare GET form on /clients with no submit button shown, no debounced auto-submit, no loading indicator while the server re-renders, and no clear (X) button to reset the query. A counter user typing a name doesn't get results until they press Enter, with no signal that a search happened, and clearing requires manually deleting text and pressing Enter again.
- **Влияние:** Search feels responsive and obviously interactive; faster lookup, fewer 'did it work?' moments.
- **Рекомендация:** Add a debounced auto-submit (e.g. router.push on change after ~300ms) or at least a visible submit button, a clear (X) button when search is non-empty (reuse the XIcon pattern from the combobox), and reflect useTransition pending state on the input/list. Keep defaultValue so the field stays populated.

### 🟡 P2 — Three stacked full history tables bury the relevant rows; no recency limit or links

- **Категория:** `information-architecture` · **Объём:** M · **Где:** `src/components/clients/customer-detail-page.tsx:79-228`
- **Проблема:** Deals, Orders, and Sales each render as a full table with no cap and no sort guarantee, stacked vertically. For a regular client this is a very long scroll, and the most recent activity (what a manager usually wants) may be anywhere. There's also no way to filter to 'unpaid' or 'open'. The Sales table has no link to the underlying sale/receipt, unlike deals/orders which link out.
- **Влияние:** Recent, relevant history is visible without scrolling; matches the manager's actual lookup pattern.
- **Рекомендация:** Either (a) put the three histories in Tabs (the app ships a Tabs primitive) with counts in the labels, or (b) keep them stacked but cap to the latest ~5 with a 'показать все' expander and ensure each is ordered newest-first. Add a deep link from each sale row to its receipt/history entry for parity.

### 🟡 P2 — List table forces horizontal scroll on tablet (min-w-[900px], 8 columns)

- **Категория:** `responsive-touch` · **Объём:** M · **Где:** `src/components/clients/customers-page.tsx:87-88`
- **Проблема:** The table is min-w-[900px] with 8 columns inside overflow-x-auto. On a tablet at the counter (a stated use case) the user must scroll horizontally to reach the 'Открыть' action and the activity badges, and the comment column (max-w-72) eats width. Touch targets in the activity cell are tiny stacked badges.
- **Влияние:** Usable client lookup on tablet without horizontal scrolling.
- **Рекомендация:** For narrow widths, collapse to a card/list layout (name + phone + discount + activity counts + Открыть as a tappable row) or drop low-value columns (Источник, Комментарий) into the row's secondary line. Make the whole row navigate to the client (clickable TableRow) so 'Открыть' isn't a scroll-to target.

### ⚪ P3 — Mixed locale date formats across list vs card

- **Категория:** `consistency` · **Объём:** S · **Где:** `src/components/clients/customers-page.tsx:247-257; src/components/clients/customer-detail-page.tsx:243-260`
- **Проблема:** The list formats dates as dd.mm.yyyy (formatDate) while the detail tables use dd.mm.yy hh:mm (dateOnly). Two near-identical date helpers diverge in year width and time, so the same client's 'Создан' looks different between list and card.
- **Влияние:** Consistent, predictable dates; one helper to maintain.
- **Рекомендация:** Extract a single shared date formatter (or two named ones: dateShort vs dateTime) and use consistently. Decide whether the list needs time (probably not) and the history needs full year (probably yes) and standardize.

### ⚪ P3 — 'Активность' counts aren't linked or contextual (e.g. open vs done)

- **Категория:** `information-architecture` · **Объём:** M · **Где:** `src/components/clients/customers-page.tsx:118-123`
- **Проблема:** The activity column shows raw totals ('3 сделок / 1 заказов / 12 продаж') with no distinction between open and closed, and the grammatical forms aren't pluralized ('1 заказов'). The numbers can't be acted on. A manager can't tell at a glance whether a client has anything in progress right now.
- **Влияние:** The list answers 'who needs attention now?' at a glance with correct grammar.
- **Рекомендация:** Show at least one actionable signal — e.g. an 'открытых: N' badge when the client has active deals/orders (use the activeDealOrderStatuses helper noted in CLAUDE.md), and apply Russian plural forms (сделка/сделки/сделок). Consider linking counts to the filtered deals/orders views.

### ⚪ P3 — Whole row not clickable; 'Открыть' is an extra precise target

- **Категория:** `workflow-efficiency` · **Объём:** S · **Где:** `src/components/clients/customers-page.tsx:103-133`
- **Проблема:** Opening a client requires clicking the small right-aligned 'Открыть' button in the last column. The row itself isn't a link, so on a wide table (and on touch) the user has to aim for one small target at the far right.
- **Влияние:** Faster, larger hit target for the most common action.
- **Рекомендация:** Make the row navigable (wrap name cell in the Link and/or add onClick to TableRow with role/keyboard support), keeping the explicit 'Открыть' as a secondary affordance. This is the standard pattern in list-to-detail flows.

> **Предложение по редизайну:** Detail page redesign (the list is fine with the per-finding tweaks; the card needs restructuring): Switch the left card from edit-by-default to read-by-default. Header: client name as title, phone as a tel: link, source + discount badge, and an 'Открыть чат' button when a Wazzup chat exists. Directly under the header, a 4-tile stat strip computed from the already-loaded arrays: Всего оплачено, Открытый остаток, Кол-во заказов/сделок, Последняя активность (max date across histories). Comment shown as a labelled block. A single 'Редактировать' button opens CustomerFields inside the same Dialog the create flow already uses (one form, one source of truth — eliminates the duplicated InfoLine + form). Right column: replace the three always-expanded stacked tables with a Tabs control (Сделки N / Заказы N / Продажи N) using the existing Tabs primitive, each tab ordered newest-first and capped to the latest 5 with a 'показать все' expander, and add a deep link from sale rows to their receipt for parity with deals/orders. This puts the manager's two real questions — 'who is this and what do they owe / how valuable are they' and 'what happened most recently' — above the fold, and demotes editing to an explicit action.

**Quick wins:**

- Replace hard-coded amber/emerald/slate badges and bg-zinc-950 buttons with the standard Badge variants and Button default variant to match the monochrome design system (customers-page.tsx:77,109,116; customer-detail-page.tsx:60,105).
- Remove the duplicated read-only Source/Comment InfoLine block on the detail card — it repeats the editable form fields directly below it (customer-detail-page.tsx:64-67).
- Add a clear (X) button to the search input and make phone numbers tel: links in both list and card.
- Unify the two divergent date formatters into one shared helper.
- Surface the true total count vs the 200-row cap so '200 в списке' isn't misread as the full client base.

---

## Букеты (шаблоны) — 5/10

**Основная роль / задача:** Manager/owner curating the bouquet template catalog (names, photos, composition from warehouse stock, price). Florists do not access this page (owner/manager only) — they consume templates indirectly via the product/bouquet combobox when sending offers or building deals.

**Маршруты:** /bouquets

**Оценка:** This is positioned as a visual catalog of bouquet templates, but the implementation is a dense, horizontally-scrolling data table with 48px thumbnails — the photos that are the entire point of the module are demoted to icon-sized cells. The core flows (create/edit a template, compose from stock products, price it, attach a photo) work and have thoughtful touches (stock-shortage warnings, availability badges, image-error fallbacks), but they suffer from a two-step save-then-upload photo flow that blocks attaching a photo at creation time, zero cost/margin guidance when setting a price, and a wall-of-fields Sheet with nested scrolling. The all-gray theme is broken (intentionally) by amber/emerald status colors that actually improve legibility but are inconsistent with the rest of the system. There is no search, filter, or sort on the catalog despite it being the primary way a manager picks a template, and the bouquet selection that managers actually use lives in a separate combobox, not here. A grid/gallery redesign plus a single-pass create-with-photo flow would materially improve everyday use.

### 🟠 P1 — No cost/margin signal when pricing a bouquet despite component costs being available

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/bouquets/bouquets-page.tsx:302-315, 368-456`
- **Проблема:** The price field is a bare number input. Products carry costPrice and salePrice (src/lib/db/types.ts:37-38) and the composition already knows quantities, but the editor never sums the component cost or shows margin. The person setting the price has no anchor — they cannot see 'components cost N, you're pricing at M, margin X%'. This is the single most decision-relevant number in the form and it is absent.
- **Влияние:** Lets managers price bouquets profitably at a glance instead of guessing; directly affects shop economics.
- **Рекомендация:** Below the price field (or in the Состав footer), compute and display sum of component cost (and/or sum of component salePrice) from the draft items and show the implied margin once a price is entered. Reuse formatMoney; the data is already in `products`/`productByCode`. Surface it as a small summary row, not a hard validation.

### 🟠 P1 — Visual catalog is rendered as a dense table with icon-sized thumbnails

- **Категория:** `information-architecture` · **Объём:** L · **Где:** `src/components/bouquets/bouquets-page.tsx:498-521`
- **Проблема:** The module is explicitly a photo catalog, yet bouquets are listed in a `min-w-[960px]` horizontally-scrolling table where the photo is a 48px (size-12) cell in the first column, squeezed between text columns (Описание, Обновлен, etc.). A manager scanning for 'the pink peony bouquet' cannot recognize it by sight — they must read names. The photo, which is the most distinguishing attribute, has the least visual weight.
- **Влияние:** Turns a spreadsheet back into a browsable catalog; makes template recognition instant for the people who pick them.
- **Рекомендация:** Switch the primary view to a responsive card grid with a large cover photo per template (see redesignProposal). Reuse BouquetThumbnail with a new full-width aspect-ratio variant. Keep the table as an optional compact view.

### 🟠 P1 — Catalog has no search, filter, or sort

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/bouquets/bouquets-page.tsx:241-278`
- **Проблема:** The only navigation is the Active/Inactive tabs. As the catalog grows past a screenful there is no way to search by name, filter to 'не хватает позиций' bouquets, or sort by price/updated. A manager looking for one template must eyeball-scroll a long wide table.
- **Влияние:** Keeps the catalog usable at scale; faster lookup during day-to-day curation.
- **Рекомендация:** Add a search Input above the tabs filtering the in-memory `bouquets` by name/description (the same pattern already used in ProductCombobox). Optionally add a 'только с нехваткой' filter chip since availability is already computed per row, and make a couple of table headers sortable. All client-side over data already in props.

### 🟠 P1 — Photo cannot be attached when creating a bouquet (forced two-step save-then-upload)

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/bouquets/bouquets-page.tsx:344-363`
- **Проблема:** On the create path the file input and upload button are hard-disabled (`disabled={!editing ...}`) and the description reads 'Сначала сохраните букет, затем загрузите фото.' So adding the most important attribute requires: fill form -> Save -> reopen the record in edit -> choose file -> click 'Загрузить фото' (a second network round-trip separate from form submit). A new template is always created photo-less, and the upload uses fetch to /api/bouquets/:id/image rather than the server action, so it is a distinct mental model from the rest of the form.
- **Влияние:** Removes a multi-step detour from the most common task (adding a new template with its photo) and eliminates photo-less templates.
- **Рекомендация:** Allow selecting a photo during creation and upload it immediately after the create action returns the new id (chain in the submit transition), or accept the file in createBouquetTemplateAction. At minimum, after a successful create, auto-advance the Sheet into edit mode for that bouquet and focus the file input so the photo step is one click, not a manual reopen.

### 🟡 P2 — Status/availability rely on amber & emerald colors that violate the monochrome design system

- **Категория:** `color-visual-signal` · **Объём:** M · **Где:** `src/components/bouquets/bouquets-page.tsx:537-540, 570-582; src/components/bouquets/bouquets-page.tsx:372-390`
- **Проблема:** globals.css is fully monochrome with only --destructive sanctioned, yet this module hardcodes border-emerald-200/text-emerald-700 for Активен, amber for Выключен/Не хватает, and an amber Alert. These colors do aid at-a-glance legibility (good), but they are ad-hoc Tailwind palette values inconsistent with the rest of the app and with the design-system tokens, and 'Выключен' sharing amber with the 'shortage' warning conflates two different meanings. The contrast of amber-700/800 on amber-50 is also borderline for small text.
- **Влияние:** Restores consistency and ensures status legibility is a system property, not a per-module accident.
- **Рекомендация:** Decide deliberately: either (a) extend the design system with semantic success/warning tokens in globals.css and route badges/Alert through them so the whole app gains legible status color, or (b) fall back to the system Badge variants (secondary/outline/destructive) plus an icon (AlertTriangleIcon already imported) for shortage. Do not leave one-off emerald/amber literals only in this module. Differentiate 'Выключен' (neutral) from 'Не хватает' (warning).

### 🟡 P2 — Save-form Sheet has nested vertical scroll and no Cancel affordance

- **Категория:** `forms-input` · **Объём:** M · **Где:** `src/components/bouquets/bouquets-page.tsx:280-465; src/components/ui/sheet.tsx:52-58`
- **Проблема:** The SheetContent is itself overflow-y-auto, and inside it the Состав list uses its own ScrollArea with a computed pixel height (line 400). On a laptop this produces two nested scrollbars — the outer Sheet and the inner composition list — which is awkward to navigate, especially with many components. The footer (lines 460-464) contains only a Save button; there is no explicit Cancel, so users rely on the small top-right X or backdrop click, and Save is disabled with no visible reason when items is empty.
- **Влияние:** Smoother editing of multi-component bouquets and clearer exit/submit affordances.
- **Рекомендация:** Let the composition list grow naturally and rely on the single Sheet scroll (drop the fixed-height inner ScrollArea, or make only one element scroll). Add a 'Отмена' SheetClose button beside Save in the footer. When Save is disabled, surface why (e.g. helper text 'Добавьте хотя бы одну позицию') near the button rather than a silently dead button.

### 🟡 P2 — Toggling a bouquet active/inactive has no confirmation and is visually heavier than Edit

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/bouquets/bouquets-page.tsx:550-559`
- **Проблема:** Each row's action cluster puts a ghost icon-only Edit button next to a full outlined 'Выключить' button. The destructive-ish toggle (hides the bouquet from the offer combobox, which filters isActive) is the most prominent control and fires immediately with no confirm, while the primary action (Edit) is a bare pencil icon that is easy to miss. There is also no inline reason/tooltip explaining what 'Выключить' does.
- **Влияние:** Prevents accidental hiding of templates and aligns action prominence with intent.
- **Рекомендация:** Make Edit the visually primary action (outline/secondary with the word 'Изменить', not an unlabeled icon) and demote the toggle to a less prominent control or a dropdown-menu (DropdownMenu is in the toolkit). Add an AlertDialog confirm for switching off an active bouquet, or at least a tooltip clarifying it removes the template from offers.

### 🟡 P2 — Largest photo preview in the editor is only 112px and not editable in place

- **Категория:** `visual-design` · **Объём:** M · **Где:** `src/components/bouquets/bouquets-page.tsx:333-366; src/components/bouquets/bouquet-thumbnail.tsx:18-23`
- **Проблема:** When editing, the photo preview maxes out at size-28 (112px, the 'xl' size). For a visual product whose photo is sent to customers via Wazzup (src/lib/wazzup.ts), the manager can never see the image at a meaningful size to judge quality/crop. There's also no way to remove an existing photo, and no upload progress beyond a disabled button.
- **Влияние:** Lets managers verify the customer-facing image before it ships, and manage it fully.
- **Рекомендация:** Give the editor a larger preview (e.g. a `aspect-[4/3] w-full max-w-xs` frame) so cropping/quality is visible. Add a 'Удалить фото' affordance. Show clearer upload feedback (the uploadingImage state already exists — render a spinner/label on the button).

### ⚪ P3 — deleteBouquetTemplateAction exists but there is no way to delete a template from the UI

- **Категория:** `consistency` · **Объём:** S · **Где:** `src/components/bouquets/bouquets-page.tsx:7-11 (imports); src/app/actions.ts:275-280`
- **Проблема:** actions.ts ships a deleteBouquetTemplateAction (which, per its message, actually soft-deactivates: 'Букет выключен.'), but the page never imports or exposes it. The only lifecycle control is the active toggle. So 'delete' is dead code from the user's perspective, and the toggle is the de-facto delete — an unclear model. The Trash2Icon in this file is only for removing composition items, not templates.
- **Влияние:** Eliminates a confusing/dead capability and clarifies the template lifecycle.
- **Рекомендация:** Decide on the model: if soft-deactivation via toggle is the intended lifecycle, remove the unused delete action to avoid confusion; if true deletion is wanted, expose it behind an AlertDialog confirm in the row actions. Either way, make the toggle's effect (hide from offers) explicit in copy.

### ⚪ P3 — Money formatting inconsistent within the module (formatMoney vs raw Intl number)

- **Категория:** `consistency` · **Объём:** S · **Где:** `src/components/bouquets/bouquets-page.tsx:532 vs 585-587, 419-424`
- **Проблема:** Prices use formatMoney (line 532) while quantities/stock use a locally redefined formatNumber (line 585), and the same formatNumber is redefined again in product-combobox.tsx:370. Stock and 'не хватает' values render as bare numbers with no unit, so '3' could be stems, pieces, or grams depending on the product unit (Product.unit exists at types.ts:32 but is never shown).
- **Влияние:** Consistent, less ambiguous numbers across the composition and shortage UI.
- **Рекомендация:** Centralize formatNumber alongside formatMoney in src/lib/utils to avoid per-file copies, and surface the product unit next to stock/shortage numbers so '3' reads as '3 шт' etc. Reuse the existing unit field.

### ⚪ P3 — Empty-state thumbnail fallback shows only a single capital letter, weak for a photo catalog

- **Категория:** `feedback-states` · **Объём:** S · **Где:** `src/components/bouquets/bouquet-thumbnail.tsx:59-63`
- **Проблема:** When a bouquet has no photo (the default for every newly created template, given the create flow), the thumbnail renders the first letter of the name uppercased. In a grid of photo-less new templates this reads as a wall of gray monograms with no signal that a photo is missing/should be added.
- **Влияние:** Makes missing photos obvious and nudges completion, improving catalog quality.
- **Рекомендация:** For larger sizes (lg/xl/grid cover) prefer the ImageIcon placeholder plus subtle 'Нет фото' hint over a lone letter, and consider a faint 'add photo' affordance in the editor preview. Keep the letter only for the tiny inline sizes where an icon would be too small.

### ⚪ P3 — Composition quantity uses a plain number input with no stepper or quick-remove ergonomics

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/bouquets/bouquets-page.tsx:429-449`
- **Проблема:** Adjusting a component count is a 120px number input plus a separate trash icon. Adding the same product again increments by 1 (good), but there is no +/- stepper and the invalid state only turns the border red with no message. The input-group primitive exists in the toolkit and is not used here.
- **Влияние:** Faster, lower-error composition editing.
- **Рекомендация:** Wrap qty in an input-group with −/+ buttons for fast counter-side adjustment, and show a short inline message on invalid qty instead of only a red border. Keep the increment-on-re-add behavior.

> **Предложение по редизайну:** Replace the table-only catalog with a photo-first responsive grid (this is the module's defining job and the table actively hides the photos). Concretely: in BouquetsPage (src/components/bouquets/bouquets-page.tsx:498-567) swap BouquetsTable for a card grid `grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`. Each card: a 4:3 or 1:1 cover image at the top (reuse BouquetThumbnail but add a full-width `aspect-[4/3]` variant, not the fixed size-12), then name (truncate to 1-2 lines), price (prominent, formatMoney), a component count and the availability badge, and a hover/footer action row (Edit, Выключить/Включить) mirroring the current buttons. Keep the active/inactive Tabs (lines 241-276) above the grid. Retain a compact "list/table" toggle for power users who want the dense Обновлен/Описание columns, but default to the grid. This also fixes the responsive problem (the min-w-[960px] table) since cards reflow naturally on tablet. Pair this with the create-with-photo flow fix (see forms finding) so a new template can be photographed in one pass. Effort is L but this is the single change that makes the module feel like a catalog rather than a spreadsheet.

**Quick wins:**

- Add a search Input above the active/inactive tabs filtering bouquets by name/description client-side (src/components/bouquets/bouquets-page.tsx:241).
- Add an 'Отмена' SheetClose button next to Save, and helper text explaining why Save is disabled when the composition is empty (lines 460-464).
- Make row Edit the labeled primary action and demote/confirm the active toggle to prevent accidental hiding (lines 550-559).
- After a successful create, auto-advance the Sheet into edit mode and focus the photo input so attaching a photo is one click (lines 194-208, 344-363).
- Show component-cost sum and implied margin under the price field using costPrice already in props (lines 302-315).

---

## Склад + Акты склада + История + Импорты — 6/10

**Основная роль / задача:** Owner (Управляющий) — only role with access. Core tasks: keep stock accurate (приход/списание/инвентаризация via acts), spot what's running low or negative, and do bulk XLSX imports after MoySklad/supplier updates. Data-heavy, mostly desktop, occasional tablet.

**Маршруты:** /stock, /stock/acts, /stock/acts/[id], /stock/acts/[id]/edit, /history/stock, /warehouse/imports, /warehouse/imports/[id]

**Оценка:** The warehouse module is functionally complete and the document/import flows are well thought through (preview-before-apply, draft/post lifecycle, "будет минус" warnings, locked posted acts). But it is built for a desktop owner doing batch data entry, not for fast scanning at a counter. The biggest gap is low-stock visibility: a `lowStockCount` is already computed in the data layer but never surfaced, the main stock table cannot be filtered or sorted by stock at all, and the only "что заканчивается" signal is a soft gray outline badge that is invisible against the monochrome theme. There is also a hard inconsistency: this module liberally uses emerald/red/amber colors on the acts/import/history pages while the rest of the app (and the main stock list itself) is pure grayscale, so status color works in some screens and not others. Forms are solid but lack running totals/value summaries during document entry, and several dense tables (acts list = 11 columns, import preview = 13 columns) overflow on tablets with no responsive treatment.

### 🔴 P0 — Сигнал низкого остатка невидим в сером списке (а в минусе — на равных с «мало»)

- **Категория:** `color-visual-signal` · **Объём:** S · **Где:** `src/components/stock/stock-page.tsx:1436-1446`
- **Проблема:** StockBadge — единственный индикатор дефицита в главном списке. Нормальный остаток = variant secondary (серый), «мало» (≤3) = variant outline (почти такой же серый контур), минус = destructive (красный). В монохромной теме secondary и outline почти неразличимы, поэтому «осталось 2» выглядит так же, как «осталось 200». Порог зашит как <=3 в компоненте, хотя в данных уже есть согласованный available<=3. Нижний колонтитул (532-538) лишь говорит «Есть позиции с отрицательным остатком» серым outline-бейджем — без числа и без перехода к ним.
- **Влияние:** Дефицит читается с одного взгляда, что напрямую снижает ошибки нехватки товара.
- **Рекомендация:** Усилить визуальный сигнал даже в серой теме: для остатка ≤3 показывать AlertTriangleIcon (lucide уже импортирован) слева от числа + bold, для 0 — заметный контраст (bg-muted + bold + иконка), минус оставить destructive. Использовать product.available, а не product.stock, и единый порог из данных. Бейдж внизу заменить на кликабельный счётчик («3 в минусе»), ведущий на фильтр из находки выше.

### 🔴 P0 — Нет фильтра/сортировки по остатку — нельзя быстро увидеть, что заканчивается

- **Категория:** `workflow-efficiency` · **Объём:** M · **Где:** `src/components/stock/stock-page.tsx:188-200, 425-456, 532-538`
- **Проблема:** Основная ежедневная задача владельца — понять, что нужно дозаказать. Но список товаров фильтруется только по строке поиска и категории; нет фильтра «мало / закончилось / в минусе» и нет сортировки по колонке «Остаток». При сотнях позиций невозможно найти заканчивающиеся товары, кроме как глазами листать всю таблицу. При этом данные УЖЕ посчитаны: dashboard.ts:194 отдаёт lowStockCount (available<=3), но в StockPage передаётся только negativeStockCount, а lowStockCount не используется вообще.
- **Влияние:** Владелец за 1 клик видит список на дозаказ вместо ручного просмотра всей базы.
- **Рекомендация:** Передать lowStockCount в StockPage и добавить рядом с фильтром категорий быстрые чипы-фильтры (Button variant=outline, как в /stock/acts:84-103): «Все», «Мало (≤3)», «Закончились (0)», «Минус» с числом в скобках. Фильтровать filteredProducts по product.available. Дополнительно сделать заголовок «Остаток» кликабельным для сортировки asc/desc. Это устраняет основное трение модуля без редизайна.

### 🟠 P1 — Цвет статусов работает на одних экранах склада и отсутствует на других (несогласованность темы)

- **Категория:** `consistency` · **Объём:** M · **Где:** `src/app/stock/acts/page.tsx:165-191, src/app/stock/acts/[id]/page.tsx:206-234, src/app/warehouse/imports/[id]/page.tsx:144-154`
- **Проблема:** Дизайн-система заявлена как полностью монохромная (только --destructive красный), но эти экраны массово используют emerald/red/amber/zinc хардкодом (bg-emerald-50, text-amber-900, border-red-200 и т.п.) — типы актов, статусы, дельты, «будет минус». Главный же список товаров (stock-page) остаётся серым. Получается: на странице актов статус «Проведён» зелёный, а на странице склада статусы серые — пользователь учится двум разным языкам цвета. Плюс зелёные/янтарные оттенки не пройдут проверку контраста и сломаются при тёмной теме.
- **Влияние:** Единый, предсказуемый язык статусов; готовность к тёмной теме; контраст.
- **Рекомендация:** Принять одно решение по всему модулю. Либо (а) завести в globals.css семантические токены (--success/--warning + foreground) и заменить ими все хардкод-классы emerald/red/amber/zinc, чтобы цвет статуса был один и тот же во всех таблицах склада; либо (б) если тема обязана быть серой — убрать цветные бейджи и отличать статусы формой/иконкой (точка, контур, иконка), как в основном списке. Сейчас худший вариант — наполовину цветно, наполовину серо.

### 🟠 P1 — Ошибки импорта видно плохо: усечённый текст, нет перехода к строкам с ошибкой

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/stock/stock-page.tsx:974-1035`
- **Проблема:** При ошибках показывается общий Alert «В файле есть ошибки. Импорт нельзя применить», но конкретные строки нужно искать глазами в таблице на 9 колонок и 1120px ширины, где колонка «Ошибка» усечена (truncate) и читается только по title-тултипу. Нет фильтра «показать только ошибки», нет счётчика-ссылки, строки с ошибкой ничем не выделены кроме красного текста ошибки. На большом файле найти 3 проблемные строки среди сотен — мучительно.
- **Влияние:** Исправление импорта из десятков минут поиска превращается в адресную правку.
- **Рекомендация:** Сделать ImportStat «Ошибок» кликабельным фильтром (показывать только action===error), подсвечивать строку-ошибку (bg-destructive/5 + левый бордер), и не усекать текст ошибки (перенос по словам, она важнее всего). По умолчанию при наличии ошибок сразу скроллить/фильтровать к ним.

### 🟠 P1 — При создании акта нет итогов: ни числа позиций, ни суммы/стоимости

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/stock/stock-document-form.tsx:217-314, src/components/stock/stock-page.tsx:1277-1357`
- **Проблема:** В форме акта (и в Sheet создания, и в edit-форме) таблица позиций не показывает ни «Позиций: N», ни суммарного изменения количества, ни денежной стоимости прихода/списания (хотя у Product есть costPrice/salePrice). Перед проведением прихода на десятки позиций владелец не видит контрольную сумму — легко провести акт с лишней строкой или опечаткой в количестве и не заметить. В детали акта (acts/[id]) тоже нет строки «Итого».
- **Влияние:** Контроль перед необратимым проведением — меньше ошибок в данных.
- **Рекомендация:** Добавить футер таблицы позиций (TableFooter) с «Позиций: N», суммой количеств и оценочной стоимостью (Σ qty*costPrice через @/lib/pricing). Эти же итоги показать на странице проведённого акта. Денежная сводка особенно нужна для приходов от поставщика.

### 🟠 P1 — Списание в минус разрешено без подтверждения — только мягкое предупреждение

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/stock/stock-document-form.tsx:272-312, src/components/stock/stock-page.tsx:1328-1333`
- **Проблема:** При списании, уводящем остаток в минус, показывается янтарный бейдж «Будет минус» и Alert «Операция разрешена», но кнопка «Провести акт» остаётся активной и проводит акт без дополнительного шага подтверждения. Уход в минус — почти всегда опечатка в количестве (лишний ноль), а проведённый акт необратим (правка только обратным актом, acts/[id]:77). Janтарный цвет к тому же противоречит серой теме.
- **Влияние:** Предотвращает необратимые ошибочные списания из-за опечаток в количестве.
- **Рекомендация:** Если есть строки «в минус» — при «Провести акт» открывать AlertDialog (примитив уже используется в модуле) со списком уходящих в минус позиций и явным подтверждением, либо требовать причину. Кнопку оставить, но добавить шаг осознанности. Это error-prevention для необратимой операции.

### 🟠 P1 — Дублирующиеся фильтры на странице актов, чипы сбрасывают остальные условия

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/app/stock/acts/page.tsx:53-103`
- **Проблема:** Есть и форма (поиск + Select типа + Select статуса + «Применить»), и ниже 6 ссылок-чипов («Черновики», «Проведённые», «Пополнение» и т.д.). Чипы — это голые Link на ?status=... / ?type=..., поэтому клик по «Черновики» затирает выбранный тип и текст поиска (не сохраняет другие query-параметры), а в форме при этом значения не подсвечиваются как активные. Пользователь не понимает, какой фильтр сейчас применён, и комбинировать фильтры через чипы нельзя.
- **Влияние:** Устраняет потерю выбранных фильтров и непонимание текущего состояния.
- **Рекомендация:** Убрать дублирование: либо оставить только форму и пометить активные значения, либо сделать чипы togglable и сохраняющими другие параметры (href строить из текущих searchParams). Активный чип выделять (variant=default вместо outline). Так фильтры станут предсказуемыми и комбинируемыми.

### 🟠 P1 — Панель действий склада: 7 кнопок одного веса, главное не выделено

- **Категория:** `information-architecture` · **Объём:** M · **Где:** `src/components/stock/stock-page.tsx:457-502`
- **Проблема:** В CardHeader в один ряд набито 7 управляющих элементов: «Пополнить», «Списать», «Акты склада», «Новый товар», «Категории», «Действия»(меню) + поиск + селект категорий. «Пополнить» и «Новый товар» оба default-variant (тёмные) и визуально конкурируют, хотя это разные по частоте операции. На ширине ниже xl всё переносится в неупорядоченную сетку. Нет иерархии: ежедневные операции (приход/списание) не отделены от редких (категории, импорт/экспорт).
- **Влияние:** Снижает визуальный шум и ускоряет самые частые операции.
- **Рекомендация:** Свести к 1–2 первичным кнопкам: основной CTA — «Пополнить»/«Списать» (можно через split-button или один «Новый акт» с выбором типа), всё остальное («Новый товар», «Категории», «Акты склада», «Движения», импорт/экспорт, история) убрать в существующее DropdownMenu «Действия». Поиск и фильтр оставить слева, действия — справа, ограничив до двух видимых.

### 🟡 P2 — Поле «Количество» в акте: нативный number, мелкое, без быстрых +/− и без max

- **Категория:** `forms-input` · **Объём:** M · **Где:** `src/components/stock/stock-page.tsx:1313-1324, src/components/stock/stock-document-form.tsx:257-268`
- **Проблема:** Количество вводится обычным <Input type=number min=1 step=1> в узкой колонке w-32. На планшете spinner-стрелки крошечные (мелкие тач-цели), при списании нет верхней границы (max), а валидация целого/≥1 срабатывает только при сабмите через toast, а не инлайн у поля. Для частой операции набора прихода это медленно и подвержено опечаткам.
- **Влияние:** Быстрее и точнее ввод количеств на планшете у стола приёмки.
- **Рекомендация:** Сделать stepper: InputGroup с кнопками −/+ (примитивы есть) для тач-ввода, при списании ставить максимум = текущий остаток (или явно помечать превышение прямо у поля, а не только в колонке «После»). Инлайн-подсветка невалидного значения (aria-invalid) вместо только toast.

### 🟡 P2 — История импортов и детали импорта вне CrmShell — выпадение из навигации

- **Категория:** `navigation` · **Объём:** S · **Где:** `src/app/warehouse/imports/page.tsx:20-31, src/app/warehouse/imports/[id]/page.tsx:30-43`
- **Проблема:** В отличие от всех остальных экранов модуля (склад, акты, история — все в CrmShell с сайдбаром и топбаром), страницы /warehouse/imports и /warehouse/imports/[id] рендерятся как голый <main bg-zinc-50> с собственным H1 и единственной кнопкой «Вернуться на склад». Пользователь теряет сайдбар, бейдж смены и пользователя, навигация по другим разделам недоступна — приходится возвращаться назад. Несогласованно с историей движений (/history/stock), которая в CrmShell.
- **Влияние:** Единая навигация, не теряется контекст при работе с импортами.
- **Рекомендация:** Обернуть обе страницы в CrmShell (active="stock" или новый пункт), как сделано в /history/stock/page.tsx и /stock/acts. Убрать самописный <main>/<h1>, заголовок задать через title шелла.

### 🟡 P2 — Широкие таблицы (11 и 13 колонок) переполняются на планшете без адаптации

- **Категория:** `responsive-touch` · **Объём:** M · **Где:** `src/app/stock/acts/page.tsx:113-158, src/app/warehouse/imports/[id]/page.tsx:60-105`
- **Проблема:** Список актов — 11 колонок (Номер, Тип, Статус, Поставщик, 3 даты, Ответственный, Позиций, Комментарий, кнопка); детали импорта — 13 колонок (включая старая/новая цена/закупка ×2). На планшете и в свёрнутом сайдбаре это даёт горизонтальный скролл, где ключевые «Статус» и «Открыть» уезжают за край. В отличие от главного списка, тут нет даже карточного fallback, а ResponsiveTable из stock-page здесь не переиспользуется.
- **Влияние:** Ключевые поля и действие видны без горизонтального скролла на планшете.
- **Рекомендация:** Для списка актов скрывать второстепенные колонки на узких ширинах (hidden lg:table-cell для «Создан»/«Проведён»/«Ответственный») или ввести карточный режим как в основном списке. Для деталей импорта 4 ценовые колонки сгруппировать в одну «Цена/Закупка: было → стало» либо прятать под раскрытие строки. Закрепить колонку действия справа.

### ⚪ P3 — Нет состояния «ничего не найдено» при активном фильтре/поиске

- **Категория:** `feedback-states` · **Объём:** S · **Где:** `src/components/stock/stock-page.tsx:506-508, 1394-1406`
- **Проблема:** ResponsiveTable при пустом результате всегда показывает «Склад пуст / Данные появятся после первой операции». Но тот же текст выводится, когда склад не пуст, а просто фильтр/поиск ничего не нашёл — это вводит в заблуждение (склад НЕ пуст). Empty-стейт не отличает «нет данных вообще» от «нет под фильтр».
- **Влияние:** Меньше путаницы при пустой выборке по фильтру.
- **Рекомендация:** Передавать в ResponsiveTable признак активного фильтра и менять текст: при активном поиске/категории — «Ничего не найдено / Сбросьте фильтры» с кнопкой сброса; пустой склад — текущий текст. Empty-примитив уже поддерживает EmptyContent для кнопки.

### ⚪ P3 — У товаров без фото — только инициалы; в плотной таблице это шумит, а не помогает

- **Категория:** `visual-design` · **Объём:** S · **Где:** `src/components/stock/stock-page.tsx:511-517`
- **Проблема:** Каждая строка товара рендерит ProductThumbnail (size md). У большинства позиций фото нет → колонка заполнена серыми плашками-инициалами, которые при сканировании сотен строк не несут информации и увеличивают высоту строки, снижая плотность таблицы при складской работе.
- **Влияние:** Выше плотность и скорость сканирования большого списка.
- **Рекомендация:** Сделать миниатюру компактнее (size sm) либо показывать реальную картинку только при наличии imagePath, иначе — без плашки. Рассмотреть переключатель «компактный вид» (как делают для больших списков), чтобы владелец мог уплотнить таблицу при просмотре остатков.

> **Предложение по редизайну:** Редизайн оправдан только для главного экрана /stock как «рабочего стола остатков», остальное — точечные правки. Предлагаю: (1) Над таблицей — компактная строка KPI/фильтр-чипов: «Все N», «Мало ≤3 (X)», «Закончились 0 (Y)», «В минусе (Z)», источник чисел — lowStockCount/negativeStockCount, которые уже считаются. Клик по чипу фильтрует таблицу (find #1). (2) Тулбар свести к одному первичному действию «Новый акт» (split: Пополнить/Списать) + «Новый товар»; всё остальное — в «Действия» (find #4). (3) Колонка «Остаток» — кликабельная сортировка + усиленный визуальный сигнал дефицита через иконку/жирность, а не серый бейдж (find #2). (4) Колонку фото уплотнить/опционально скрыть, добавить «компактный вид» для плотного сканирования. (5) Для формы акта добавить TableFooter с итогами (позиций, Σ количеств, оценочная стоимость по costPrice) и AlertDialog-подтверждение при уходе в минус. Это превращает /stock из «справочника товаров» в инструмент «что заказать / что проверить», не меняя серверную модель и переиспользуя существующие примитивы (Button, Badge, Table, AlertDialog, DropdownMenu).

**Quick wins:**

- Усилить StockBadge: иконка+жирный для остатка ≤3 и 0, использовать product.available и единый порог из данных (stock-page.tsx:1436-1446)
- Передать уже посчитанный lowStockCount в StockPage и сделать нижний бейдж кликабельным счётчиком в минус (stock-page.tsx, dashboard.ts:194-195)
- Обернуть /warehouse/imports и /warehouse/imports/[id] в CrmShell для единой навигации
- Не усекать текст ошибки в предпросмотре импорта и подсвечивать строки с ошибкой; сделать счётчик «Ошибок» фильтром (stock-page.tsx:974-1035)
- Различать Empty 'склад пуст' и 'ничего не найдено по фильтру' (stock-page.tsx:506-508)
- Подтверждение (AlertDialog) при проведении списания, уводящего в минус (stock-document-form.tsx:306-312)

---

## Смены (открытие/закрытие/сверка) — 5/10

**Основная роль / задача:** Owner (Управляющий) reviews shift history and reconciliation on /shifts and /shifts/[id] (owner-only routes). The actual open/close-shift action is driven from the AppTopbar button in CrmShell for owner/manager (and florist on a night shift), opening the ShiftSheet. So two audiences: the manager/florist closing the till under time pressure at the counter, and the owner auditing discrepancies afterward.

**Маршруты:** /shifts, /shifts/[id], ShiftSheet (open/close dialog, mounted in CrmShell, triggered from AppTopbar on every page)

**Оценка:** The reconciliation math is solid and the "Формула кассы" breakdown is genuinely good — it shows exactly how expected cash is derived, which is rare and valuable. But the module has three recurring UX weaknesses. First, money discrepancies are NOT visually obvious despite being the module's whole point: in the all-gray theme the only color is a single red badge that fires identically for a 1-som surplus and a 5000-som shortage, and surplus vs shortage (излишек/недостача) is never labeled — the owner cannot scan the history table and instantly see "this shift was short by a lot." Second, the shift detail page is a wall of 15 equally-weighted stat cards with no hierarchy, so the one number that matters (Разница) is buried among Mbank/Optima/ЭлСом revenue cards. Third, the history table has no filtering, sorting, totals, day/night-type indicator, or surfacing of the opening/closing comment, so it does not scale past a few dozen shifts and hides the context (the note) that explains every discrepancy. The open/close sheet flow itself is reasonable and the forced-comment-on-discrepancy guard is a good control, though there are inline-validation and number-input ergonomics issues.

### 🔴 P0 — Денежная разница не считывается с первого взгляда — нет различия излишек/недостача и нет градации величины

- **Категория:** `color-visual-signal` · **Объём:** S · **Где:** `src/components/shifts/shift-pages.tsx:648-654`
- **Проблема:** DifferenceBadge is the only at-a-glance discrepancy signal and it is binary: secondary (gray) when |diff|<0.01, otherwise destructive (red) showing a signed formatMoney value. In the fully monochrome theme red is the sole color, so a +1 som rounding artefact looks identical in weight to a -5000 som theft-sized shortage, and the sign is the only cue to whether cash is over or short. The owner's core task — scanning shift history to spot problem shifts — cannot be done at a glance. formatMoney(difference) also renders a bare signed number with no словесная метка (излишек vs недостача), which is exactly the distinction a cash reconciliation needs.
- **Влияние:** Owner can scan a month of shifts and immediately see which were short and by how much; counter staff closing the till see a clear 'недостача' warning instead of a cryptic minus sign.
- **Рекомендация:** Rewrite DifferenceBadge to label direction and round magnitude: when diff>0 show 'Излишек {money}', when diff<0 show 'Недостача {money}', else 'Совпало'. Keep destructive for shortages (the real risk), use a neutral/secondary badge for surplus (over is suspicious but not a loss), and add an AlertTriangleIcon when |diff| exceeds a threshold (e.g. >100 or >1% of expected). Reuse the existing Badge variants plus a lucide icon; no new color tokens needed. Apply the same component in the history table cell (line 80), the detail Разница stat (line 136), and the close dialog (lines 257-259).

### 🟠 P1 — Shift type (день / ночь) is invisible everywhere despite being load-bearing for the night-shift flow

- **Категория:** `information-architecture` · **Объём:** S · **Где:** `src/components/shifts/shift-pages.tsx:62-99, 107-120; src/lib/db/types.ts:197`
- **Проблема:** Shift.type ('day'|'night') drives a real workflow — a manager can hand off a night shift to a florist (shift-sheet.tsx:147-150, 279-331), and a florist's cash access depends on having an open night shift. But neither the history table nor the detail header shows whether a shift is day or night. Two shifts on the same calendar day (a day shift then a night shift opened from it) appear as undifferentiated rows; the cash chain 'фактическая наличка дневной смены = начальная наличка ночной' is impossible to follow from the UI.
- **Влияние:** Owner can audit the day→night handoff and cash carry-over; removes ambiguity when multiple shifts share a date.
- **Рекомендация:** Add a Badge (variant outline) 'Дневная'/'Ночная' next to the shift number in the history table and in the detail page header beside the status badge. Reuse the existing Badge primitive.

### 🟠 P1 — Opening/closing comment is captured but never displayed — discrepancy context is lost

- **Категория:** `information-architecture` · **Объём:** S · **Где:** `src/components/shifts/shift-pages.tsx:62-99 (history) and 107-137 (detail); src/lib/db/types.ts:192 (shift.note)`
- **Проблема:** Shift.note holds the mandatory comment that staff are forced to enter whenever opening or closing cash differs from expected (enforced in shift-sheet.tsx:152-163). That note is the single most useful piece of audit context — it explains every flagged discrepancy. Yet it is rendered nowhere: not in the history table, not on the detail page. The owner sees a red 'разница' but has to guess why, defeating the purpose of forcing the comment in the first place.
- **Влияние:** Turns a flagged discrepancy into an explained one in a single glance; closes the loop on the forced-comment control.
- **Рекомендация:** Add the note to the detail page header (e.g. a small Alert or muted block near the reconciliation panel: 'Комментарий к смене: …'). In the history table, show a comment indicator (e.g. a MessageSquare icon with the text in a tooltip) or include it as a wrapped column. At minimum render it on the detail page where there is room.

### 🟠 P1 — Detail page is a flat wall of 15 identical stat cards — the reconciliation result has no visual priority

- **Категория:** `information-architecture` · **Объём:** M · **Где:** `src/components/shifts/shift-pages.tsx:121-137`
- **Проблема:** ShiftDetailPage renders 15 ShiftStat cards (revenue before/after discount, cash, card, terminal, mbank, optima, elsom, transfer, внесения, изъятия, ожидается, факт, разница) in one uniform grid-cols-1 sm:2 xl:4. Every card has identical visual weight; the three numbers the owner actually opened the page to check — Ожидается / Факт / Разница — are cards #13, #14, #15, visually indistinguishable from 'ЭлСом' revenue. The single emphasis flag only applies to 'Ожидается в кассе' and uses border-primary bg-primary/5, which in light mode is near-black border on a barely-tinted card — a weak signal. Eight payment-method cards (mbank/optima/elsom/transfer often 0) dominate the fold.
- **Влияние:** Owner reads the reconciliation outcome in one second instead of scanning 15 cards; payment-method noise is demoted to where it belongs.
- **Рекомендация:** Split into a hierarchy: (1) a top reconciliation panel — a single Card with three large columns Ожидается | Факт | Разница and the DifferenceBadge prominent (this is the answer to 'did it balance?'); (2) below it, revenue summary (before/after discount, total) as 3 cards; (3) collapse the per-method breakdown (cash/card/terminal/mbank/optima/elsom/transfer/внесения/изъятия) into the existing Metric grid (already used in ShiftCloseSummary) or a compact 2-column key/value list, hiding zero-value methods. Reuse ShiftStat for the headline trio with emphasis and a larger value class.

### 🟠 P1 — Shift history has no filtering, date range, sorting, pagination, or column totals

- **Категория:** `workflow-efficiency` · **Объём:** L · **Где:** `src/components/shifts/shift-pages.tsx:39-104; src/app/shifts/page.tsx:16 (getDashboardData returns all shifts)`
- **Проблема:** ShiftsPage renders data.shifts as one unbounded, unfiltered, unsorted table inside a single Card with horizontal scroll. For a shop used daily this grows to hundreds of rows within a year. There is no way to filter by date range, by responsible person, by 'only shifts with discrepancy', no sort control, no pagination, and no summary row (total revenue / total discrepancy for the visible period). Finding last Tuesday's shift or auditing all short shifts means eyeballing the whole list.
- **Влияние:** Makes the history usable at real data volumes and turns the audit task (find the short shifts) into a one-click filter.
- **Рекомендация:** Add a lightweight filter bar above the table: a date-range control (reuse calendar/popover primitives), a responsible-person select (data already has cashier per shift), and a 'только с расхождением' toggle. Add a footer total row (sum of expectedCash/closingCash/difference for the filtered set). If the dataset is large, paginate or cap to a default window (e.g. last 30 days) with a 'показать все' affordance. These reuse existing select/popover/calendar/table primitives.

### 🟡 P2 — Two parallel close-shift implementations risk drift; ShiftCloseDialog appears unused

- **Категория:** `consistency` · **Объём:** S · **Где:** `src/components/shifts/shift-pages.tsx:204-276 (ShiftCloseDialog) vs src/components/shifts/shift-sheet.tsx:51-342 (ShiftSheet)`
- **Проблема:** Closing a shift is implemented twice. The live path is ShiftSheet (mounted in CrmShell, triggered from AppTopbar — crm-shell.tsx:180-194). ShiftCloseDialog in shift-pages.tsx is a near-duplicate close form (own actualCash state, own difference panel, own DifferenceBadge, own submit→closeShiftAction) but is not referenced by any route or component in the module files read. Two implementations of the same critical money flow guarantee they will diverge — e.g. ShiftCloseDialog has NO forced-comment-on-discrepancy guard that ShiftSheet enforces, so if it is ever wired up it silently bypasses the control.
- **Влияние:** Removes a divergence hazard on the most sensitive flow (cash close) and shrinks the file.
- **Рекомендация:** Confirm whether ShiftCloseDialog is dead code (grep shows no importer in the module). If unused, delete it. If it is used somewhere, replace its body with the shared ShiftSheetForm/close logic so the discrepancy-comment guard and difference rendering live in one place.

### 🟡 P2 — Discrepancy validation only fires on submit via toast — no inline error, easy to miss at the counter

- **Категория:** `feedback-states` · **Объём:** S · **Где:** `src/components/shifts/shift-sheet.tsx:152-178`
- **Проблема:** When a required comment is missing (opening or closing differs from expected, or night-shift florist not picked), handleSubmit calls event.preventDefault() and shows a sonner toast, then returns. The offending field is not marked aria-invalid, not focused, and not visually flagged inline; the toast auto-dismisses. On a busy counter screen the user may not notice why the dialog didn't close and will click 'Закрыть смену' again. The closing-comment field does show a FieldDescription when needsClosingComment, but the opening-comment field has no equivalent inline error state, and neither field receives focus on failed submit.
- **Влияние:** Staff immediately see which field blocks closing instead of re-clicking a button that silently does nothing.
- **Рекомендация:** On failed validation, set the field to aria-invalid and focus it (ref + .focus()), keep the inline FieldDescription/Alert as the persistent error message, and keep the toast as secondary. Reuse the Field aria-invalid styling already in the input/field primitives. Mirror the closing-note FieldDescription pattern for the opening note.

### 🟡 P2 — No confirmation on the irreversible 'Закрыть смену' action

- **Категория:** `forms-input` · **Объём:** M · **Где:** `src/components/shifts/shift-sheet.tsx:335-339; src/components/shifts/shift-pages.tsx:266-270`
- **Проблема:** Closing a shift is a one-way, money-affecting operation (it finalizes the cash count and, in the night-shift path, simultaneously opens a new shift for a florist). The submit button performs it directly with no confirmation, and when there is a recorded discrepancy the user is not asked to confirm 'закрыть с недостачей X'. A misclick or a wrong typed amount commits a permanent reconciliation record.
- **Влияние:** Prevents accidental commits of a wrong cash count; makes the consequence of a discrepancy explicit at the moment of action.
- **Рекомендация:** When |difference| >= threshold, gate the submit behind an AlertDialog (already a primitive) summarizing 'Закрыть смену с расхождением: Недостача/Излишек {money}? Это действие нельзя отменить.' For zero-discrepancy closes, the existing flow is fine. For the night-shift branch, the confirm should also state that a new смена will be opened for {florist}.

### 🟡 P2 — Closing cash defaults to the expected amount, biasing reconciliation toward 'совпало'

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/shifts/shift-sheet.tsx:135-138,145; src/components/shifts/shift-pages.tsx:207`
- **Проблема:** Both close forms pre-fill 'Фактическая наличка' with openShift.expectedCash. The discrepancy field therefore starts at 0 and reads 'совпало' before the person has counted anything. A tired florist can hit 'Закрыть смену' without recounting and the system records a perfect reconciliation that never happened — exactly the error a cash count is meant to prevent. The forced-comment guard never triggers because the prefilled value equals expected.
- **Влияние:** Prevents rubber-stamped reconciliations; makes every 'совпало' a real one.
- **Рекомендация:** Leave 'Фактическая наличка' empty on open and require the user to type the counted amount (the field is already required). Show the expected figure as a FieldDescription/hint ('Ожидается: …') rather than as the default value, mirroring how the opening-cash field hints the previous shift's amount. This forces an actual count and lets the discrepancy logic do its job.

### 🟡 P2 — Cash inputs lack numeric keypad / grouping — slow and error-prone on tablets

- **Категория:** `responsive-touch` · **Объём:** S · **Где:** `src/components/shifts/shift-sheet.tsx:194-204,241-251; src/components/shifts/shift-pages.tsx:244-252`
- **Проблема:** The opening/closing cash inputs are type='number' step='0.01' with no inputMode and no formatting. On a tablet (a stated usage context) type=number does not reliably summon a decimal keypad across browsers, and large amounts are entered/read as ungrouped strings (e.g. 125000 vs 125 000), which is error-prone when counting a till. The displayed difference uses formatMoney (grouped) but the input the user actually types into does not, creating a mismatch.
- **Влияние:** Faster, less error-prone cash entry on tablets at the counter; fewer mis-keyed reconciliations.
- **Рекомендация:** Add inputMode='decimal' to the cash inputs and consider a money-formatted display. At minimum set inputMode and ensure the field is large enough as a tap target. Reuse the existing Input/InputGroup primitive (an InputGroup with a 'сом' suffix would also clarify units).

### ⚪ P3 — Whole history rows are clickable but also contain a redundant 'Открыть' button; no keyboard affordance

- **Категория:** `accessibility` · **Объём:** S · **Где:** `src/components/shifts/shift-pages.tsx:66-94`
- **Проблема:** Each TableRow has onClick=router.push and cursor-pointer, plus a separate 'Открыть' Link button in the last column with stopPropagation. The row click target is not keyboard-focusable or operable (a div/tr with onClick has no role/tabindex/Enter handling), so keyboard and screen-reader users can only use the explicit button — fine — but the dual mechanism is redundant and the clickable-row has no focus ring, hover background, or aria affordance signalling it is interactive beyond the cursor change.
- **Влияние:** Cleaner, accessible navigation; removes redundant control and gives a proper interactive affordance.
- **Рекомендация:** Either drop the row-level onClick and rely solely on the 'Открыть' link (simplest, fully accessible), or keep row navigation but add a hover:bg-muted/50, make the row keyboard-operable, and then the trailing button becomes redundant and can be removed. Pick one interaction model.

### ⚪ P3 — Hardcoded amber Alert breaks the monochrome design system

- **Категория:** `consistency` · **Объём:** S · **Где:** `src/components/shifts/shift-sheet.tsx:210-215`
- **Проблема:** The 'Начальная наличка отличается' warning uses literal Tailwind classes border-amber-200 bg-amber-50 text-amber-950. The design system is deliberately fully monochrome (oklch chroma=0) with a single --destructive red as the only chromatic token. This amber alert is the one stray color in the module and is inconsistent with every other warning surface (which use destructive or muted). It also creates an inconsistency: the analogous closing-discrepancy warning uses a plain FieldDescription (line 273-277), not an amber alert.
- **Влияние:** Keeps the deliberate monochrome system intact and unifies the two discrepancy warnings.
- **Рекомендация:** Use the standard Alert with the destructive variant (or a neutral muted Alert) instead of hardcoded amber, matching the rest of the app. Make the opening- and closing-discrepancy warnings use the same treatment for consistency.

### ⚪ P3 — Метка 'Sale ID' и смешанная терминология в таблицах смены

- **Категория:** `content-copy` · **Объём:** S · **Где:** `src/components/shifts/shift-pages.tsx:362,391`
- **Проблема:** The 'Продажи смены' table header uses the English 'Sale ID' in an otherwise fully Russian UI (всё остальное — 'Время', 'Провел', 'До скидки', 'Итого'), and the cell renders '#{id}'. Elsewhere the app uses 'Продажа #…' (e.g. the cash-operations 'Связь' column at line 182). Mixed-language column headers read as unfinished.
- **Влияние:** Consistent, professional Russian copy.
- **Рекомендация:** Rename the header to '№ продажи' or 'Продажа' to match the Russian tone and the '#'-style id used elsewhere. Audit the module for other anglicisms.

> **Предложение по редизайну:** The shift DETAIL page (/shifts/[id]) warrants a layout redesign; the open/close sheet flow needs only the targeted fixes above. Proposed detail layout, top to bottom: (1) Header row: 'Смена #N' + status badge + type badge (Дневная/Ночная) + responsible person + open/closed timestamps; 'Назад к сменам' on the right. (2) Reconciliation panel — the hero of the page: one Card with three large columns — Ожидается в кассе | Фактическая наличка | Разница — where Разница uses the upgraded directional DifferenceBadge (Недостача/Излишек/Совпало) with a warning icon above a magnitude threshold; if a closing note exists, render it directly under this panel as a muted 'Комментарий: …' block so the discrepancy is explained in place. (3) 'Формула кассы' card kept as-is — it is the strongest element and belongs right under the reconciliation panel as the 'why'. (4) Revenue summary: a compact 3-card row (до скидок / скидки / после скидок). (5) Payment-method breakdown: collapse cash/card/terminal/mbank/optima/elsom/transfer/внесения/изъятия/выплаты курьеру into the existing Metric grid (already used by ShiftCloseSummary), hiding zero rows, so eight mostly-empty cards stop dominating the fold. (6) The three operation tables (Денежные операции / Продажи / Заказы) unchanged below. Net effect: the owner's question 'did this shift balance, and if not why' is answered in the first screen instead of being scattered across cards 13-15 of a flat 15-card grid.

**Quick wins:**

- Make DifferenceBadge distinguish surplus vs shortage with a label and direction (e.g. 'Недостача 1 200' / 'Излишек 300' / 'Совпало') instead of just a signed red number — this is the single highest-value change for the audit-at-a-glance goal.
- Show the shift type (день/ночь) as a badge in the history table and detail header — the data exists (shift.type) but is invisible everywhere.
- Surface the opening/closing note in the detail page and as a tooltip/expandable row in the history table — it is currently stored and never displayed, yet it is the explanation for every flagged discrepancy.
- Promote Ожидается / Факт / Разница into a single prominent reconciliation panel at the top of the detail page instead of three of fifteen identical cards.
- Add a thousands-separated, right-aligned numeric formatting hint and inputMode='decimal' to the cash inputs so counter staff on tablets get a numeric keypad.

---

## Настройки + Пользователи — 6/10

**Основная роль / задача:** Управляющий (owner) — the only role that can reach either page (both guard `user.role !== "owner"` → AccessDenied). Core tasks: one-time/occasional setup of the Wazzup integration and supplier list; ongoing management of staff accounts (add florist/manager, reset a forgotten password, deactivate a departed employee, assign roles).

**Маршруты:** /settings, /users

**Оценка:** Both pages are owner-only admin screens built cleanly on the shadcn primitives (Card, Table, Sheet, Dialog, AlertDialog, Field, Tabs) with consistent create/edit/toggle patterns and proper destructive confirmations — the Users page in particular is solid and intuitive. The weak point is the Settings → Wazzup tab: ~430 lines rendered as a flat vertical stack of seven cards with overlapping/duplicated controls (the webhook URL block and the "Проверить API key" button each appear twice), no internal grouping, and a connection state that — in the all-gray theme — communicates "Подключено", "Не настроено" and even sync failures with nearly indistinguishable badge variants. Many action buttons are disabled by prerequisite (no API key, integration off) with zero on-screen explanation of why, so the owner can get stuck. The freeform "Ответ Wazzup API" panel renders at the very bottom of the scroll, far from whichever button produced it. Forms lack inline validation (password match, phone format) and unsaved-changes feedback, deferring all errors to a post-submit toast.

### 🟠 P1 — Connection status is invisible at a glance — "Подключено" and "Не настроено" both render as muted gray badges

- **Категория:** `color-visual-signal` · **Объём:** S · **Где:** `src/components/settings/settings-page.tsx:436, 925-935`
- **Проблема:** getWazzupConnectionState returns variant "secondary" for the healthy "Подключено" state and "outline" for "Не настроено". In the monochrome theme both badge variants are near-identical pale gray (badge.tsx:13-18 — secondary = bg-secondary gray, outline = white/gray border). Only the error state gets red. The single most important fact on the page — is the WhatsApp integration actually live? — is therefore not legible without reading the small label text. The same flat-gray problem repeats on every StatusTile ("Настроен"/"Не настроен" are plain text with no positive/negative signal) and on the per-user sync badges where "synced"/"pending"/"skipped" all look alike.
- **Рекомендация:** Give the connected/healthy state a positive visual anchor that survives the gray theme: prepend a status dot or lucide icon to the badge (e.g. CheckCircle2 for Подключено, AlertCircle for Не настроено, XCircle for Ошибка) so shape carries the meaning, not hue. Apply the same icon-led treatment to StatusTile ("Настроен" → check icon, "Не настроен" → muted dash icon) and to the userSync/diagnostics badges. Reuse the existing data-icon="inline-start" slot the Badge already supports.

### 🟠 P1 — Disabled action buttons give no reason; owner can get stuck with no guidance

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/settings/settings-page.tsx:597, 669, 704-723, 833-851`
- **Проблема:** Many Wazzup buttons are disabled via `disabled={pending || !status.apiKeyConfigured || !status.isEnabled}` (sync users, sync all, sync pipelines/contacts/deals, check subscriptions, connect webhook, check channels). When greyed out there is no inline explanation of which prerequisite is missing. The "Синхронизация CRM" card does show one Alert (678-684), but most disabled buttons elsewhere do not, so the owner sees dead controls and cannot tell whether to enable the integration, save a key, or something else.
- **Рекомендация:** Wrap each gated button in the existing Tooltip primitive whose content states the unmet condition (e.g. "Сначала сохраните API key" / "Включите интеграцию"). Tooltip is already in the UI kit. At minimum, mirror the explanatory Alert pattern from the Синхронизация CRM card above every group of gated buttons so the blocking reason is always on screen.

### 🟠 P1 — Wazzup tab is a 430-line flat wall of 7 cards with no sub-navigation

- **Категория:** `information-architecture` · **Объём:** M · **Где:** `src/components/settings/settings-page.tsx:427-855`
- **Проблема:** WazzupSettingsBlock stacks seven full-width cards vertically: Статус подключения, Ключи, Подключение webhook, Пользователи Wazzup, Синхронизация CRM, Диагностика, Проверка — plus a floating API-response Alert. The owner must scroll a very long page to find any control, and the grouping mixes one-time setup (keys, webhook) with recurring operations (sync, diagnostics). For a screen touched rarely, this is a high cognitive load with poor scent.
- **Рекомендация:** Introduce a second level of organization. Simplest: nested Tabs inside the Wazzup tab — "Подключение" (Статус + Ключи + Webhook + Проверка) and "Синхронизация и диагностика" (Пользователи Wazzup + Синхронизация CRM + Диагностика). Alternatively wrap the operational cards in Accordion (already a base-ui pattern) collapsed by default so setup stays above the fold. Either reuses existing primitives and roughly halves the visible surface.

### 🟡 P2 — Webhook URL block and "Проверить API key" button are duplicated within one page

- **Категория:** `consistency` · **Объём:** S · **Где:** `src/components/settings/settings-page.tsx:459-466, 568-575, 546-548, 824-826`
- **Проблема:** The Public/Secure WebhookUrlRow pair is rendered twice — once in the "Статус подключения" card (459-466) and again in the "Подключение webhook" card (568-575). The "Проверить API key" button likewise appears both under the Ключи form (546) and in the Проверка card (824). Duplicated identical controls make the page feel longer than it is and create ambiguity about which one to use; if one copy changes behavior later they will silently diverge.
- **Рекомендация:** Keep the webhook URLs in exactly one place (the "Подключение webhook" card, where the numbered instructions give them context) and remove the copies from the status card. Keep "Проверить API key" only in the Проверка card. The status card should show read-only state, not action controls.

### 🟡 P2 — Owner can edit their own login/role with no extra confirmation; the single-owner guard only fires after submit

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/users/users-page.tsx:268-280, 154-184; src/lib/db/queries/users.ts:45-57`
- **Проблема:** The table marks "Текущий пользователь" but otherwise offers the same edit/disable controls for yourself as for anyone else. The server blocks disabling/demoting the last active owner (assertCanDemoteOrDisableUser), but that protection only surfaces as an error toast after the round-trip — the UI gives no prior warning, and the destructive AlertDialog for self-deactivation reads the same generic copy as for any user. An owner can also rename their own login and be confused at next login.
- **Рекомендация:** Detect targetUser.id === currentUserId in the toggle/edit flows and tailor the AlertDialog copy ("Вы отключаете свою учетную запись — вы выйдете из системы"), and proactively disable the "Отключить" action for the current user when they are the last active owner (the data needed — role + active count — is on the client). Keep the server guard as backstop.

### 🟡 P2 — "Ответ Wazzup API" output renders at the bottom of the page, disconnected from the button that triggered it

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/settings/settings-page.tsx:400-411, 857-864`
- **Проблема:** runWazzupApi stores the response in wazzupApiResult and renders it as an Alert with a <pre> at line 857 — after the Проверка card and after the clear-key dialog, i.e. at the very end of a long scroll. The buttons that populate it (sync, check subscriptions, check channels, connect webhook) are scattered hundreds of pixels above. After clicking "Проверить каналы" near the top, the owner sees only a toast and has no obvious indication that detailed output appeared far below the fold. The panel also never clears, so stale output from a previous action lingers under a new one.
- **Рекомендация:** Render the result inline within (or directly beneath) the card whose button produced it, or open it in a Dialog/Sheet so it is anchored to the action. Clear wazzupApiResult at the start of each runWazzupApi call and show a heading with the action name + timestamp so the owner knows the output is fresh. Add a small dismiss/clear affordance.

### 🟡 P2 — Role assignment offers no description of what each role can do

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/users/users-page.tsx:344-364`
- **Проблема:** The role Select lists only Управляющий / Менеджер / Флорист with no hint of the access each grants. Given the consequential differences (owner sees Settings/Users; florist needs an open night shift to use the cash register, per auth rules), an owner creating a manager vs florist has no in-context reminder of the implications and may mis-assign access. There is also no warning when editing your own account that changing your role could lock you out of admin.
- **Рекомендация:** Add a FieldDescription under the role Select summarizing the three roles in one line each (e.g. "Флорист — касса и стол заказов; Менеджер — продажи и склад; Управляющий — полный доступ, настройки и пользователи"), or render the description for the currently selected role dynamically. When the edited user is the current user and the role is being lowered from owner, surface a confirm step rather than relying on the server's single-owner guard alone.

### 🟡 P2 — Password change has no client-side match validation and no show-password toggle

- **Категория:** `forms-input` · **Объём:** M · **Где:** `src/components/users/users-page.tsx:424-451`
- **Проблема:** PasswordDialog has two password fields (newPassword / confirmPassword) but mismatch is only caught server-side (users.ts:164-166 → throws → toast "Пароли не совпадают"). The owner must submit, wait for the round-trip, read a toast, then retype both fields (the form is not preserved on error in an obviously recoverable way). Both fields are type=password with no reveal toggle, so a typo at a busy counter is invisible. Same applies to the create-user password field (users-page.tsx:366-378).
- **Рекомендация:** Add inline validation: compare the two fields on change/blur and show a FieldError under confirmPassword ("Пароли не совпадают") that disables the submit button until they match. Add a show/hide toggle using InputGroup with a trailing icon-button (EyeIcon/EyeOffIcon) — InputGroup is already in the UI kit and is the standard pattern for this.

### 🟡 P2 — Long Wazzup settings form has no unsaved-changes indication

- **Категория:** `forms-input` · **Объём:** M · **Где:** `src/components/settings/settings-page.tsx:476-558`
- **Проблема:** The Ключи card holds the API key input plus two consequential checkboxes (Интеграция включена, Требовать CRM key для webhook) controlled by local state (isEnabled, webhookAuthRequired). A user can toggle these and then navigate away or click an unrelated action button (Проверить API key, Сгенерировать CRM key) thinking the toggle is already applied — but nothing persists until "Сохранить настройки" is pressed. There is no dirty-state marker and no warning, so a silent loss of intended config is easy (e.g. flips off the integration, leaves without saving).
- **Рекомендация:** Track whether the form is dirty (compare local state + apiKey to status) and (a) show a subtle "Несохраненные изменения" badge/hint near the Сохранить button, and (b) disable Сохранить when clean so the affordance reflects state. Optionally emphasize the save button (default variant) once dirty.

### ⚪ P3 — Diagnostics shows raw English event types/statuses to a Russian-only owner

- **Категория:** `content-copy` · **Объём:** S · **Где:** `src/components/settings/settings-page.tsx:751, 795-799, 949-961`
- **Проблема:** The diagnostics table and userSync badges expose raw API tokens to the user: event types render as-is ("messagesAndStatuses", "createDeal"), statuses show "failed"/"unknown", and userSync labels are the literal English "synced"/"pending"/"skipped"/"failed". The rest of the app uses src/lib/labels.ts for RU display strings; here the owner sees untranslated developer-facing values.
- **Рекомендация:** Map the common Wazzup event types and sync statuses to Russian labels (extend labels.ts or a local map): e.g. synced → "Синхронизирован", pending → "Ожидает", failed → "Ошибка", skipped → "Пропущен". Keep the raw token in a tooltip if it aids debugging.

### ⚪ P3 — Supplier and user creation actions block whole-table; no per-row pending feedback or optimistic state

- **Категория:** `feedback-states` · **Объём:** M · **Где:** `src/components/users/users-page.tsx:255-280; src/components/settings/settings-page.tsx:243-259`
- **Проблема:** A single shared isPending from useTransition disables every button in the table during any mutation (e.g. toggling one user disables edit/password/toggle for all rows). There is no spinner on the specific button that was clicked, so on a slow server the owner sees the entire table go inert with no indication of which row is processing.
- **Рекомендация:** Track the in-flight row id (e.g. pendingId state) and show a loading spinner inside the specific clicked button (Button supports an icon slot; use Loader2 with animate-spin), disabling only that row's actions rather than the whole table. Low priority for a small staff list but improves perceived responsiveness.

### ⚪ P3 — Supplier phone field lacks input type/format affordances

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/settings/settings-page.tsx:326-329`
- **Проблема:** The supplier phone Input is a plain text field with no type="tel", no inputMode, and no placeholder/example. On a tablet at the counter this surfaces the full alphanumeric keyboard instead of the phone keypad and offers no format guidance, increasing entry friction and inconsistency.
- **Рекомендация:** Set type="tel" inputMode="tel" and a placeholder like "+7 (___) ___-__-__" on the phone Input. This matches the cash/order modules which presumably already handle phones and is a one-line change.

### ⚪ P3 — Settings and Users are split across two routes/pages with no link between them, both labeled "settings" in the shell

- **Категория:** `navigation` · **Объём:** M · **Где:** `src/app/settings/page.tsx:24-26, src/app/users/page.tsx:21-23`
- **Проблема:** Both pages set active="settings" in CrmShell, so the sidebar highlights the same item for two different routes, and there is no cross-link (Suppliers/Wazzup live under /settings, Пользователи under /users). An owner managing the shop has to know they are separate destinations. Given Поставщики is already a tab inside /settings, Пользователи being a wholly separate route is inconsistent.
- **Рекомендация:** Either fold Пользователи in as a third tab on /settings (Поставщики / Пользователи / Wazzup) for a single admin hub, or keep routes separate but give them distinct nav entries and correct active keys so the highlighted sidebar item matches the page. Folding into one tabbed admin page is the more coherent fix and reuses the existing Tabs already on the settings page.

### ⚪ P3 — Status tile grids are ragged — 4–6 items in a 3-column grid leave an orphan and misalign labels

- **Категория:** `visual-design` · **Объём:** S · **Где:** `src/components/settings/settings-page.tsx:447-452, 692-699, 747-759`
- **Проблема:** Several StatusTile grids use `md:grid-cols-3` but contain 4 items (status card: API key/CRM key/Webhook auth/Последняя проверка), 6 items (sync), or 5 items (diagnostics). 4 tiles in a 3-wide grid leaves a single lonely tile on row two; 5 tiles leaves two. The result looks unfinished and the eye can't scan a clean column.
- **Рекомендация:** Either pad to a multiple of the column count, switch to `md:grid-cols-2` for the 4-item case, or use `grid-cols-[repeat(auto-fit,minmax(180px,1fr))]` so tiles flow and fill the row evenly. Trivial Tailwind change per grid.

> **Предложение по редизайну:** Restructure the Wazzup tab from a 7-card vertical wall into a two-step layout that reflects how it is actually used. Step 1 \"Подключение\" (setup, touched once): a compact status header card whose Badge carries an icon for healthy/error, the keys form, the webhook URL + numbered instructions, and the quick checks — these all belong together because they are the connect flow. Step 2 \"Синхронизация и диагностика\" (operations, touched occasionally): the Пользователи Wazzup table, the CRM sync card, and the diagnostics table. Implement as nested Tabs (already used at the page top) or an Accordion collapsed by default. Every gated button gets a Tooltip stating its unmet prerequisite, and the freeform \"Ответ Wazzup API\" output moves into a Dialog/Sheet anchored to the action that produced it (cleared per call, headed with action name + time) instead of floating at the bottom of the scroll. Separately, consider merging /users into /settings as a third tab (Поставщики / Пользователи / Wazzup) to form one coherent owner admin hub, since Поставщики is already a settings tab and both pages are owner-only — this also fixes the duplicated active=\"settings\" sidebar key.

**Quick wins:**

- Add a status dot/icon to the connection Badge and StatusTiles so Подключено vs Не настроено vs Ошибка is legible in the gray theme (settings-page.tsx:436, 889-895)
- Remove the duplicated WebhookUrlRow block (459-466) and duplicate "Проверить API key" button (546) so each control appears once
- Set type=tel + inputMode + example placeholder on the supplier phone field (settings-page.tsx:326)
- Translate raw English event/sync statuses to Russian in the diagnostics table and userSync badges
- Fix the ragged StatusTile grids (4/5/6 tiles in grid-cols-3) with auto-fit or grid-cols-2

---

## Авторизация и общие паттерны форм/полей/состояний — 6/10

**Основная роль / задача:** All three roles (owner/manager/florist) hit the login screen first; the shared form/field/feedback primitives are consumed by every module, so quality here is force-multiplied across cash, orders, deals, stock, settings and users.

**Маршруты:** /login, (AccessDenied rendered by every guarded page), (shared ui primitives consumed app-wide)

**Оценка:** The login screen is clean and uses the design system correctly (Card + Field + Alert + pending-aware Button), but it is bare-bones: no logo/branding, no autofocus, no show-password toggle, duplicated error rendering (Alert + FieldError both bound to the same string), and a hardcoded zinc palette instead of theme tokens. The shared form primitives (Field, Input, Select, AlertDialog, Dialog, Sheet) are well-built and consistent, but two systemic issues undermine them across the whole app: (1) the Calendar primitive exists but is never used and has no Russian locale wired, so every date is picked through a raw native type="date" input with English/locale-dependent UI and no validation help; (2) the Toaster is configured with richColors while next-themes has no ThemeProvider, meaning toasts render with sonner's built-in green/amber/red semantics that directly violate the documented all-monochrome theme — yet that same color is the only place status is signalled, so feedback consistency is incoherent. Inline field validation is essentially unused outside login (FieldError/aria-invalid appear in only a handful of files and mostly as static help text), so server-action errors surface only as toasts with no field-level highlighting. These primitive-level gaps multiply across every module that builds forms.

### 🟠 P1 — Toaster uses richColors while next-themes has no provider — semantic toast colors contradict the monochrome design system

- **Категория:** `color-visual-signal` · **Объём:** M · **Где:** `src/app/layout.tsx:34; src/components/ui/sonner.tsx:3,8-12`
- **Проблема:** sonner.tsx calls useTheme() from next-themes, but there is no ThemeProvider anywhere in src/ (grep returns nothing), so theme falls back to 'system'. The layout renders <Toaster richColors />. richColors makes sonner inject its built-in green/amber/red backgrounds for success/warning/error. The documented design system is fully monochrome (chroma=0) with only one sanctioned color (--destructive). So toasts are the single place the app shows status color — and they do it with sonner's off-palette greens/ambers that match nothing else, while every other surface (badges, alerts) is gray. This is incoherent: either status color is allowed everywhere or nowhere.
- **Влияние:** Resolves the app's most visible color-consistency contradiction and makes success/error feedback legible by design rather than by accident.
- **Рекомендация:** Decide the policy. Option A (consistency-first): drop richColors so toasts inherit --popover/--popover-foreground and stay monochrome, then differentiate success/error only by the icons already configured (CircleCheck/OctagonX). Option B (signal-first): keep richColors but treat toast color as the deliberate system signal and bring the same semantic accents to badges/alerts for status. Either way, decide and document; also remove the dead useTheme dependency or add the missing next-themes ThemeProvider.

### 🟠 P1 — Login error is rendered twice (Alert + FieldError bound to same string)

- **Категория:** `feedback-states` · **Объём:** S · **Где:** `src/components/auth/login-form.tsx:33-37,60`
- **Проблема:** When authentication fails, state.error is shown both in the destructive Alert at the top of the FieldGroup (lines 33-37) and again in <FieldError>{state.error}</FieldError> under the password field (line 60). The user sees the identical message 'Неверный логин или пароль' twice, which looks like a bug and adds visual noise to an otherwise minimal screen.
- **Влияние:** Removes a confusing double-error and tightens the only error state on the app's entry screen.
- **Рекомендация:** Pick one error surface. Preferred: keep the inline FieldError under the password field (it is closer to the input and is role=alert), drop the top Alert; OR keep the Alert as a form-level summary and remove the FieldError. If both are intentional, make them distinct (Alert = summary, FieldError = field-specific) rather than echoing the same string.

### 🟠 P1 — Inline field validation is effectively unused outside login; server errors surface only as toasts

- **Категория:** `feedback-states` · **Объём:** L · **Где:** `src/components/ui/field.tsx:176-225 (FieldError); usage grep: aria-invalid/FieldError concentrated in login-form, mostly static FieldDescription elsewhere (e.g. cash-page.tsx:480,874)`
- **Проблема:** The Field primitive supports rich per-field errors (FieldError with errors[] dedup, aria-invalid wiring, data-invalid=true coloring), but across modules these are barely used: cash-page's FieldDescription occurrences are static help text, not validation; deal/stock/users forms rely on server actions returning {ok,message} that get toasted. Result: when a save fails, the user sees a transient toast but the offending field is not highlighted, requires re-reading the whole form, and the message disappears. For fast counter work this causes repeated failed submits.
- **Влияние:** Turns failed submits from guess-and-retry into targeted corrections across every form-heavy module.
- **Рекомендация:** Adopt a consistent error pattern: have server actions return field-level messages (the action shape already returns message/messages?) and map them to per-Field FieldError + aria-invalid, mirroring login-form's data-invalid pattern. At minimum, persist the last error as a form-level Alert inside the dialog/sheet (not just a toast) so it does not vanish.

### 🟠 P1 — Calendar primitive is built but unused; all dates use raw native inputs with no Russian locale

- **Категория:** `forms-input` · **Объём:** L · **Где:** `src/components/ui/calendar.tsx:15-45 (defined, never rendered); usage: type="date" in cash-page.tsx, deal-detail-page.tsx, deals-kanban.tsx, stock-page.tsx, stock-document-form.tsx`
- **Проблема:** A grep shows <Calendar> is rendered nowhere in src/ — every date is picked through a bare <input type="date"> (6 occurrences across 5 modules). That means: (a) the date UI is the browser's, which on desktop Chrome shows mm/dd/yyyy or locale-dependent formatting and varies by OS; (b) no Russian month/weekday labels even though the whole app is lang="ru"; (c) no Popover+Calendar combobox pattern, so date entry is inconsistent with the polished Select/Command patterns; (d) the Calendar's locale prop is plumbed but never given date-fns ru locale.
- **Влияние:** Consistent, localized, touch-friendly date entry across cash/deals/stock instead of OS-dependent native widgets; unlocks the already-built primitive.
- **Рекомендация:** Standardize a DatePicker = Popover trigger (Button with CalendarDaysIcon, already imported in order-shared.tsx) + Calendar with locale={ru} from date-fns. Build it once in ui/ and replace the raw type="date" inputs. At minimum, set the Russian locale as the Calendar default so month/weekday names are localized.

### 🟠 P1 — AccessDenied always sends users to '/' and offers no way back or to switch account

- **Категория:** `navigation` · **Объём:** M · **Где:** `src/components/access-denied.tsx:12,24-26; src/app/login/page.tsx:9-11`
- **Проблема:** AccessDenied defaults homeHref to '/'. For a florist, '/' is the cash register they may not be allowed to use, and getDefaultPathForRole sends florists to /orders — so the 'На главную' button can dump a role onto a page they also cannot use, or a page that is not their landing. There is no 'назад' or 'войти под другой учётной записью' action, and no explanation of which role would be required.
- **Влияние:** Prevents dead-end/loop navigation for florists and clarifies the access model.
- **Рекомендация:** Have callers pass the role-appropriate landing (reuse getDefaultPathForRole) as homeHref, or compute it inside AccessDenied. Add a secondary 'Назад' action and optionally a logout link. Consider naming the required role in the CardDescription ('Раздел доступен только для роли «Управляющий»') so the user understands why.

### 🟠 P1 — No autofocus on the login field — extra click every shift change

- **Категория:** `workflow-efficiency` · **Объём:** S · **Где:** `src/components/auth/login-form.tsx:40-47`
- **Проблема:** The Логин input has no autoFocus. Florists/managers log in at the counter (often multiple times per day as shifts rotate); every login currently requires a mouse/tap to focus the field before typing. There is also no keyboard hint and the form has no onSubmit-on-Enter concern (form action handles that), but focus management is missing.
- **Влияние:** One fewer interaction per login, several times a day, for the busiest screen.
- **Рекомендация:** Add autoFocus to the Логин Input. Because the page is force-dynamic and the form is the only content, this is safe and saves a click on the most frequently visited screen.

### 🟡 P2 — Number/money/phone inputs lack inputMode and validation affordances at the primitive level

- **Категория:** `forms-input` · **Объём:** M · **Где:** `src/components/ui/input.tsx:6-17; usage: type="number" across cash-page.tsx (x7), deal-detail-page.tsx (x7), product-line-items.tsx, etc.`
- **Проблема:** The base Input is a thin wrapper with no helpers for the app's most common entries: money, quantities, and phone. type="number" is used widely (32 occurrences) but on tablets type="number" brings a numeric-but-not-decimal keypad in some browsers, allows the spinner and 'e'/'+'/'-' characters, and there is no money-formatting or currency adornment. Phone fields are plain text. There is no shared NumberInput/MoneyInput, so each module re-implements parsing.
- **Влияние:** Faster, less error-prone numeric entry on tablets; one source of truth for money/qty inputs.
- **Рекомендация:** Add small shared wrappers: a MoneyInput (InputGroup with a ₽ InputGroupText addon, inputMode="decimal") and a quantity input (inputMode="numeric"), and use inputMode="tel" + a mask for phone. Reuse pricing.ts for formatting. This standardizes the keypad and prevents invalid characters at the counter.

### 🟡 P2 — Select has no built-in search/empty state; Command exists but the two are not bridged into a combobox primitive

- **Категория:** `forms-input` · **Объём:** M · **Где:** `src/components/ui/select.tsx:59-96 (no search); src/components/ui/command.tsx (search list, but standalone)`
- **Проблема:** SelectContent renders a plain scrollable list with no filter input and no empty state. For long option sets (clients, products, suppliers) this forces scrolling. Command provides searchable lists with CommandEmpty, but there is no shared Combobox (Popover + Command) primitive, so each module that needs a searchable select must hand-assemble Popover+Command, leading to inconsistent behavior (some use Select, some use Command). There is no canonical 'searchable single-select' in ui/.
- **Влияние:** Consistent, searchable entity selection across cash/deals/stock instead of scroll-only selects or bespoke combos.
- **Рекомендация:** Add a Combobox primitive in ui/ composing Popover + Command + the input-group search style, with a documented CommandEmpty (e.g. 'Ничего не найдено'). Use Select only for short static enums (payment method, status) and Combobox for entity pickers (client/product/supplier). This removes ad-hoc assembly.

### 🟡 P2 — Password field has no show/hide toggle

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/auth/login-form.tsx:50-60`
- **Проблема:** The password is a plain masked Input with no reveal toggle. On a touchscreen at the counter, mistyped masked passwords are a common cause of failed logins, and the only feedback is the generic 'Неверный логин или пароль'. The InputGroup + InputGroupButton primitives already exist precisely for trailing affordances.
- **Влияние:** Fewer failed logins from typos on tablets; aligns login with the app's own input-group pattern.
- **Рекомендация:** Wrap the password Input in InputGroup with a trailing InputGroupButton (size icon-xs) toggling type between 'password' and 'text' using Eye/EyeOff lucide icons. Reuse the existing input-group primitive so it matches search/affordance patterns elsewhere.

### 🟡 P2 — AlertDialog footer puts the confirm action with no destructive emphasis by default

- **Категория:** `forms-input` · **Объём:** S · **Где:** `src/components/ui/alert-dialog.tsx:144-155 (AlertDialogAction default variant); 157-172 (Cancel)`
- **Проблема:** AlertDialogAction renders a default (primary, solid black) Button with no destructive styling, while Cancel is outline. For confirm dialogs guarding deletes/voids (the app has cash void, deal/stock deletions), the destructive action and a benign confirm look identical — both are solid primary. Given the monochrome theme, the only way to telegraph danger is the destructive variant (red), and it is not applied by default, so dangerous confirms read as neutral.
- **Влияние:** Makes irreversible confirmations visually distinct in a palette that otherwise can't signal danger.
- **Рекомендация:** Either default AlertDialogAction to variant="destructive" when used in delete contexts, or establish a convention/prop (e.g. tone="danger") and make callers pass it. At minimum, document that destructive confirms must set variant="destructive" so the one available danger color is actually used.

### 🟡 P2 — Login card is unbranded and uses a cryptic subtitle

- **Категория:** `visual-design` · **Объём:** S · **Где:** `src/components/auth/login-form.tsx:26-29; src/app/login/page.tsx:13-17`
- **Проблема:** The first impression is a title 'Вход' and a description 'FlowerBuro | sellz' — no logo, no product name as a heading, no welcoming context. The pipe-delimited vendor string reads like a metadata tag, not human copy. The page background is hardcoded bg-zinc-50 rather than the theme background token.
- **Влияние:** A trustworthy, branded first impression for staff and a cleaner tie to the design tokens.
- **Рекомендация:** Add a small product mark/logo above the card (the repo just added src/app/icon.png / apple-icon.png) and make the heading the product name ('Flower Buro') with a friendlier subtitle (e.g. 'Вход в систему магазина'). Use bg-background / theme tokens instead of bg-zinc-50 so it tracks the design system.

### ⚪ P3 — Login form hardcodes zinc colors instead of theme tokens, diverging from the token-driven primitives

- **Категория:** `consistency` · **Объём:** S · **Где:** `src/components/auth/login-form.tsx:25; src/app/login/page.tsx:14; src/components/access-denied.tsx:14-15`
- **Проблема:** LoginForm Card uses border-zinc-200 bg-white shadow-sm and the page wrappers use bg-zinc-50, while the rest of the system is increasingly token-based (bg-background, bg-card, border). This is the same hardcoded-zinc pattern seen inside input.tsx/select.tsx (border-zinc-300 etc.), so the divergence from --border/--card tokens is systemic. It means a future theme change (or a dark mode) will not propagate to login/access-denied.
- **Влияние:** Keeps entry screens on the design-token system and unblocks any future theme/dark-mode work.
- **Рекомендация:** Use semantic tokens: Card without the explicit zinc overrides (it already defaults to bg-card), and bg-background on the page main. Longer term, migrate the ui primitives' hardcoded zinc-300/zinc-500 to border/input/muted-foreground tokens so the monochrome palette is centrally controlled.

### ⚪ P3 — Generic 'Неверный логин или пароль' for empty fields hides which field is missing

- **Категория:** `content-copy` · **Объём:** S · **Где:** `src/app/auth-actions.ts:14-16; src/components/auth/login-form.tsx:38,49`
- **Проблема:** loginAction returns the same 'Неверный логин или пароль' whether the credentials are wrong OR a field is simply empty (lines 14-16). The form marks BOTH fields data-invalid on any error, so a user who left only the password blank sees both fields flagged and a 'wrong credentials' message. This is misleading for the most common slip (empty field).
- **Влияние:** Clearer recovery on the most frequent login slip without weakening the anti-enumeration message for real failures.
- **Рекомендация:** For the empty-field case return a distinct message ('Заполните логин и пароль') and, if feasible, flag only the empty field via per-field state. Keep the deliberately vague message for genuine auth failures (good for security). This also lets the form stop double-flagging fields.

**Quick wins:**

- Add autoFocus to the Логин field so a counter user can type immediately without clicking
- Remove the duplicate FieldError under the password field — the destructive Alert already shows the same string, so the error currently renders twice
- Add a show/hide password toggle using InputGroup + InputGroupButton (the primitive already exists)
- Wire a Russian locale (date-fns/locale/ru) into the Calendar default and/or replace raw type="date" inputs, and localize weekday/month names
- Reconcile Toaster richColors with the monochrome theme: either drop richColors (toasts go gray, consistent) or deliberately keep semantic toast colors and document them as the one sanctioned status color
- Give AccessDenied a 'Назад'/logout affordance and tailor the home link per role instead of always defaulting homeHref to '/'

---

