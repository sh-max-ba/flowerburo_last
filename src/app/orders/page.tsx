import { BackofficeRoute } from "@/components/backoffice-route"

export const dynamic = "force-dynamic"

export default async function OrdersPage() {
  return <BackofficeRoute section="orders" />
}
