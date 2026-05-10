import Link from "next/link"
import { ShieldAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function AccessDenied({ homeHref = "/" }: { homeHref?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-8">
      <Card className="w-full max-w-md border bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlertIcon data-icon="inline-start" />
            Нет доступа
          </CardTitle>
          <CardDescription>У вашей роли нет прав на этот раздел.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link href={homeHref} />} className="w-full">
            На главную
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
