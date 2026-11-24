"use client"

import { useActionState } from "react"
import { signIn, type LoginState } from "./actions"

const start: LoginState = { error: "", user: "" }

export function LoginForm({ next }: { next: string }) {
  const [state, action, busy] = useActionState(signIn, start)
  const field = "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
  return (
    <form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm font-medium">
        Username
        <input name="user" defaultValue={state.user} autoComplete="username" autoCapitalize="none" spellCheck={false}
               autoFocus required className={field} />
      </label>
      <label className="block text-sm font-medium">
        Password
        <input name="password" type="password" autoComplete="current-password" required className={field} />
      </label>
      <p role="alert" className="min-h-5 text-sm text-bad">{state.error}</p>
      <button type="submit" disabled={busy}
              className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-panel disabled:opacity-60">
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  )
}
