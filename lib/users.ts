import "server-only"
import { readFile } from "node:fs/promises"
import { scrypt, timingSafeEqual } from "node:crypto"
import path from "node:path"
import type { Role } from "./session"

// Users live in data/users.json, written by `npm run add-user`. Only a salted
// scrypt hash of each password is kept.
type Stored = { user: string; name: string; role: Role; salt: string; hash: string }
const FILE = path.join(process.cwd(), "data", "users.json")

async function readUsers(): Promise<Stored[]> {
  try {
    const j = JSON.parse(await readFile(FILE, "utf8"))
    return Array.isArray(j.users) ? j.users : []
  } catch {
    return []
  }
}

const derive = (password: string, salt: string) =>
  new Promise<Buffer>((ok, fail) =>
    scrypt(password, Buffer.from(salt, "hex"), 64, { N: 16384, r: 8, p: 1 }, (e, key) => (e ? fail(e) : ok(key))),
  )

// Five wrong tries on one username lock it for five minutes.
const MAX_TRIES = 5
const LOCK_MS = 5 * 60_000
const tries = new Map<string, { n: number; until: number }>()

export type LoginResult = { ok: true; user: string; name: string; role: Role } | { ok: false; locked: boolean }

export async function checkLogin(userRaw: string, password: string): Promise<LoginResult> {
  const user = userRaw.trim().toLowerCase()
  const t = tries.get(user)
  if (t && t.until > Date.now()) return { ok: false, locked: true }

  const found = (await readUsers()).find((u) => u.user === user)
  // Hash even for an unknown name so the reply takes the same time either way.
  const key = await derive(password, found?.salt ?? "00".repeat(16))
  const good = !!found && key.length === found.hash.length / 2 && timingSafeEqual(key, Buffer.from(found.hash, "hex"))
  if (good) {
    tries.delete(user)
    return { ok: true, user: found.user, name: found.name, role: found.role }
  }
  const n = (t && t.until === 0 ? t.n : 0) + 1
  tries.set(user, n >= MAX_TRIES ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 })
  if (tries.size > 5000) tries.clear()
  return { ok: false, locked: n >= MAX_TRIES }
}
