import { BackofficeRoute } from "@/components/backoffice-route"

export const dynamic = "force-dynamic"

export default async function CashPage() {
  return <BackofficeRoute section="sales" />
}
