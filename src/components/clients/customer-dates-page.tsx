"use client"

import type React from "react"
import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarRangeIcon, ChevronRightIcon, MessageCircleIcon, PhoneIcon } from "lucide-react"
import {
  DATES_WINDOW_OPTIONS as windowOptions,
  DEFAULT_DATES_WINDOW,
  formatDayMonth,
  formatYears,
  type DatesWindow,
  type UpcomingCustomerDate,
} from "@/lib/customer-dates"
import { cn } from "@/lib/utils"
import { ClientsTabs } from "@/components/clients/clients-tabs"
import { telLink } from "@/components/clients/customers-page"
import { DaysLeftPill } from "@/components/customers/customer-dates"
import { FloristMark } from "@/components/florist-mark"
import { DataView, type DataViewColumn } from "@/components/data-view"
import { ScreenBody } from "@/components/screen-body"
import { HeaderFilter, ScreenHeader } from "@/components/screen-header"
import { buttonVariants } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// «Клиенты → Даты»: дни рождения и годовщины клиентов по порядку наступления — рабочий список
// «кого поздравить». Окно — в URL (?days=0|7|30|90|all), поиск по клиенту и поводу — на месте.

export function CustomerDatesPage({
  dates,
  window,
  weekCount,
}: {
  dates: UpcomingCustomerDate[]
  window: DatesWindow
  weekCount: number
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [windowPending, startWindowTransition] = useTransition()

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return dates
    }
    const digits = query.replace(/\D/g, "")
    return dates.filter(
      (date) =>
        date.customerName.toLowerCase().includes(query) ||
        date.title.toLowerCase().includes(query) ||
        date.note.toLowerCase().includes(query) ||
        (digits.length > 0 && date.customerPhone.replace(/\D/g, "").includes(digits))
    )
  }, [dates, search])

  function changeWindow(next: DatesWindow) {
    startWindowTransition(() => {
      router.push(next === DEFAULT_DATES_WINDOW ? "/clients?view=dates" : `/clients?view=dates&days=${next}`)
    })
  }

  const windowLabel = windowOptions.find((option) => option.value === window)?.label.toLowerCase() ?? ""
  const countLabel = search.trim()
    ? `найдено ${visible.length}`
    : window === "all"
      ? `${visible.length} ${plural(visible.length, DATES)}`
      : `${visible.length} ${plural(visible.length, DATES)} · ${window === "0" ? "сегодня" : windowLabel}`

  return (
    <>
      <ScreenHeader
        title="Важные даты клиентов"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Поиск по клиенту или поводу",
          pending: windowPending,
          inputProps: { "aria-label": "Поиск по датам" },
        }}
        meta={countLabel}
        actions={
          <HeaderFilter
            icon={CalendarRangeIcon}
            label="Период"
            value={window}
            allValue={DEFAULT_DATES_WINDOW}
            options={windowOptions}
            onValueChange={changeWindow}
          />
        }
        tabs={<ClientsTabs value="dates" weekCount={weekCount} />}
      />

      <ScreenBody>
        <DataView
          rows={visible}
          columns={dateColumns}
          getRowKey={(date) => date.id}
          onRowSelect={(date) => router.push(`/clients/${date.customerId}`)}
          rowActions={(date) => <DateRowActions date={date} />}
          renderCard={(date) => <DateCardRow date={date} />}
          empty={
            <Empty className="min-h-56">
              <EmptyHeader>
                <EmptyTitle>{search.trim() ? "Ничего не найдено" : "Дат в этом периоде нет"}</EmptyTitle>
                <EmptyDescription>
                  {search.trim()
                    ? "Измените поисковый запрос."
                    : "Дни рождения и годовщины добавляются в карточке клиента — блок «Важные даты». Выберите период длиннее, чтобы увидеть больше."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
        />
      </ScreenBody>
    </>
  )
}

// Колонки: дата с «через N дней», клиент, повод (заметка — второй строкой под ним). Телефон —
// в действиях строки («Позвонить»), чтобы таблица помещалась в планшет без прокрутки вбок.
const dateColumns: DataViewColumn<UpcomingCustomerDate>[] = [
  {
    key: "when",
    header: "Когда",
    // Узкий контейнер (планшет в портрете): дата над «через N дней», чтобы оставить место поводу.
    className: "w-32 tabular-nums @4xl/dataview:w-44",
    sortValue: (date) => date.daysLeft,
    cell: (date) => (
      <span className="flex flex-col items-start gap-0.5 whitespace-nowrap @4xl/dataview:flex-row @4xl/dataview:items-center @4xl/dataview:gap-2">
        <span className="text-foreground @4xl/dataview:w-14">{shortDayMonth(date)}</span>
        <DaysLeftPill daysLeft={date.daysLeft} className="-ml-2 @4xl/dataview:ml-0" />
      </span>
    ),
  },
  {
    key: "customer",
    header: "Клиент",
    className: "w-40 @4xl/dataview:w-52 @5xl/dataview:w-64",
    sortValue: (date) => date.customerName,
    cell: (date) => (
      <Link
        href={`/clients/${date.customerId}`}
        className="block max-w-40 truncate font-medium text-foreground hover:underline @4xl/dataview:max-w-52 @5xl/dataview:max-w-64"
      >
        {date.customerName}
      </Link>
    ),
  },
  {
    key: "title",
    header: "Повод",
    grow: true,
    sortValue: (date) => date.title,
    cell: (date) => (
      <span className="block min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-12 truncate">{date.title}</span>
          {date.turns ? <span className="shrink-0 text-muted-foreground tabular-nums">· {formatYears(date.turns)}</span> : null}
          <FloristMark role={date.createdByRole} name={date.createdByName} action="Добавил" compact />
        </span>
        {date.note ? (
          <span className="block truncate text-xs text-muted-foreground" title={date.note}>
            {date.note}
          </span>
        ) : null}
      </span>
    ),
  },
]

// Действия строки: написать в чат (главное — поздравить), позвонить, открыть карточку.
function DateRowActions({ date }: { date: UpcomingCustomerDate }) {
  const chatHref = date.hasChat || date.customerPhone ? `/chats?customer=${date.customerId}` : null
  const telHref = telLink(date.customerPhone)
  return (
    <>
      {chatHref ? (
        <IconAction href={chatHref} label="Написать в чат">
          <MessageCircleIcon className="size-4" />
        </IconAction>
      ) : null}
      {telHref ? (
        <IconAction href={telHref} label="Позвонить" native>
          <PhoneIcon className="size-4" />
        </IconAction>
      ) : null}
      <IconAction href={`/clients/${date.customerId}`} label="Открыть карточку">
        <ChevronRightIcon className="size-4" />
      </IconAction>
    </>
  )
}

// Карточка строки до md: клиент, повод и дата, «через N дней» справа, действия.
function DateCardRow({ date }: { date: UpcomingCustomerDate }) {
  const chatHref = date.hasChat || date.customerPhone ? `/chats?customer=${date.customerId}` : null
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <Link href={`/clients/${date.customerId}`} className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{date.customerName}</span>
          <DaysLeftPill daysLeft={date.daysLeft} />
        </div>
        <div className="mt-0.5 truncate text-sm text-muted-foreground">
          {[date.title, formatDayMonth(date.day, date.month), date.turns ? formatYears(date.turns) : ""]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {date.note ? <div className="mt-0.5 truncate text-xs text-zinc-600">{date.note}</div> : null}
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        {chatHref ? (
          <IconAction href={chatHref} label="Написать в чат">
            <MessageCircleIcon className="size-4" />
          </IconAction>
        ) : null}
      </div>
    </div>
  )
}

function IconAction({
  href,
  label,
  native = false,
  children,
}: {
  href: string
  label: string
  // tel: — обычная ссылка, а не переход Next.
  native?: boolean
  children: React.ReactNode
}) {
  const className = cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "size-9 text-muted-foreground pointer-coarse:size-11")
  return (
    <Tooltip>
      <TooltipTrigger render={native ? <a href={href} className={className} /> : <Link href={href} className={className} />}>
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const SHORT_MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

// «3 окт» — компактно для колонки «Когда».
function shortDayMonth(date: { day: number; nextDate: string }) {
  const month = Number(date.nextDate.slice(5, 7))
  return `${Number(date.nextDate.slice(8, 10))} ${SHORT_MONTHS[month - 1] ?? ""}`
}

const DATES: [string, string, string] = ["дата", "даты", "дат"]

function plural(count: number, [one, few, many]: [string, string, string]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
