"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FundsErp, PartyRow } from "@/lib/funds"
import { BANK_LEDGER, type FundsManual, type ManualRow, type RowEdit } from "@/lib/funds-sheet"
import { money } from "@/lib/dates"

type Props = {
  day: string
  dayLabel: string
  erp: FundsErp
  saved: { manual: FundsManual; savedAt: string | null; carriedFrom: string | null }
  fortnights: { key: string; label: string }[]
}

const v = (x: number | null | undefined) => x ?? 0
const newId = () => Math.random().toString(36).slice(2, 10)
const parse = (t: string): number | null => {
  const c = t.replace(/[,\s₹$€]/g, "")
  if (c === "" || c === "-") return null
  const x = Number(c)
  return Number.isFinite(x) ? x : null
}

export function FundsSheet({ day, dayLabel, erp, saved, fortnights }: Props) {
  const [m, setM] = useState<FundsManual>(() => {
    const start = structuredClone(saved.manual)
    // A fresh day starts with the three fortnights the airline advance is split over.
    if (!saved.savedAt && start.airline.length === 0) {
      start.airline = fortnights.slice(-3).map((f) => ({ id: f.key, name: f.label, amount: null }))
    }
    if (!start.csr.key) start.csr.key = fortnights.at(-3)?.key ?? fortnights[0]?.key ?? ""
    return start
  })
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle")
  const [savedAt, setSavedAt] = useState(saved.savedAt)
  const [error, setError] = useState("")
  const latest = useRef(m)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useCallback(async () => {
    setStatus("saving")
    try {
      const res = await fetch("/api/funds", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ day, manual: latest.current }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || "Could not save.")
      setSavedAt(j.savedAt)
      setStatus((s) => (s === "saving" ? "saved" : s))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.")
      setStatus("error")
    }
  }, [day])

  /** Every edit goes through here: update, then save shortly after typing stops. */
  const edit = useCallback(
    (fn: (draft: FundsManual) => void) => {
      setM((prev) => {
        const next = structuredClone(prev)
        fn(next)
        latest.current = next
        return next
      })
      setStatus("dirty")
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(save, 900)
    },
    [save],
  )

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (status === "dirty" || status === "saving") e.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [status])

  // ── Figures ───────────────────────────────────────────────────────────────
  const c = useMemo(() => {
    const airline = m.airline.reduce((a, r) => a + v(r.amount), 0)
    const dutyRows = (erp.duty ?? []).filter((r) => !m.duty[r.job]?.hidden)
    const dutyAdvance = dutyRows.reduce((a, r) => a + r.advance, 0)
    const dutyPaid = dutyRows.reduce((a, r) => a + v(m.duty[r.job]?.duty ?? r.duty), 0)
    const chequesErp = (erp.cheques ?? []).reduce((a, r) => a + r.amount, 0)
    const cheques = m.chequesOverride ?? chequesErp
    const book = (k: keyof typeof BANK_LEDGER) => erp.banks?.find((b) => b.code === BANK_LEDGER[k])?.balance ?? null
    const bankBook = { idfc: book("idfc"), scb: book("scb"), bobChennai: book("bobChennai"), bobMumbai: book("bobMumbai") }
    const bank = (k: keyof typeof BANK_LEDGER) => v(m.banks[k] ?? bankBook[k])
    const bob = bank("bobChennai") + bank("bobMumbai")
    const banks = bank("idfc") + bank("scb") + bob
    const afterAirline = banks - airline
    const available = afterAirline - dutyAdvance - cheques - v(m.pdcCheques)
    const usd = v(m.fx.scbUsd) + v(m.fx.idfcUsd)
    const csrErp = erp.csr?.find((r) => r.key === m.csr.key)
    const csr = m.csr.amount ?? csrErp?.billed ?? 0
    return {
      airline, dutyRows, dutyAdvance, dutyPaid, chequesErp, cheques, bob, banks, afterAirline, available,
      bankBook, idfc: bank("idfc"), scb: bank("scb"),
      idfcAvail: bank("idfc") - airline - v(m.pdcCheques),
      scbAvail: bank("scb") - dutyAdvance - cheques,
      usd, usdBal: usd - v(m.fx.usdRequired), eur: v(m.fx.scbEur) + v(m.fx.idfcEur),
      csr, csrErp, payExCsr: v(m.webPaymentTotal) - csr,
    }
  }, [m, erp])

  const fnLabel = fortnights.find((f) => f.key === m.csr.key)?.label ?? ""

  return (
    <div>
      {/* Heading row */}
      <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Funds position</h1>
          <p className="text-sm text-muted">MP Cargo, all branches · {dayLabel}</p>
        </div>
        <div className="no-print ml-auto flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5 text-muted">
            <i className="inline-block h-3 w-5 border" style={{ background: "var(--manual)", borderColor: "var(--manual-line)" }} />
            typed in
            <i className="ml-2 inline-block h-3 w-5 border border-line bg-panel" />
            from the ERP
          </span>
          <span aria-live="polite" className={status === "error" ? "text-bad" : "text-muted"}>
            {status === "error" ? error
              : status === "saving" || status === "dirty" ? "Saving…"
              : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
              : "Not saved yet"}
          </span>
          {status === "error" && (
            <button type="button" onClick={save} className="rounded-md border border-line px-2.5 py-1 hover:bg-bg">Try again</button>
          )}
          <button type="button" onClick={() => window.print()} className="rounded-md bg-accent px-3 py-1 font-medium text-panel">
            Print
          </button>
        </div>
      </div>
      {saved.carriedFrom && !savedAt && (
        <p className="no-print mb-3 rounded-md border border-line bg-panel px-3 py-2 text-sm text-muted">
          New day. Remarks, left-off rows and hand-added receivable lines were brought over from {saved.carriedFrom}.
          Bank balances and other typed figures start blank.
        </p>
      )}

      <p className="no-print mb-3 text-xs leading-relaxed text-muted">
        Bank balances open on the balance in the ERP books, which is not the bank&apos;s own figure when entries are posted
        late. Type the statement balance over any of them; clear the box to go back to the ERP figure. Dollar and euro
        balances and the airline advance are not kept in the ERP and stay typed.
      </p>

      <div className="grid items-start gap-x-6 gap-y-4 lg:grid-cols-3">
        {/* ── Top row: the three bank blocks ── */}
        <table className="sheet">
          <tbody>
            <Bank label="IDFC bal" value={m.banks.idfc} book={c.bankBook.idfc} on={(x) => edit((d) => void (d.banks.idfc = x))} />
            <Out label="Airline advance" value={c.airline} />
            <In label="PDC cheq issued" value={m.pdcCheques} on={(x) => edit((d) => void (d.pdcCheques = x))} />
            <Out label="Total available bal" value={c.idfcAvail} total />
          </tbody>
        </table>

        <div className="space-y-3">
          <table className="sheet">
            <tbody>
              <Bank label="SCB bal" value={m.banks.scb} book={c.bankBook.scb} on={(x) => edit((d) => void (d.banks.scb = x))} />
              <Out label="C. duty advance" value={c.dutyAdvance} />
              <Erp label="Cheq issued but nt cleared" value={m.chequesOverride} fallback={c.chequesErp}
                   failed={erp.cheques === null} on={(x) => edit((d) => void (d.chequesOverride = x))} />
              <Out label="Total available bal" value={c.scbAvail} total />
            </tbody>
          </table>
          <table className="sheet">
            <tbody>
              <Bank label="BOB Chennai bal" value={m.banks.bobChennai} book={c.bankBook.bobChennai} on={(x) => edit((d) => void (d.banks.bobChennai = x))} />
              <Bank label="BOB Mumbai bal" value={m.banks.bobMumbai} book={c.bankBook.bobMumbai} on={(x) => edit((d) => void (d.banks.bobMumbai = x))} />
              <Out label="Total bal" value={c.bob} total />
            </tbody>
          </table>
        </div>

        <table className="sheet">
          <tbody>
            <Out label="IDFC" value={c.idfc} />
            <Out label="SCB" value={c.scb} />
            <Out label="BOB" value={c.bob} />
            <Out label="" value={c.banks} total />
            <Out label="Airline advance" value={c.airline} />
            <Out label="Total bal" value={c.afterAirline} total />
            <Out label="Against custom duty & other chgs" value={c.dutyAdvance} />
            <In label="Adv nt recd but duty paid (note only)" value={m.advNotRecd} on={(x) => edit((d) => void (d.advNotRecd = x))} />
            <Out label="Cheq issued but nt cleared" value={c.cheques} />
            {v(m.pdcCheques) !== 0 && <Out label="PDC cheq issued" value={v(m.pdcCheques)} />}
            <Out label="Total available bal - INR" value={c.available} total />
          </tbody>
        </table>

        {/* ── Middle row: foreign currency + airline advance | duty advance ── */}
        <div className="space-y-3">
          <table className="sheet">
            <tbody>
              <In label="SCB · total USD bal" value={m.fx.scbUsd} on={(x) => edit((d) => void (d.fx.scbUsd = x))} />
              <In label="IDFC · total USD bal" value={m.fx.idfcUsd} on={(x) => edit((d) => void (d.fx.idfcUsd = x))} />
              <Out label="Total available bal - USD" value={c.usd} total />
              <In label="$ required" value={m.fx.usdRequired} on={(x) => edit((d) => void (d.fx.usdRequired = x))} />
              <Out label="Bal" value={c.usdBal} total />
            </tbody>
          </table>
          <table className="sheet">
            <tbody>
              <In label="SCB · total Euro bal" value={m.fx.scbEur} on={(x) => edit((d) => void (d.fx.scbEur = x))} />
              <In label="IDFC · total Euro bal" value={m.fx.idfcEur} on={(x) => edit((d) => void (d.fx.idfcEur = x))} />
              <Out label="Total available bal - Euro" value={c.eur} total />
            </tbody>
          </table>
          <table className="sheet">
            <tbody>
              <Out label="Airline advance" value={c.airline} total />
              {m.airline.map((r, i) => (
                <tr key={r.id}>
                  <td className="cell-in">
                    <input aria-label="Fortnight" value={r.name} onChange={(e) => edit((d) => void (d.airline[i].name = e.target.value))} />
                  </td>
                  <NumCell value={r.amount} label={`Airline advance, ${r.name}`} on={(x) => edit((d) => void (d.airline[i].amount = x))} />
                  <Tool label={`Remove ${r.name}`} on={() => edit((d) => void d.airline.splice(i, 1))} />
                </tr>
              ))}
            </tbody>
          </table>
          <AddLine on={() => edit((d) => void d.airline.push({ id: newId(), name: "", amount: null }))} />
        </div>

        <div className="space-y-3 lg:col-span-2">
          <table className="sheet">
            <thead>
              <tr><th>Client name</th><th>IC no</th><th className="num">Advance amt</th><th className="num">C. duty amt</th></tr>
            </thead>
            <tbody>
              {erp.duty === null && <Problem span={4} />}
              {erp.duty?.length === 0 && <tr><td colSpan={4} className="text-muted">No duty advance held.</td></tr>}
              {c.dutyRows.map((r) => (
                <tr key={r.job}>
                  <td className="lbl" title={r.client}>{r.client}</td>
                  <td className="font-mono text-[11.5px]">{r.job}</td>
                  <td className="num">{money(r.advance)}</td>
                  <NumCell value={m.duty[r.job]?.duty ?? null} fallback={r.duty} label={`Duty amount, job ${r.job}`}
                           title={r.dutyState === "requested" ? "Payment requested, not paid yet" : r.dutyState === "paid" ? "Paid" : undefined}
                           on={(x) => edit((d) => void (d.duty[r.job] = { ...d.duty[r.job], duty: x }))} />
                  <Tool label={`Leave off ${r.client}`} on={() => edit((d) => void (d.duty[r.job] = { ...d.duty[r.job], hidden: true }))} />
                </tr>
              ))}
              <tr className="total">
                <td colSpan={2} className="text-center">Total duty advance</td>
                <td className="num">{money(c.dutyAdvance)}</td>
                <td className="num">{money(c.dutyPaid)}</td>
              </tr>
            </tbody>
          </table>
          <LeftOff
            items={(erp.duty ?? []).filter((r) => m.duty[r.job]?.hidden).map((r) => ({ key: r.job, name: `${r.client} · ${money(r.advance)}` }))}
            restore={(k) => edit((d) => void (d.duty[k] = { ...d.duty[k], hidden: false }))}
          />

          <table className="sheet">
            <tbody>
              <In label="Total payment showing in web" value={m.webPaymentTotal} on={(x) => edit((d) => void (d.webPaymentTotal = x))} />
              <tr>
                <td>
                  <span className="font-semibold uppercase">CSR </span>
                  <select aria-label="CSR fortnight" value={m.csr.key} className="bg-transparent uppercase"
                          onChange={(e) => edit((d) => void (d.csr = { key: e.target.value, amount: null }))}>
                    {fortnights.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </td>
                <NumCell value={m.csr.amount} fallback={c.csrErp ? c.csrErp.billed : null} label="CSR amount"
                         title={c.csrErp ? `${c.csrErp.bills} bills entered in the ERP so far` : undefined}
                         on={(x) => edit((d) => void (d.csr.amount = x))} />
              </tr>
              <Out label={`Total payment (excluding CSR ${fnLabel})`} value={c.payExCsr} total />
            </tbody>
          </table>
          {c.csrErp && m.csr.amount === null && (
            <p className="no-print text-xs text-muted">
              CSR shows what is billed in the ERP for {fnLabel} ({c.csrErp.bills} bills). Airline invoices entered late are
              not in it yet, so type the full figure over it if you have it.
            </p>
          )}
        </div>

        {/* ── Bottom row: receivables | vendor payments ── */}
        <div className="lg:col-span-2">
          <PartyTable
            title="High receivable" withRemarks
            rows={erp.receivables} book={m.receivables}
            change={(fn) => edit((d) => fn(d.receivables))}
            emptyText="No receivable balances." top={25} pickLabel="Add a client from the ERP"
          />
        </div>
        <PartyTable
          title="Vendor payments"
          rows={erp.vendors} book={m.vendors}
          change={(fn) => edit((d) => fn(d.vendors))}
          emptyText="No payment requests waiting." top={20} pickLabel="Add a payee from the ERP"
        />
      </div>
    </div>
  )
}

// ── Receivables / vendor list ───────────────────────────────────────────────

type Book = { edits: Record<string, RowEdit>; extra: ManualRow[] }

function PartyTable(p: {
  title: string
  withRemarks?: boolean
  rows: PartyRow[] | null
  book: Book
  change: (fn: (b: Book) => void) => void
  emptyText: string
  top: number
  pickLabel: string
}) {
  const all = p.rows ?? []
  // The largest ones are listed; anything else in the ERP can be added from the dropdown.
  const listed = all.filter((r, i) => i < p.top || p.book.edits[r.code]?.picked)
  const shown = listed.filter((r) => !p.book.edits[r.code]?.hidden)
  const more = all.filter((r, i) => i >= p.top && !p.book.edits[r.code]?.picked)
  const total =
    shown.reduce((a, r) => a + v(p.book.edits[r.code]?.amount ?? r.amount), 0) +
    p.book.extra.reduce((a, r) => a + v(r.amount), 0)
  const span = p.withRemarks ? 3 : 2
  const setEdit = (code: string, patch: RowEdit) => p.change((b) => void (b.edits[code] = { ...b.edits[code], ...patch }))
  return (
    <div>
      <table className="sheet">
        <thead>
          <tr>
            <th>{p.title}</th><th className="num">Amt</th>
            {p.withRemarks && <th>Remarks</th>}
          </tr>
        </thead>
        <tbody>
          {p.rows === null && <Problem span={span} />}
          {p.rows?.length === 0 && p.book.extra.length === 0 && <tr><td colSpan={span} className="text-muted">{p.emptyText}</td></tr>}
          {shown.map((r) => (
            <tr key={r.code}>
              <td className="lbl" title={r.name}>{r.name}</td>
              <NumCell value={p.book.edits[r.code]?.amount ?? null} fallback={r.amount} label={`Amount, ${r.name}`}
                       on={(x) => setEdit(r.code, { amount: x })} />
              {p.withRemarks && (
                <td className="cell-in">
                  <input aria-label={`Remark, ${r.name}`} value={p.book.edits[r.code]?.remark ?? ""}
                         onChange={(e) => setEdit(r.code, { remark: e.target.value })} />
                </td>
              )}
              <Tool label={`Leave off ${r.name}`} on={() => setEdit(r.code, { hidden: true })} />
            </tr>
          ))}
          {p.book.extra.map((r, i) => (
            <tr key={r.id}>
              <td className="cell-in">
                <input aria-label="Name" placeholder="Name" value={r.name} className="uppercase"
                       onChange={(e) => p.change((b) => void (b.extra[i].name = e.target.value))} />
              </td>
              <NumCell value={r.amount} label={`Amount, ${r.name || "new line"}`} on={(x) => p.change((b) => void (b.extra[i].amount = x))} />
              {p.withRemarks && (
                <td className="cell-in">
                  <input aria-label={`Remark, ${r.name || "new line"}`} value={r.remark ?? ""}
                         onChange={(e) => p.change((b) => void (b.extra[i].remark = e.target.value))} />
                </td>
              )}
              <Tool label={`Remove ${r.name || "line"}`} on={() => p.change((b) => void b.extra.splice(i, 1))} />
            </tr>
          ))}
          <tr className="total">
            <td />
            <td className="num">{money(total)}</td>
            {p.withRemarks && <td />}
          </tr>
        </tbody>
      </table>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        {more.length > 0 && (
          <select aria-label={p.pickLabel} value="" className="no-print max-w-64 rounded border border-line bg-panel px-1.5 py-0.5 text-xs"
                  onChange={(e) => e.target.value && setEdit(e.target.value, { picked: true, hidden: false })}>
            <option value="">{p.pickLabel} ({more.length})</option>
            {more.map((r) => <option key={r.code} value={r.code}>{r.name} · {money(r.amount)}</option>)}
          </select>
        )}
        <AddLine on={() => p.change((b) => void b.extra.push({ id: newId(), name: "", amount: null }))} />
        <LeftOff
          items={listed.filter((r) => p.book.edits[r.code]?.hidden).map((r) => ({ key: r.code, name: `${r.name} · ${money(r.amount)}` }))}
          restore={(k) => setEdit(k, { hidden: false })}
        />
      </div>
    </div>
  )
}

// ── Cells ───────────────────────────────────────────────────────────────────

/** A figure the sheet works out. */
function Out({ label, value, total }: { label: string; value: number; total?: boolean }) {
  return (
    <tr className={total ? "total" : undefined}>
      <td className="lbl">{label}</td>
      <td className={`num ${value < 0 ? "text-bad" : ""}`} style={{ width: 150 }}>{money(value)}</td>
    </tr>
  )
}

/** A figure only the accounts team knows. */
function In({ label, value, on }: { label: string; value: number | null; on: (x: number | null) => void }) {
  return (
    <tr>
      <td className="lbl">{label}</td>
      <NumCell value={value} on={on} label={label} width={150} />
    </tr>
  )
}

/** A bank balance: the ERP book balance until the statement figure is typed over it. */
function Bank(p: { label: string; value: number | null; book: number | null; on: (x: number | null) => void }) {
  return (
    <tr>
      <td className="lbl">{p.label}</td>
      <NumCell value={p.value} fallback={p.book} on={p.on} label={p.label} width={150}
               title={p.value === null ? "Balance in the ERP books" : p.book === null ? undefined : `ERP books: ${money(p.book)}`} />
    </tr>
  )
}

/** A figure the ERP supplies, which can be typed over. */
function Erp(p: { label: string; value: number | null; fallback: number; failed: boolean; on: (x: number | null) => void }) {
  return (
    <tr>
      <td className="lbl">{p.label}</td>
      <NumCell value={p.value} fallback={p.failed ? null : p.fallback} on={p.on} label={p.label} width={150}
               title={p.failed ? "Could not read this from the ERP. Type it in." : undefined} />
    </tr>
  )
}

/**
 * Number box. With a `fallback` it shows the ERP figure until someone types
 * over it; clearing the box brings the ERP figure back.
 */
function NumCell(p: {
  value: number | null
  fallback?: number | null
  on: (x: number | null) => void
  label: string
  title?: string
  width?: number
}) {
  const hasFallback = p.fallback !== undefined
  const shown = p.value ?? (hasFallback ? p.fallback : null)
  const [text, setText] = useState<string | null>(null) // non-null while typing
  const display = text ?? (shown == null ? "" : money(shown))
  const typed = p.value !== null
  return (
    <td className={hasFallback ? "cell-erp" : "cell-in"} style={p.width ? { width: p.width } : undefined} title={p.title}>
      <input
        inputMode="decimal"
        aria-label={p.label}
        className={`num ${hasFallback && typed ? "edited" : ""} ${shown != null && shown < 0 ? "text-bad" : ""}`}
        value={display}
        onFocus={(e) => {
          setText(shown == null ? "" : String(shown))
          requestAnimationFrame(() => e.target.select())
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null) {
            const x = parse(text)
            const same = x === p.value || (hasFallback && p.value === null && x === p.fallback)
            if (!same) p.on(x)
          }
          setText(null)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          if (e.key === "Escape") {
            setText(null)
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
          }
        }}
      />
    </td>
  )
}

function Tool({ label, on }: { label: string; on: () => void }) {
  return (
    <td className="tool">
      <button type="button" className="rowbtn" aria-label={label} title={label} onClick={on}>×</button>
    </td>
  )
}

function AddLine({ on }: { on: () => void }) {
  return (
    <button type="button" onClick={on} className="no-print text-xs font-medium text-accent hover:underline">
      + Add line
    </button>
  )
}

function LeftOff({ items, restore }: { items: { key: string; name: string }[]; restore: (key: string) => void }) {
  if (!items.length) return null
  return (
    <details className="no-print text-xs text-muted">
      <summary className="cursor-pointer">{items.length} left off</summary>
      <ul className="mt-1 space-y-0.5">
        {items.map((it) => (
          <li key={it.key}>
            {it.name}{" "}
            <button type="button" onClick={() => restore(it.key)} className="font-medium text-accent hover:underline">Put back</button>
          </li>
        ))}
      </ul>
    </details>
  )
}

function Problem({ span }: { span: number }) {
  return (
    <tr>
      <td colSpan={span} className="text-bad">Could not read this from the ERP. Reload to try again.</td>
    </tr>
  )
}
