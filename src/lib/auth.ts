import crypto from "node:crypto"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import {
  createSessionRecord,
  deleteSessionRecord,
  getShiftAccessInfo,
  getUserByLogin,
  getUserBySessionToken,
  userHasOpenNightShift,
  type CurrentUser,
  type UserRole,
} from "@/lib/db"
import { hashPassword, verifyPassword } from "@/lib/password"

const SESSION_COOKIE = "flower_ops_session"
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7

export { hashPassword, verifyPassword }

export function getDefaultPathForRole(role: UserRole) {
  if (role === "florist") {
    return "/orders"
  }

  return "/cash"
}

export async function createSession(userId: number) {
  const token = crypto.randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  createSessionRecord(userId, token, expiresAt)

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  })

  return token
}

export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) {
    return null
  }

  return getUserBySessionToken(token)
}

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }

  return user
}

export async function requireRole(roles: UserRole[]) {
  const user = await requireUser()
  if (!roles.includes(user.role)) {
    throw new Error("Недостаточно прав.")
  }

  return user
}

export async function authenticate(login: string, password: string) {
  const user = getUserByLogin(login)
  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    return null
  }

  await createSession(user.id)

  return user
}

export async function logout() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value

  if (token) {
    deleteSessionRecord(token)
  }

  cookieStore.delete(SESSION_COOKIE)
  redirect("/login")
}

export async function canUseCash(user: CurrentUser) {
  if (user.role === "owner" || user.role === "manager") {
    return true
  }

  return user.role === "florist" && userHasOpenNightShift(user.id)
}

export function canCloseShift(user: CurrentUser, shiftId: number) {
  const shift = getShiftAccessInfo(shiftId)
  if (!shift || shift.status !== "open") {
    return false
  }

  if (user.role === "owner") {
    return true
  }

  if (user.role === "manager") {
    return shift.type === "night" || (shift.type === "day" && shift.userId === user.id)
  }

  return shift.type === "night" && shift.userId === user.id
}
