"use server"

import { redirect } from "next/navigation"
import { authenticate, getDefaultPathForRole, logout } from "@/lib/auth"

export type LoginState = {
  error?: string
}

export async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const login = String(formData.get("login") ?? "").trim()
  const password = String(formData.get("password") ?? "")

  if (!login || !password) {
    return { error: "Неверный логин или пароль" }
  }

  const user = await authenticate(login, password)
  if (!user) {
    return { error: "Неверный логин или пароль" }
  }

  redirect(getDefaultPathForRole(user.role))
}

export async function logoutAction() {
  await logout()
}
