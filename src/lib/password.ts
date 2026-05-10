import bcrypt from "bcryptjs"

const SALT_ROUNDS = 12

export function hashPassword(password: string) {
  return bcrypt.hashSync(password, SALT_ROUNDS)
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compareSync(password, hash)
}
