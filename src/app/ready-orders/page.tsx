import { BackofficeRoute } from "@/components/backoffice-route"

export const dynamic = "force-dynamic"

export default async function ReadyOrdersPage() {
  return <BackofficeRoute section="ready-orders" />
}
