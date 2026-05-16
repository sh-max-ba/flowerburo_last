import { NextResponse, type NextRequest } from "next/server"
import {
  createWazzupEventHash,
  detectWazzupEventType,
  isWazzupWebhookAuthorized,
  markWazzupWebhookEvent,
  processWazzupWebhook,
  saveWazzupWebhookEvent,
} from "@/lib/wazzup-webhook"
import { getWazzupSettingsForServer, syncWazzupWebhookEntities } from "@/lib/wazzup"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "no-store",
}

export async function POST(request: NextRequest) {
  const rawPayload = await request.text()
  const payload = parseJson(rawPayload)
  if (!payload.ok) {
    return json({ ok: false, error: "invalid_json" }, 400)
  }

  const eventType = detectWazzupEventType(payload.value)
  const eventHash = createWazzupEventHash(payload.value)
  const saved = saveWazzupWebhookEvent({ eventHash, eventType, rawPayload })
  const auth = isWazzupWebhookAuthorized({
    authorization: request.headers.get("authorization"),
    queryKey: request.nextUrl.searchParams.get("key") ?? request.nextUrl.searchParams.get("crmKey"),
  })

  logWebhookDecision({
    request,
    payload: payload.value,
    eventType,
    duplicate: saved.duplicate,
    statusDecision: auth.authorized ? "accepted" : "unauthorized",
    auth,
  })

  if (eventType === "test") {
    if (!saved.duplicate && saved.eventId) {
      markWazzupWebhookEvent(saved.eventId, "processed", auth.warning)
    }
    return json({ ok: true })
  }

  if (!auth.authorized) {
    if (!saved.duplicate && saved.eventId) {
      markWazzupWebhookEvent(saved.eventId, "failed", auth.error)
    }
    return json({ ok: false }, 401)
  }

  const settings = getWazzupSettingsForServer()
  if (saved.duplicate) {
    return json({ ok: true, duplicate: true })
  }

  if (!settings.isEnabled) {
    markWazzupWebhookEvent(saved.eventId!, "ignored", "Wazzup integration disabled")
    return json({ ok: true, ignored: true })
  }

  try {
    const result = processWazzupWebhook(payload.value)
    await syncWazzupWebhookEntities(result)
    markWazzupWebhookEvent(saved.eventId!, eventType === "unknown" ? "ignored" : "processed", auth.warning)
    return json({ ok: true, ...result })
  } catch (error) {
    markWazzupWebhookEvent(
      saved.eventId!,
      "failed",
      error instanceof Error ? error.message : "Webhook processing failed"
    )
    return json({ ok: false, error: "processing_failed" })
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
