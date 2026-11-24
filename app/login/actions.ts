"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { SESSION_COOKIE, SESSION_HOURS, canSee, sealSession } from "@/lib/session"
import { checkLogin } from "@/lib/users"

export type LoginState = { error: string; user: string }

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const user = String(form.get("user") ?? "").slice(0, 80)
  const password = String(form.get("password") ?? "").slice(0, 200)
  const next = String(form.get("next") ?? "")
  if (!user.trim() || !password) return { error: "Enter your username and password.", user }

  let token: string
  let role
  try {
    const r = await checkLogin(user, password)
    if (!r.ok) {
      return {
        error: r.locked ? "Too many wrong tries. Wait five minutes, then try again." : "Wrong username or password.",
        user,
      }
    }
    role = r.role
    token = sealSession({ user: r.user, name: r.name, role: r.role })
  } catch {
    return { error: "Sign-in is not set up on this server yet. Ask whoever runs it to add users.", user }
  }

  ;(await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "1", // set to 1 once the app is served over https
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  })
  // Only ever go back to a page inside this app.
  const safe = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") && canSee(role, next)
  redirect(safe ? next : "/")
}

export async function signOut() {
  ;(await cookies()).delete(SESSION_COOKIE)
  redirect("/login")
}
