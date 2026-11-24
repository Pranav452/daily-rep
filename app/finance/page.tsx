import { Suspense } from "react"
import { TopBar } from "@/components/top-bar"
import { requireUser } from "@/lib/auth"
import { FundsSheet } from "@/components/funds-sheet"
import { fortnightsBefore, longDate, pickDay } from "@/lib/dates"
import { loadFundsErp } from "@/lib/funds"
import { loadSheet } from "@/lib/funds-store"

export default async function FinancePage({ searchParams }: PageProps<"/finance">) {
  const me = await requireUser("finance")
  const day = pickDay((await searchParams).d)
  return (
    <>
      <TopBar active="finance" day={day} me={me} />
      <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5 print:p-0">
        <Suspense key={day} fallback={<SheetSkeleton />}>
          <Sheet day={day} />
        </Suspense>
      </main>
    </>
  )
}

async function Sheet({ day }: { day: string }) {
  // ERP blocks and the saved hand-entered half load side by side.
  const [erp, saved] = await Promise.all([loadFundsErp(day), loadSheet(day)])
  const fortnights = fortnightsBefore(day, 4).map(({ key, label }) => ({ key, label }))
  return <FundsSheet day={day} dayLabel={longDate(day)} erp={erp} saved={saved} fortnights={fortnights} />
}

function SheetSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
      {[120, 120, 200, 260, 260, 260].map((h, i) => (
        <div key={i} className="skel" style={{ height: h }} />
      ))}
    </div>
  )
}
