"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useTransition } from "react"

export function DayPicker({ day, max }: { day: string; max: string }) {
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()
  const [busy, start] = useTransition()
  return (
    <input
      type="date"
      aria-label="Day"
      value={day}
      max={max}
      onChange={(e) => {
        const v = e.target.value
        if (!v) return
        const u = new URLSearchParams(params)
        if (v === max) u.delete("d")
        else u.set("d", v)
        const q = u.toString()
        start(() => router.push(q ? `${path}?${q}` : path))
      }}
      className={`rounded-md border border-line bg-panel px-2 py-1 text-sm ${busy ? "opacity-60" : ""}`}
    />
  )
}

/** Re-reads the figures every five minutes while the tab is in view. */
export function Refresher() {
  const router = useRouter()
  const [busy, start] = useTransition()
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh()
    }, 5 * 60_000)
    return () => clearInterval(t)
  }, [router])
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      className="rounded-md border border-line px-2.5 py-1 text-sm hover:bg-bg disabled:opacity-60"
      disabled={busy}
    >
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  )
}

/** A dropdown that keeps its choice in the address bar. */
export function Pick(p: {
  label: string
  param: string
  value: string
  /** The value that needs no query parameter. */
  fallback: string
  /** Other parameters that stop making sense when this one changes. */
  clears?: string[]
  options: [string, string][]
}) {
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()
  const [busy, start] = useTransition()
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted">
      {p.label}
      <select
        value={p.value}
        onChange={(e) => {
          const u = new URLSearchParams(params)
          if (e.target.value === p.fallback) u.delete(p.param)
          else u.set(p.param, e.target.value)
          for (const c of p.clears ?? []) u.delete(c)
          const q = u.toString()
          start(() => router.push(q ? `${path}?${q}` : path))
        }}
        className={`rounded-md border border-line bg-panel px-2 py-1 text-ink ${busy ? "opacity-60" : ""}`}
      >
        {p.options.map(([v, text]) => (
          <option key={v} value={v}>{text}</option>
        ))}
      </select>
    </label>
  )
}
