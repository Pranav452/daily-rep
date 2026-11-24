import Link from "next/link"
import { DayPicker, Pick, Refresher } from "./top-bar-client"
import { longDate, todayIST } from "@/lib/dates"
import { signOut } from "@/app/login/actions"
import type { Session } from "@/lib/session"

type Props = {
  active: "ops" | "finance"
  day: string
  /** Operations only: which ERP the figures come from, and one branch or all. */
  co?: "manilal" | "links"
  br?: string
  me: Session
}

const BRANCHES: Record<"manilal" | "links", [string, string][]> = {
  manilal: ["MUM", "DEL", "MAA", "TRN", "BLR", "AMD", "COC", "CAL"].map((c) => [c, c]),
  links: ["MUM", "DEL", "MAA", "BDQ"].map((c) => [c, c]),
}

const qs = (p: Record<string, string | undefined>) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v)
  const str = u.toString()
  return str ? `?${str}` : ""
}

export function TopBar({ active, day, co = "manilal", br = "", me }: Props) {
  const d = day === todayIST() ? undefined : day
  const tab = (on: boolean) =>
    `px-3 py-1.5 rounded-md text-sm font-medium ${on ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`
  const branches = BRANCHES[co]
  return (
    <header className="no-print sticky top-0 z-10 border-b border-line bg-panel">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <span className="text-[15px] font-semibold tracking-tight">Daily Dashboard</span>
        <nav className="flex gap-1" aria-label="Sections">
          <Link href={`/${qs({ co: co === "links" ? "links" : undefined, br: br || undefined, d })}`} className={tab(active === "ops")}>
            Operations
          </Link>
          {me.role === "finance" && (
            <Link href={`/finance${qs({ d })}`} className={tab(active === "finance")}>
              Funds position
            </Link>
          )}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {active === "ops" && (
            <>
              <Pick label="Company" param="co" value={co} fallback="manilal" clears={["br"]}
                    options={[["manilal", "MP Cargo"], ["links", "Links"]]} />
              <Pick label="Branch" param="br" value={branches.some(([c]) => c === br) ? br : ""} fallback=""
                    options={[["", "All branches"], ...branches]} />
            </>
          )}
          <span className="hidden text-sm text-muted sm:inline">{longDate(day)}</span>
          <DayPicker day={day} max={todayIST()} />
          <Refresher />
          <form action={signOut} className="flex items-center gap-2 border-l border-line pl-3 text-sm">
            <span className="text-muted">{me.name}</span>
            <button type="submit" className="rounded-md border border-line px-2.5 py-1 hover:bg-bg">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  )
}
