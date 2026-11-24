import { Suspense } from "react"
import { TopBar } from "@/components/top-bar"
import { friendlyDbError, type Company } from "@/lib/db"
import { count, lakhs, longDate, pickDay, todayIST } from "@/lib/dates"
import {
  blStatus, checklists, edocPending, invoicesMade, invoicesPending, shipments, shippingBills,
  type Line,
} from "@/lib/ops"

const CMP_NAME: Record<string, string> = { "31": "Forwarders", "32": "Ocean Links" }
const branch = (l: { cmp?: string; city: string }) =>
  l.cmp && CMP_NAME[l.cmp] ? `${l.city} · ${CMP_NAME[l.cmp]}` : l.city || "—"
const typeLabel = (l: Line) =>
  [l.kind && l.kind[0].toUpperCase() + l.kind.slice(1), l.mode].filter(Boolean).join(" ") || "—"
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0)

export default async function OpsPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams
  const co: Company = sp.co === "links" ? "links" : "manilal"
  const day = pickDay(sp.d)
  const isToday = day === todayIST()
  const dayWord = isToday ? "today" : `on ${longDate(day)}`
  const br = typeof sp.br === "string" && /^[A-Za-z]{3}$/.test(sp.br) ? sp.br.toUpperCase() : ""
  const k = `${co}:${day}:${br}`

  return (
    <>
      <TopBar active="ops" day={day} co={co} br={br} />
      <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Suspense key={`ship:${k}`} fallback={<Skeleton title="Shipments opened" />}>
            <Shipments co={co} day={day} dayWord={dayWord} br={br} />
          </Suspense>
          <Suspense key={`bl:${k}`} fallback={<Skeleton title="House BLs" />}>
            <Bls co={co} day={day} dayWord={dayWord} br={br} />
          </Suspense>
          <Suspense key={`sb:${k}`} fallback={<Skeleton title="Shipping bills filed" />}>
            <ShippingBills co={co} day={day} dayWord={dayWord} br={br} />
          </Suspense>
          <Suspense key={`chk:${k}`} fallback={<Skeleton title="Checklists made" />}>
            <Checklists co={co} day={day} dayWord={dayWord} br={br} />
          </Suspense>
          <Suspense key={`inv:${k}`} fallback={<Skeleton title="Invoices made" />}>
            <InvoicesMade co={co} day={day} dayWord={dayWord} br={br} />
          </Suspense>
          <Suspense key={`pend:${co}:${br}`} fallback={<Skeleton title="Invoices pending" />}>
            <InvoicesPending co={co} br={br} />
          </Suspense>
          <Suspense key={`edoc:${k}`} fallback={<Skeleton title="E-doc upload left" />}>
            <EdocLeft co={co} day={day} br={br} />
          </Suspense>
        </div>
      </main>
    </>
  )
}

type P = { co: Company; day: string; dayWord: string; br: string }
/** Keep one branch when the branch dropdown is set. */
const only = <T extends { city: string }>(rows: T[], br: string) => (br ? rows.filter((r) => r.city === br) : [...rows])

// ── Cards ───────────────────────────────────────────────────────────────────

async function Shipments({ co, day, dayWord, br }: P) {
  const r = await safe(() => shipments(co, day))
  if (!r.ok) return <Failed title="Shipments opened" msg={r.msg} />
  const rows = only(r.data, br)
  return (
    <Card title="Shipments opened" big={count(sum(rows, (x) => x.today))} bigNote={dayWord}
          side={`${count(sum(rows, (x) => x.mtd))} this month`}
          note="Export and import jobs opened, cancelled ones left out.">
      <Breakdown rows={rows} />
    </Card>
  )
}

async function Bls({ co, day, dayWord, br }: P) {
  const r = await safe(() => blStatus(co, day))
  if (!r.ok) return <Failed title="House BLs" msg={r.msg} />
  const rows = only(r.data, br)
    .filter((x) => x.made || x.released || x.ongoing || x.releasedMtd)
    .sort((a, b) => b.made + b.released - (a.made + a.released) || b.ongoing - a.ongoing)
  return (
    <Card title="House BLs" big={count(sum(rows, (x) => x.made))} bigNote={`made ${dayWord}`}
          side={`${count(sum(rows, (x) => x.released))} released ${dayWord} · ${count(sum(rows, (x) => x.ongoing))} ongoing · ${count(sum(rows, (x) => x.releasedMtd))} released this month`}
          note="Made: draft BL printed. Released: original or express BL printed (air: final MAWB). Ongoing: drafted in the last 45 days, not released yet.">
      {rows.length === 0 ? <p className="py-4 text-sm text-muted">Nothing this month yet.</p> : (
        <table className="mini w-full">
          <thead><tr><th>Branch</th><th>Mode</th><th className="num">Made</th><th className="num">Released</th><th className="num">Ongoing</th><th className="num">Month</th></tr></thead>
          <tbody>
            {rows.map((x, i) => (
              <tr key={i}>
                <td>{branch(x)}</td><td className="capitalize">{x.mode || "—"}</td>
                <td className={`num ${x.made ? "font-medium" : "text-muted"}`}>{count(x.made)}</td>
                <td className={`num ${x.released ? "font-medium" : "text-muted"}`}>{count(x.released)}</td>
                <td className={`num ${x.ongoing ? "text-warn" : "text-muted"}`}>{count(x.ongoing)}</td>
                <td className="num text-muted">{count(x.releasedMtd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

async function ShippingBills({ co, day, dayWord, br }: P) {
  const r = await safe(() => shippingBills(co, day))
  if (!r.ok) return <Failed title="Shipping bills filed" msg={r.msg} />
  const rows = only(r.data, br)
    .filter((x) => x.filed || x.entered || x.filedMtd)
    .sort((a, b) => b.filed - a.filed || b.entered - a.entered || b.filedMtd - a.filedMtd)
  return (
    <Card title="Shipping bills filed" big={count(sum(rows, (x) => x.filed))} bigNote={dayWord}
          side={`${count(sum(rows, (x) => x.entered))} entered into jobs ${dayWord} · ${count(sum(rows, (x) => x.filedMtd))} dated this month`}
          note="Filed: jobs whose shipping bill is dated that day. Entered: shipping bill details keyed into the job that day, whatever date is on the bill.">
      {rows.length === 0 ? <p className="py-4 text-sm text-muted">Nothing this month yet.</p> : (
        <table className="mini w-full">
          <thead><tr><th>Branch</th><th>Mode</th><th className="num">Filed</th><th className="num">Entered</th><th className="num">Month</th></tr></thead>
          <tbody>
            {rows.map((x, i) => (
              <tr key={i}>
                <td>{branch(x)}</td><td className="capitalize">{x.mode || "—"}</td>
                <td className={`num ${x.filed ? "font-medium" : "text-muted"}`}>{count(x.filed)}</td>
                <td className="num">{count(x.entered)}</td>
                <td className="num text-muted">{count(x.filedMtd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

async function Checklists({ co, day, dayWord, br }: P) {
  const r = await safe(() => checklists(co, day))
  if (!r.ok) return <Failed title="Checklists made" msg={r.msg} />
  const rows = only(r.data, br)
  return (
    <Card title="Checklists made" big={count(sum(rows, (x) => x.today))} bigNote={dayWord}
          side={`${count(sum(rows, (x) => x.mtd))} this month`}
          note="The ERP does not record a checklist being made. This counts jobs with a customs checklist (export) or BE copy (import) filed in e-docs.">
      <Breakdown rows={rows} />
    </Card>
  )
}

async function InvoicesMade({ co, day, dayWord, br }: P) {
  const r = await safe(() => invoicesMade(co, day))
  if (!r.ok) return <Failed title="Invoices made" msg={r.msg} />
  const rows = only(r.data, br)
  return (
    <Card title="Invoices made" big={count(sum(rows, (x) => x.today))} bigNote={dayWord}
          side={`${lakhs(sum(rows, (x) => x.amtToday ?? 0))} · ${count(sum(rows, (x) => x.mtd))} this month (${lakhs(sum(rows, (x) => x.amtMtd ?? 0))})`}
          note="By the time the invoice was entered. Foreign-currency invoices converted at the invoice rate.">
      <Breakdown rows={rows} amounts />
    </Card>
  )
}

async function InvoicesPending({ co, br }: { co: Company; br: string }) {
  const r = await safe(() => invoicesPending(co))
  if (!r.ok) return <Failed title="Invoices pending" msg={r.msg} />
  const rows = only(r.data, br).sort((a, b) => b.pending - a.pending)
  const critical = sum(rows, (x) => x.critical)
  return (
    <Card title="Invoices pending" big={count(sum(rows, (x) => x.pending))} bigNote="right now"
          side={critical ? `${count(critical)} over 21 days` : "none over 21 days"} sideTone={critical ? "bad" : undefined}
          note="Export jobs shipped 7 to 60 days ago with no invoice yet. Always the current position, whatever day is picked.">
      {rows.length > 0 && (
        <table className="mini w-full">
          <thead><tr><th>Branch</th><th>Mode</th><th className="num">Pending</th><th className="num">Over 21 days</th></tr></thead>
          <tbody>
            {rows.map((x, i) => (
              <tr key={i}>
                <td>{x.city || "—"}</td><td className="capitalize">{x.mode || "—"}</td>
                <td className="num">{count(x.pending)}</td>
                <td className={`num ${x.critical ? "text-bad" : "text-muted"}`}>{count(x.critical)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

async function EdocLeft({ co, day, br }: { co: Company; day: string; br: string }) {
  const r = await safe(() => edocPending(co, day))
  if (!r.ok) return <Failed title="E-doc upload left" msg={r.msg} />
  const rows = only(r.data, br).sort((a, b) => b.missingCore - a.missingCore)
  const jobs = sum(rows, (x) => x.jobs)
  return (
    <Card title="E-doc upload left" big={count(sum(rows, (x) => x.missingCore))} bigNote={`of ${count(jobs)} jobs`}
          side={`${count(sum(rows, (x) => x.noUpload))} with nothing uploaded`}
          note="Export jobs opened in the last 60 days still missing the invoice, packing list or shipping-bill EC copy in e-docs.">
      {rows.length > 0 && (
        <table className="mini w-full">
          <thead><tr><th>Branch</th><th>Mode</th><th className="num">Jobs</th><th className="num">Nothing</th><th className="num">Incomplete</th></tr></thead>
          <tbody>
            {rows.map((x, i) => (
              <tr key={i}>
                <td>{branch(x)}</td><td className="capitalize">{x.mode || "—"}</td>
                <td className="num text-muted">{count(x.jobs)}</td>
                <td className="num">{count(x.noUpload)}</td>
                <td className="num">{count(x.missingCore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

async function safe<T>(load: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; msg: string }> {
  try {
    return { ok: true, data: await load() }
  } catch (e) {
    console.error("[ops]", e)
    return { ok: false, msg: friendlyDbError(e) }
  }
}

function Card(p: {
  title: string; big: string; bigNote: string; side: string; sideTone?: "bad"; note: string; children?: React.ReactNode
}) {
  return (
    <section className="card flex flex-col p-4">
      <h2 className="text-sm font-medium text-muted">{p.title}</h2>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tabular-nums tracking-tight">{p.big}</span>
        <span className="text-sm text-muted">{p.bigNote}</span>
      </div>
      <p className={`mt-0.5 text-sm ${p.sideTone === "bad" ? "text-bad" : "text-muted"}`}>{p.side}</p>
      <div className="mt-3 max-h-64 flex-1 overflow-auto">{p.children}</div>
      <p className="mt-3 border-t border-line pt-2 text-xs leading-relaxed text-muted">{p.note}</p>
    </section>
  )
}

function Breakdown({ rows, amounts }: { rows: Line[]; amounts?: boolean }) {
  const list = rows.filter((r) => r.today || r.mtd).sort((a, b) => b.today - a.today || b.mtd - a.mtd)
  if (!list.length) return <p className="py-4 text-sm text-muted">Nothing this month yet.</p>
  return (
    <table className="mini w-full">
      <thead>
        <tr>
          <th>Branch</th><th>Type</th><th className="num">Day</th>
          {amounts && <th className="num">Amount</th>}
          <th className="num">Month</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r, i) => (
          <tr key={i}>
            <td>{branch(r)}</td>
            <td>{typeLabel(r)}</td>
            <td className={`num ${r.today ? "font-medium" : "text-muted"}`}>{count(r.today)}</td>
            {amounts && <td className="num text-muted">{r.amtToday ? lakhs(r.amtToday) : "—"}</td>}
            <td className="num text-muted">{count(r.mtd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Skeleton({ title }: { title: string }) {
  return (
    <section className="card p-4" aria-busy="true">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      <div className="skel mt-2 h-10 w-24" />
      <div className="skel mt-2 h-4 w-40" />
      <div className="skel mt-4 h-28 w-full" />
    </section>
  )
}

function Failed({ title, msg }: { title: string; msg: string }) {
  return (
    <section className="card p-4">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      <p className="mt-3 text-sm text-bad">{msg}</p>
    </section>
  )
}
