import { NextResponse, after, type NextRequest } from "next/server"
import {
  createWazzupEventHash,
  detectWazzupEventType,
  isWazzupWebhookAuthorized,
  markWazzupWebhookEvent,
  processWazzupWebhook,
  saveWazzupWebhookEvent,
} from "@/lib/wazzup-webhook"
import {
  buildWazzupContactEntity,
  buildWazzupDealEntity,
  getWazzupSettingsForServer,
  syncWazzupWebhookEntities,
} from "@/lib/wazzup"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "no-store",
}

const MAX_WEBHOOK_BODY_BYTES = 1_000_000

export async function POST(request: NextRequest) {
  // Авторизация ДО чтения и записи тела: неавторизованный запрос ничего не пишет в БД.
  const auth = isWazzupWebhookAuthorized({
    authorization: request.headers.get("authorization"),
    queryKey: request.nextUrl.searchParams.get("key") ?? request.nextUrl.searchParams.get("crmKey"),
  })

  if (!auth.authorized) {
    console.info("Wazzup webhook rejected", {
      hasAuthorization: auth.hasAuthorization,
      authMethod: auth.method,
      error: auth.error,
    })
    return json({ ok: false }, 401)
  }

  // Раннее отсечение по Content-Length — чтобы не буферизировать огромное тело в память.
  const declaredLength = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return json({ ok: false, error: "payload_too_large" }, 413)
  }

  const rawPayload = await request.text()
  if (rawPayload.length > MAX_WEBHOOK_BODY_BYTES) {
    return json({ ok: false, error: "payload_too_large" }, 413)
  }

  const payload = parseJson(rawPayload)
  if (!payload.ok) {
    return json({ ok: false, error: "invalid_json" }, 400)
  }

  const eventType = detectWazzupEventType(payload.value)
  const eventHash = createWazzupEventHash(payload.value)
  const saved = saveWazzupWebhookEvent({ eventHash, eventType, rawPayload })

  logWebhookDecision({
    request,
    payload: payload.value,
    eventType,
    duplicate: saved.duplicate,
    statusDecision: "accepted",
    auth,
  })

  if (eventType === "test") {
    if (!saved.duplicate && saved.eventId) {
      markWazzupWebhookEvent(saved.eventId, "processed", auth.warning)
    }
    return json({ ok: true })
  }

  const settings = getWazzupSettingsForServer()
  // Настоящий дубль (прошлая попытка успешно обработана/проигнорирована) → 200.
  // Если прошлая попытка осталась 'received'/'failed' (упала на временной ошибке) — НЕ
  // отбрасываем, а даём переобработать ниже, чтобы входящее сообщение не потерялось.
  if (saved.duplicate && (saved.status === "processed" || saved.status === "ignored")) {
    return json({ ok: true, duplicate: true })
  }

  if (!settings.isEnabled) {
    markWazzupWebhookEvent(saved.eventId!, "ignored", "Wazzup integration disabled")
    return json({ ok: true, ignored: true })
  }

  try {
    const result = processWazzupWebhook(payload.value)
    markWazzupWebhookEvent(saved.eventId!, eventType === "unknown" ? "ignored" : "processed", auth.warning)
    // Отвечаем 200 сразу (входящее уже сохранено в БД), а обратную синхронизацию контактов/
    // сделок в Wazzup выполняем ПОСЛЕ ответа — чтобы медленный Wazzup не задерживал
    // подтверждение вебхука (иначе Wazzup посчитает доставку неуспешной и будет ретраить).
    after(() => syncWazzupWebhookEntities(result))
    // createContact/createDeal — синхронный server-to-server handshake: Wazzup ждёт тело созданной
    // сущности (в сигнатуре CRUD), а не {ok}, чтобы связать свою сторону с записью CRM. Повторный
    // вебхук уже не придёт, поэтому ответить телом важно с первого раза.
    if (eventType === "createContact" && result.contactId) {
      const entity = buildWazzupContactEntity(result.contactId)
      if (entity) {
        return json(entity)
      }
    }
    if (eventType === "createDeal" && result.dealId) {
      const entity = buildWazzupDealEntity(result.dealId)
      if (entity) {
        return json(entity)
      }
    }
    return json({ ok: true, ...result })
  } catch (error) {
    markWazzupWebhookEvent(
      saved.eventId!,
      "failed",
      error instanceof Error ? error.message : "Webhook processing failed"
    )
    // 500 (а не 200): Wazzup повторит доставку; событие осталось 'failed' и будет пущено на
    // переобработку (см. дедуп выше) — временная ошибка БД не теряет входящее сообщение.
    return json({ ok: false, error: "processing_failed" }, 500)
  }
}

function logWebhookDecision(input: {
  request: NextRequest
  payload: unknown
  eventType: string
  duplicate: boolean
  statusDecision: string
  auth: { method: string; hasAuthorization: boolean; required: boolean; warning?: string; error?: string }
}) {
  const body = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
    ? (input.payload as Record<string, unknown>)
    : {}
  console.info("Wazzup webhook received", {
    method: input.request.method,
    hasAuthorization: input.auth.hasAuthorization,
    contentType: input.request.headers.get("content-type") ?? "",
    bodyKeys: Object.keys(body).slice(0, 12),
    eventType: input.eventType,
    duplicate: input.duplicate,
    authMethod: input.auth.method,
    authRequired: input.auth.required,
    statusDecision: input.statusDecision,
    warning: input.auth.warning,
    error: input.auth.error,
  })
}

function parseJson(rawPayload: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(rawPayload) }
  } catch {
    return { ok: false }
  }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: noStoreHeaders,
  })
}
