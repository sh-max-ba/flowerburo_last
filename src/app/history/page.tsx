import { BackofficeRoute } from "@/components/backoffice-route"

export const dynamic = "force-dynamic"

export default async function HistoryPage() {
  return <BackofficeRoute section="history" />
}
