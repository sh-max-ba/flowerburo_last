import crypto from "node:crypto"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import {
  createSessionRecord,
  deleteSessionRecord,
  getCurrentUserById,
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
const SIGNED_SESSION_VERSION = "v2"

export { hashPassword, verifyPassword }

export function getDefaultPathForRole(role: UserRole) {
  if (role === "florist") {
    return "/orders"
  }

  return "/cash"
}

export async function createSession(userId: number) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const token = createSignedSessionToken(userId, expiresAt)

  createSessionRecord(userId, token, expiresAt)

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await shouldUseSecureSessionCookie(),
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

  const signedSession = verifySignedSessionToken(token)
  if (signedSession) {
    return getCurrentUserById(signedSession.userId)
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

function createSignedSessionToken(userId: number, expiresAt: Date) {
  const expires = String(expiresAt.getTime())
  const nonce = crypto.randomBytes(16).toString("hex")
  const payload = `${SIGNED_SESSION_VERSION}.${userId}.${expires}.${nonce}`
  const signature = signSessionPayload(payload)

  return `${payload}.${signature}`
}

function verifySignedSessionToken(token: string) {
  const parts = token.split(".")
  if (parts.length !== 5 || parts[0] !== SIGNED_SESSION_VERSION) {
    return null
  }

  const [version, rawUserId, rawExpires, nonce, signature] = parts
  const userId = Number(rawUserId)
  const expires = Number(rawExpires)

  if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(expires) || expires <= Date.now()) {
    return null
  }

  const payload = `${version}.${rawUserId}.${rawExpires}.${nonce}`
  const expectedSignature = signSessionPayload(payload)
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null
  }

  return { userId }
}

function signSessionPayload(payload: string) {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url")
}

function getSessionSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "flower-ops-local-session-secret"
}

async function shouldUseSecureSessionCookie() {
  const override = process.env.SESSION_COOKIE_SECURE?.toLowerCase()
  if (override === "true" || override === "1") {
    return true
  }

  return false
}

function timingSafeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)

  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
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
