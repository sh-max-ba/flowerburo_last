import { BackofficeRoute } from "@/components/backoffice-route"

export const dynamic = "force-dynamic"

export default async function StockPage() {
  return <BackofficeRoute section="stock" />
}
