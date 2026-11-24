// Signed session cookie. No database lookup is needed to check one, so the
// proxy can turn away signed-out requests before any page code runs.
import { createHmac, timingSafeEqual } from "node:crypto"

export const SESSION_COOKIE = "dd_session"
export const SESSION_HOURS = 12

/** finance sees everything; ops sees the Operations page only. */
export type Role = "finance" | "ops"
export type Session = { user: string; name: string; role: Role; exp: number }

function secret(): string {
  const s = process.env.AUTH_SECRET
  // Fail closed: with no secret nobody can be signed in, rather than everybody.
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is not set. Run: npm run add-user")
  return s
}

const mac = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url")

export function sealSession(s: Omit<Session, "exp">): string {
  const body = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + SESSION_HOURS * 3600_000 })).toString("base64url")
  return `${body}.${mac(body)}`
}

export function openSession(token: string | undefined): Session | null {
  if (!token) return null
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  try {
    const want = Buffer.from(mac(body))
    const got = Buffer.from(sig)
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Session
    if (typeof s.exp !== "number" || s.exp < Date.now()) return null
    if (s.role !== "finance" && s.role !== "ops") return null
    return s
  } catch {
    return null
  }
}

/** Where a signed-in person may go; anything else is sent to their home page. */
export const canSee = (role: Role, path: string) =>
  role === "finance" || !(path.startsWith("/finance") || path.startsWith("/api/funds"))
