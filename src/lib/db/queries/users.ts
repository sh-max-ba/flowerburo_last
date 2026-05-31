import type Database from "better-sqlite3"
import { hashPassword } from "@/lib/password"
import type { User, UserRole } from "../types"
import { db } from "../connection"
import { mapUser, publicUser } from "../mappers"
import { clean, normalizeRole } from "../form-parsers"

function getUserById(userId: number, client: Database.Database = db()) {
  const row = client
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       WHERE id = ?`
    )
    .get(userId) as Record<string, unknown> | undefined

  return row ? mapUser(row) : null
}

export function getCurrentUserById(userId: number) {
  const user = getUserById(userId)
  return user && user.isActive ? publicUser(user) : null
}

function getUserByLoginForWrite(login: string, client: Database.Database) {
  const row = client
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       WHERE login = ?`
    )
    .get(login) as Record<string, unknown> | undefined

  return row ? mapUser(row) : null
}

function countActiveOwners(client: Database.Database) {
  const row = client
    .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'owner' AND is_active = 1")
    .get() as { count: number }

  return Number(row.count)
}

function assertCanDemoteOrDisableUser(target: User, nextRole: UserRole, nextActive: boolean, client: Database.Database) {
  if (target.role !== "owner" || !target.isActive) {
    return
  }

  if (nextRole === "owner" && nextActive) {
    return
  }

  if (countActiveOwners(client) <= 1) {
    throw new Error("Нельзя отключить или снять роль у единственного активного управляющего.")
  }
}

export function listUsers(client: Database.Database = db()) {
  const rows = client
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       ORDER BY is_active DESC, role, name COLLATE NOCASE, login COLLATE NOCASE`
    )
    .all() as Record<string, unknown>[]

  return rows.map((row) => publicUser(mapUser(row)))
}

export function createUser(formData: FormData) {
  const client = db()
  const login = clean(formData.get("login"))
  const name = clean(formData.get("name"))
  const role = normalizeRole(formData.get("role"))
  const password = String(formData.get("password") ?? "")
  const isActive = clean(formData.get("isActive")) !== "0"

  if (!login || !name || !password) {
    throw new Error("Логин, имя, роль и пароль обязательны.")
  }

  if (password.length < 4) {
    throw new Error("Пароль должен быть не короче 4 символов.")
  }

  if (getUserByLoginForWrite(login, client)) {
    throw new Error("Пользователь с таким логином уже существует.")
  }

  client
    .prepare(
      `INSERT INTO users (login, name, role, password_hash, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(login, name, role, hashPassword(password), isActive ? 1 : 0)
}

export function updateUser(formData: FormData) {
  const client = db()
  const id = Number(clean(formData.get("id")))
  const login = clean(formData.get("login"))
  const name = clean(formData.get("name"))
  const role = normalizeRole(formData.get("role"))
  const isActive = clean(formData.get("isActive")) !== "0"

  if (!id || !login || !name) {
    throw new Error("Логин, имя и роль обязательны.")
  }

  const target = getUserById(id, client)
  if (!target) {
    throw new Error("Пользователь не найден.")
  }

  const duplicate = getUserByLoginForWrite(login, client)
  if (duplicate && duplicate.id !== id) {
    throw new Error("Пользователь с таким логином уже существует.")
  }

  assertCanDemoteOrDisableUser(target, role, isActive, client)

  client
    .prepare(
      `UPDATE users
       SET login = ?, name = ?, role = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(login, name, role, isActive ? 1 : 0, id)
}

export function setUserActive(userId: number, isActive: boolean) {
  const client = db()
  const target = getUserById(userId, client)
  if (!target) {
    throw new Error("Пользователь не найден.")
  }

  assertCanDemoteOrDisableUser(target, target.role, isActive, client)

  client
    .prepare(
      `UPDATE users
       SET is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(isActive ? 1 : 0, userId)
}

export function changeUserPassword(formData: FormData) {
  const client = db()
  const id = Number(clean(formData.get("id")))
  const newPassword = String(formData.get("newPassword") ?? "")
  const confirmPassword = String(formData.get("confirmPassword") ?? "")

  if (!id) {
    throw new Error("Пользователь не найден.")
  }

  if (newPassword.length < 4) {
    throw new Error("Пароль должен быть не короче 4 символов.")
  }

  if (newPassword !== confirmPassword) {
    throw new Error("Пароли не совпадают.")
  }

  if (!getUserById(id, client)) {
    throw new Error("Пользователь не найден.")
  }

  client
    .prepare(
      `UPDATE users
       SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(hashPassword(newPassword), id)
}

export function getUserByLogin(login: string) {
  const row = db()
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       WHERE login = ?`
    )
    .get(login) as Record<string, unknown> | undefined

  return row ? mapUser(row) : null
}

export function getUserBySessionToken(token: string) {
  const row = db()
    .prepare(
      `SELECT users.id, users.login, users.name, users.role, users.password_hash,
        users.is_active, users.created_at, users.updated_at
       FROM sessions
       INNER JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?
        AND users.is_active = 1
        AND (sessions.expires_at IS NULL OR DATETIME(sessions.expires_at) > DATETIME('now'))
       LIMIT 1`
    )
    .get(token) as Record<string, unknown> | undefined

  return row ? publicUser(mapUser(row)) : null
}

export function getActiveFlorists(client: Database.Database = db()) {
  const rows = client
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       WHERE role = 'florist' AND is_active = 1
       ORDER BY name COLLATE NOCASE`
    )
    .all() as Record<string, unknown>[]

  return rows.map((row) => publicUser(mapUser(row)))
}

export function getActiveFloristById(userId: number, client: Database.Database) {
  const row = client
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       WHERE id = ? AND role = 'florist' AND is_active = 1`
    )
    .get(userId) as Record<string, unknown> | undefined

  return row ? publicUser(mapUser(row)) : null
}

export function createSessionRecord(userId: number, token: string, expiresAt: Date) {
  db()
    .prepare(
      `INSERT INTO sessions (user_id, token, expires_at)
       VALUES (?, ?, ?)`
    )
    .run(userId, token, expiresAt.toISOString())
}

export function deleteSessionRecord(token: string) {
  db().prepare("DELETE FROM sessions WHERE token = ?").run(token)
}
