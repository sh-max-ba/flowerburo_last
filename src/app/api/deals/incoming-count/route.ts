import { getCurrentUser } from "@/lib/auth"
import { initDb } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ count: 0 }, { status: 401, headers: noStoreHeaders })
  }

  if (user.role === "florist") {
    return Response.json({ count: 0 }, { headers: noStoreHeaders })
  }

  const client = initDb()
  const row = client
    .prepare(
      `WITH default_pipeline AS (
        SELECT id
        FROM deal_pipelines
        ORDER BY is_default DESC, id ASC
        LIMIT 1
       ),
       first_stage AS (
        SELECT deal_stages.id
        FROM deal_stages
        WHERE deal_stages.pipeline_id = (SELECT id FROM default_pipeline)
        ORDER BY deal_stages.position ASC, deal_stages.id ASC
        LIMIT 1
       )
       SELECT COUNT(*) as count
       FROM deals
       LEFT JOIN deal_stages ON deal_stages.id = deals.stage_id
       -- «Входящая» = сделка, привязанная к чату (вебхук всегда проставляет wazzup_chat_id);
       -- фильтр по source ловил только личный WhatsApp и терял whatsgroup/telegram/instagram.
       WHERE COALESCE(deals.wazzup_chat_id, '') != ''
        AND deals.status = 'open'
        AND deals.order_id IS NULL
        AND COALESCE(deal_stages.is_closed, 0) != 1
        AND COALESCE(deal_stages.is_won, 0) != 1
        AND (
          deals.stage_id = (SELECT id FROM first_stage)
          OR LOWER(COALESCE(deal_stages.name, '')) = 'новая'
        )`
    )
    .get() as { count: number } | undefined

  // Ревизия доски для DealsAutoRefresh: меняется при ЛЮБОМ изменении сделок (новая заявка,
  // входящее сообщение в открытую сделку, смена этапа, правка карточки) — бейджу в сайдбаре
  // по-прежнему нужен только count «входящих».
  const revisionRow = client
    .prepare(
      `SELECT COUNT(*) as total, COALESCE(MAX(id), 0) as maxId, COALESCE(MAX(updated_at), '') as maxUpdatedAt
       FROM deals`
    )
    .get() as { total: number; maxId: number; maxUpdatedAt: string } | undefined

  return Response.json(
    {
      count: Number(row?.count ?? 0),
      revision: `${Number(row?.count ?? 0)}:${revisionRow?.total ?? 0}:${revisionRow?.maxId ?? 0}:${revisionRow?.maxUpdatedAt ?? ""}`,
    },
    { headers: noStoreHeaders }
  )
}

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
}
