import { redirect } from "next/navigation"
import { LoginForm } from "@/components/auth/login-form"
import { getCurrentUser, getDefaultPathForRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  const user = await getCurrentUser()
  if (user) {
    redirect(getDefaultPathForRole(user.role))
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <LoginForm />
    </main>
  )
}
