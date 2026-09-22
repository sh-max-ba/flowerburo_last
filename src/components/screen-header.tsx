"use client"

import type React from "react"
import { createContext, useContext, useId } from "react"
import Link from "next/link"
import { SearchIcon, XIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Оболочка (CrmShell) отдаёт шапке экрана то, что знает только она: чип смены + звук
// (leading поля на рабочих экранах) и вкладки раздела (Склад: Товары/Остатки/…).
// Страница может переопределить вкладки своими (tabs) — тогда вкладки раздела не рисуются.
export type ScreenChrome = {
  leading: React.ReactNode
  tabs: React.ReactNode
  // "inline" — вкладки в первой строке справа (~30%); "row" — отдельной строкой на всю ширину
  // (когда вкладок много, как у «Склада»).
  tabsPlacement: "inline" | "row"
}

const ScreenChromeContext = createContext<ScreenChrome>({ leading: null, tabs: null, tabsPlacement: "inline" })

export const ScreenChromeProvider = ScreenChromeContext.Provider

export function useScreenChrome() {
  return useContext(ScreenChromeContext)
}

export type ScreenSearch = {
  value: string
  onChange: (value: string) => void
  placeholder: string
  autoFocus?: boolean
  // Ищем на сервере — показываем состояние ожидания вместо счётчика.
  pending?: boolean
  inputProps?: Omit<React.ComponentProps<"input">, "value" | "onChange" | "placeholder" | "className">
}

type ScreenHeaderProps = {
  // Заголовок страницы только для скринридера — раздел уже подсвечен в меню слева.
  title: string
  search?: ScreenSearch
  // Своё поле вместо стандартного инпута (напр. поиск товара на кассе). Должно рендерить
  // прозрачный инпут без рамки — обёртка-«таблетка» даёт фон, высоту и фокус.
  searchSlot?: React.ReactNode
  // Дополнительный leading после чипа смены (напр. кнопка «назад»).
  leading?: React.ReactNode
  // Кнопки действий у правого края поля: ghost, 40px, серые. Второстепенные фильтры — тоже сюда.
  actions?: React.ReactNode
  // Главное действие экрана — единственная залитая кнопка, крайняя справа.
  primaryAction?: React.ReactNode
  // Вкладки первого уровня (~30% ширины). undefined → вкладки раздела из оболочки; null → без вкладок.
  tabs?: React.ReactNode
  // Куда класть вкладки: в строку поиска (inline) или отдельной строкой (row). По умолчанию —
  // как решила оболочка для вкладок раздела, иначе inline.
  tabsPlacement?: "inline" | "row"
  // Короткая подпись справа в поле (напр. «142 в списке») — обычный текст, не бейдж.
  meta?: React.ReactNode
  className?: string
}

// Единственная карточка-шапка экрана вместо трёх полос: первая строка — поле поиска (~70%)
// с кнопками внутри и вкладки (~30%); ниже lg вкладки уходят второй строкой.
export function ScreenHeader({
  title,
  search,
  searchSlot,
  leading,
  actions,
  primaryAction,
  tabs,
  tabsPlacement,
  meta,
  className,
}: ScreenHeaderProps) {
  const chrome = useScreenChrome()
  const inputId = useId()
  const resolvedTabs = tabs === undefined ? chrome.tabs : tabs
  const placement = tabsPlacement ?? (tabs === undefined ? chrome.tabsPlacement : "inline")
  const inlineTabs = resolvedTabs && placement === "inline" ? resolvedTabs : null
  const rowTabs = resolvedTabs && placement === "row" ? resolvedTabs : null
  const hasSearch = Boolean(search) || Boolean(searchSlot)
  const hasLeading = Boolean(chrome.leading) || Boolean(leading)
  // Шапка только из вкладок (напр. настройки): строку поля не рисуем вовсе.
  const hasBar = hasSearch || hasLeading || Boolean(actions) || Boolean(primaryAction) || Boolean(meta)

  return (
    <header
      data-slot="screen-header"
      className={cn("@container/screen shrink-0 rounded-2xl border border-border/65 bg-background p-3", className)}
    >
      <h1 className="sr-only">{title}</h1>
      <div
        className={cn(
          "grid gap-2",
          inlineTabs && hasBar
            ? "@3xl/screen:grid-cols-[minmax(0,7fr)_minmax(max-content,3fr)] @3xl/screen:items-center"
            : "grid-cols-1"
        )}
      >
        {hasBar ? (
        <div
          data-search={hasSearch ? "" : undefined}
          className={cn(
            "flex h-12 min-w-0 items-center gap-1 rounded-xl border border-transparent pl-1 pr-1 transition-colors",
            hasSearch &&
              "bg-muted/55 focus-within:border-ring/50 focus-within:bg-background focus-within:ring-3 focus-within:ring-ring/15"
          )}
        >
          {hasLeading ? (
            <div className="flex shrink-0 items-center gap-0.5">
              {chrome.leading}
              {leading}
            </div>
          ) : null}
          {search ? (
            <>
              <label htmlFor={inputId} className="sr-only">
                {search.placeholder}
              </label>
              <SearchIcon
                className={cn(
                  "size-4 shrink-0 text-muted-foreground",
                  hasLeading ? "ml-1" : "ml-2"
                )}
                aria-hidden
              />
              <input
                id={inputId}
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                autoFocus={search.autoFocus}
                value={search.value}
                placeholder={search.placeholder}
                onChange={(event) => search.onChange(event.target.value)}
                className="h-full min-w-24 flex-1 bg-transparent px-2 text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-sm [&::-webkit-search-cancel-button]:hidden"
                {...search.inputProps}
              />
              {search.value ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => search.onChange("")}
                  aria-label="Очистить поиск"
                >
                  <XIcon />
                </Button>
              ) : null}
            </>
          ) : searchSlot ? (
            <div className="flex h-full min-w-0 flex-1 items-center">{searchSlot}</div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          {meta || search?.pending ? (
            <span className="hidden shrink-0 px-2 text-xs text-muted-foreground tabular-nums @3xl/screen:inline">
              {search?.pending ? "Поиск…" : meta}
            </span>
          ) : null}
          {actions || primaryAction ? (
            <div className="flex shrink-0 items-center gap-1">
              {actions}
              {primaryAction}
            </div>
          ) : null}
        </div>
        ) : null}
        {inlineTabs ? (
          <div className={cn("flex min-w-0", hasBar && "@3xl/screen:justify-end")}>{inlineTabs}</div>
        ) : null}
        {rowTabs ? <div className="flex min-w-0">{rowTabs}</div> : null}
      </div>
    </header>
  )
}

type HeaderActionProps = {
  icon: LucideIcon
  label: string
  href?: string
  onClick?: () => void
  disabled?: boolean
  // Подсветка «фильтр активен» / «вид выбран».
  active?: boolean
  // Всегда показывать подпись (по умолчанию — только с lg, на планшете остаётся иконка).
  alwaysLabel?: boolean
  className?: string
}

// Кнопка действия внутри поля: ghost, 40px, серая, без обводки. Подпись видна только в
// широкой шапке (контейнер ≥ @5xl = 1024px: lg+ со свёрнутым сайдбаром или xl+) — на планшете
// и при полном сайдбаре на lg остаётся иконка с aria-label/title.
export function HeaderAction({
  icon: Icon,
  label,
  href,
  onClick,
  disabled,
  active = false,
  alwaysLabel = false,
  className,
}: HeaderActionProps) {
  const classes = cn(
    buttonVariants({ variant: "ghost" }),
    "h-10 min-w-10 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground",
    active && "bg-muted text-foreground",
    className
  )
  const content = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className={alwaysLabel ? "inline" : "hidden @5xl/screen:inline"}>{label}</span>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={classes} aria-label={label} title={label}>
        {content}
      </Link>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className={classes}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {content}
    </Button>
  )
}

type HeaderPrimaryActionProps = {
  icon: LucideIcon
  label: string
  href?: string
  onClick?: () => void
  disabled?: boolean
  className?: string
}

// Главное действие экрана: единственная залитая кнопка, крайняя справа в поле.
export function HeaderPrimaryAction({
  icon: Icon,
  label,
  href,
  onClick,
  disabled,
  className,
}: HeaderPrimaryActionProps) {
  const classes = cn(buttonVariants({ variant: "default" }), "h-10 gap-1.5 px-3 pl-2.5", className)
  const content = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="hidden @4xl/screen:inline">{label}</span>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={classes} aria-label={label} title={label}>
        {content}
      </Link>
    )
  }

  return (
    <Button type="button" className={classes} onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {content}
    </Button>
  )
}

export type HeaderFilterOption<V extends string = string> = { value: V; label: string }

type HeaderFilterProps<V extends string> = {
  icon: LucideIcon
  label: string
  value: V
  // Значение «без фильтра» — при нём кнопка не подсвечена и подпись = label.
  allValue: V
  options: HeaderFilterOption<V>[]
  onValueChange: (value: V) => void
  disabled?: boolean
}

// Второстепенный фильтр (ответственный, источник, сортировка) — кнопка внутри поля с меню,
// вместо отдельного селекта. При выбранном значении показывает его как подпись.
export function HeaderFilter<V extends string>({
  icon: Icon,
  label,
  value,
  allValue,
  options,
  onValueChange,
  disabled,
}: HeaderFilterProps<V>) {
  const active = value !== allValue
  const current = options.find((option) => option.value === value)
  const caption = active && current ? current.label : label

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-10 min-w-10 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground",
              active && "bg-muted text-foreground"
            )}
            disabled={disabled}
            aria-label={active ? `${label}: ${caption}` : label}
            title={active ? `${label}: ${caption}` : label}
          />
        }
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="hidden max-w-36 truncate @5xl/screen:inline">{caption}</span>
        {active ? (
          <span className="size-1.5 shrink-0 rounded-full bg-foreground @5xl/screen:hidden" aria-hidden />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Base UI: подпись группы обязана быть внутри Group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => onValueChange(next as V)}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type HeaderSegmentProps<V extends string> = {
  value: V
  options: Array<{ value: V; label: string; icon: LucideIcon }>
  onValueChange: (value: V) => void
  label: string
}

// Переключатель вида (Список/Календарь) внутри поля — пара иконок-кнопок, активная с заливкой.
export function HeaderSegment<V extends string>({ value, options, onValueChange, label }: HeaderSegmentProps<V>) {
  return (
    <div role="group" aria-label={label} className="flex items-center">
      {options.map((option) => {
        const Icon = option.icon
        const active = option.value === value
        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            size="icon-lg"
            className={cn("size-10 text-muted-foreground hover:text-foreground", active && "bg-muted text-foreground")}
            aria-pressed={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => onValueChange(option.value)}
          >
            <Icon className="size-4" aria-hidden />
          </Button>
        )
      })}
    </div>
  )
}

type HeaderPopoverProps = {
  icon: LucideIcon
  label: string
  // Подсветка «фильтры заданы»; count — сколько (в подписи).
  active?: boolean
  count?: number
  align?: "start" | "end"
  className?: string
  children: React.ReactNode
}

// Кнопка внутри поля, раскрывающая поповер с произвольными фильтрами (период, сумма, поставщик…).
export function HeaderPopover({ icon: Icon, label, active = false, count, align = "end", className, children }: HeaderPopoverProps) {
  const caption = active && count ? `${label} · ${count}` : label

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-10 min-w-10 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground",
              active && "bg-muted text-foreground"
            )}
            aria-label={caption}
            title={caption}
          />
        }
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="hidden @5xl/screen:inline">{caption}</span>
        {active ? <span className="size-1.5 shrink-0 rounded-full bg-foreground @5xl/screen:hidden" aria-hidden /> : null}
      </PopoverTrigger>
      <PopoverContent align={align} className={cn("w-80 p-4", className)}>
        {children}
      </PopoverContent>
    </Popover>
  )
}

type FilterChipsProps<V extends string> = {
  label?: string
  value: V
  options: Array<{ value: V; label: string; count?: number }>
  onValueChange: (value: V) => void
  className?: string
}

// Второй уровень фильтров внутри контента: ряд чипов без рамок, активный — заливкой.
export function FilterChips<V extends string>({ label, value, options, onValueChange, className }: FilterChipsProps<V>) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1", className)} role="group" aria-label={label}>
      {label ? (
        <span className="mr-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      ) : null}
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/35 pointer-coarse:h-9",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            {option.label}
            {option.count ? <span className="text-xs text-muted-foreground tabular-nums">{option.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
