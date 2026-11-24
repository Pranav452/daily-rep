import "server-only"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { SESSION_COOKIE, openSession, type Role, type Session } from "./session"

export async function currentUser(): Promise<Session | null> {
  try {
    return openSession((await cookies()).get(SESSION_COOKIE)?.value)
  } catch {
    return null
  }
}

/** For pages: the signed-in person, or off to the sign-in page. `need` narrows it to one role. */
export async function requireUser(need?: Role): Promise<Session> {
  const s = await currentUser()
  if (!s) redirect("/login")
  if (need === "finance" && s.role !== "finance") redirect("/")
  return s
}
