import "server-only"
import { cached, query } from "./db"
import { addDays, fortnightsBefore, ymd } from "./dates"

// The funds-position sheet is kept for MP Cargo (company 01, all branches).
const CO = "manilal" as const
const CMP = "01"
const DUTY_HEADS = `'G100236','G100345'` // customs duty, customs deposit

const n = (v: unknown) => Number(v ?? 0) || 0
const s = (v: unknown) => String(v ?? "").trim()
const yy = (iso: string) => ymd(iso).slice(2) // 'YYMMDD', the form the bank book is keyed on
const fyStart = (iso: string) => {
  const [y, m] = iso.split("-").map(Number)
  return `${m >= 4 ? y : y - 1}-04-01`
}
/** Opening balances live in one table per financial year. */
const openingTable = (iso: string) => {
  const y = Number(fyStart(iso).slice(0, 4))
  return `tbl_Master_0104${y}31030${String((y + 1) % 100).padStart(2, "0")}_AllGL`
}

const TTL = 5 * 60_000

// ── Customs duty advance held ───────────────────────────────────────────────
// Advance receipts of the last 60 days on jobs whose duty was not yet paid
// before yesterday. "Duty" is what was paid, else what is requested for payment.
export type DutyRow = { job: string; client: string; advance: number; duty: number | null; dutyState: "paid" | "requested" | "" }

export function dutyAdvances(asof: string) {
  return cached(`duty:${asof}`, TTL, async () => {
    const rows = await query(
      CO,
      `SELECT a.jobno, e.exp_name, a.adv_amt, a.adv_dt,
         duty_paid = (SELECT SUM(CONVERT(float, d2.amount)) FROM acc_bankdtls d2
                      JOIN acc_bank b2 ON b2.entryno = d2.entryno
                      WHERE d2.jobno = a.jobno AND d2.client IN (${DUTY_HEADS})
                        AND b2.status = 'BP' AND LEFT(b2.entryno, 2) = @cmp),
         duty_requested = (SELECT SUM(CONVERT(float, d3.amount)) FROM acc_bankdtls_CMP d3
                      JOIN acc_bank_CMP c3 ON c3.entryno = d3.entryno
                      WHERE d3.jobno = a.jobno AND d3.client IN (${DUTY_HEADS})
                        AND ISNULL(c3.acc_bank_Entryno, '') = '' AND ISNULL(c3.CHKPrintAuthority, '0') <> '2')
       FROM (SELECT d.jobno, d.client, SUM(CONVERT(float, d.amount)) adv_amt,
                    MIN('20' + b.entyr + b.entmm + b.entdd) adv_dt
             FROM acc_bankdtls d JOIN acc_bank b ON b.entryno = d.entryno
             WHERE d.entrytype = 'AD' AND b.status = 'BR' AND LEFT(b.entryno, 2) = @cmp
               AND b.entyr + b.entmm + b.entdd BETWEEN @from AND @to
             GROUP BY d.jobno, d.client) a
       LEFT JOIN exp_master e ON e.exp_code = a.client
       WHERE NOT EXISTS (SELECT 1 FROM acc_bankdtls d4 JOIN acc_bank b4 ON b4.entryno = d4.entryno
                         WHERE d4.jobno = a.jobno AND d4.client IN (${DUTY_HEADS})
                           AND b4.status = 'BP' AND LEFT(b4.entryno, 2) = @cmp
                           AND b4.entyr + b4.entmm + b4.entdd < @paidBefore)
       ORDER BY a.adv_dt`,
      { cmp: CMP, from: yy(addDays(asof, -60)), to: yy(asof), paidBefore: yy(addDays(asof, -1)) },
    )
    return rows.map((r): DutyRow => {
      const paid = r.duty_paid == null ? null : n(r.duty_paid)
      const req = r.duty_requested == null ? null : n(r.duty_requested)
      return {
        job: s(r.jobno),
        client: s(r.exp_name),
        advance: n(r.adv_amt),
        duty: paid ?? req,
        dutyState: paid != null ? "paid" : req != null ? "requested" : "",
      }
    })
  })
}

// ── Cheques issued but not cleared ──────────────────────────────────────────
// Cheque payments of the last 6 days with no clearance date (cash withdrawals
// excluded). The window is a working rule: bank reconciliation is not kept up
// to date in the books, so older "uncleared" entries are not real.
export type ChequeRow = { date: string; bank: string; chequeNo: string; payee: string; amount: number }

export function unclearedCheques(asof: string) {
  return cached(`chq:${asof}`, TTL, async () => {
    const rows = await query(
      CO,
      `SELECT b.entrydt, b.ourbank, b.chequeno, b.actualamount,
              LEFT(ISNULL(NULLIF(b.PayeeName, ''), b.narration), 40) payee
       FROM acc_bank b
       WHERE LEFT(b.entryno, 2) = @cmp AND b.status = 'BP' AND b.chequetype = 'CHQ'
         AND b.clearanceDate IS NULL
         AND b.entyr + b.entmm + b.entdd BETWEEN @from AND @to
         AND ISNULL(b.narration, '') NOT LIKE '%CASH WITHDRAW%'
       ORDER BY b.entyr + b.entmm + b.entdd`,
      { cmp: CMP, from: yy(addDays(asof, -6)), to: yy(asof) },
    )
    return rows.map(
      (r): ChequeRow => ({
        date: s(r.entrydt),
        bank: s(r.ourbank),
        chequeNo: s(r.chequeno),
        payee: s(r.payee),
        amount: n(r.actualamount),
      }),
    )
  })
}

// ── Airline CSR by fortnight ────────────────────────────────────────────────
// Bills and payment requests carry the fortnight in their remarks
// ("… CSR 2ND FN OCT 2026 …"). Late-booked CSR invoices are not in here yet.
export type CsrRow = { key: string; label: string; billed: number; bills: number; openRequests: number }

export function csrByFortnight(asof: string) {
  return cached(`csr:${asof}`, TTL, async () => {
    const fns = fortnightsBefore(asof, 4)
    const out = await Promise.all(
      fns.map(async (f): Promise<CsrRow> => {
        const [r] = await query(
          CO,
          `SELECT
             billed = (SELECT SUM(p.totalamt) FROM acc_purchase p
                       WHERE LEFT(p.pur_code, 2) = @cmp AND p.Remarks LIKE @pat
                         AND SUBSTRING(p.pur_date, 7, 4) + SUBSTRING(p.pur_date, 4, 2) + SUBSTRING(p.pur_date, 1, 2)
                             BETWEEN @from AND @to),
             bills = (SELECT COUNT(*) FROM acc_purchase p
                       WHERE LEFT(p.pur_code, 2) = @cmp AND p.Remarks LIKE @pat
                         AND SUBSTRING(p.pur_date, 7, 4) + SUBSTRING(p.pur_date, 4, 2) + SUBSTRING(p.pur_date, 1, 2)
                             BETWEEN @from AND @to),
             requested_open = (SELECT SUM(c.actualamount) FROM acc_bank_CMP c
                       WHERE c.cmpcode = @cmp AND c.status = 'BP' AND c.narration LIKE @pat
                         AND ISNULL(c.acc_bank_Entryno, '') = '' AND ISNULL(c.CHKPrintAuthority, '0') <> '2')`,
          { cmp: CMP, pat: f.pattern, from: ymd(addDays(asof, -90)), to: ymd(asof) },
        )
        return { key: f.key, label: f.label, billed: n(r?.billed), bills: n(r?.bills), openRequests: n(r?.requested_open) }
      }),
    )
    return out
  })
}

// ── Receivables: client ledger balance ──────────────────────────────────────
// Opening + invoices − receipts ± journal vouchers − credit notes, this
// financial year, in INR. Every debit balance, largest first.
export type PartyRow = { code: string; name: string; amount: number }

export function topReceivables(asof: string) {
  return cached(`rcv:${asof}`, TTL, async () => {
    const op = `ISNULL(o.[01101OP],0)+ISNULL(o.[01102OP],0)+ISNULL(o.[01103OP],0)+ISNULL(o.[01104OP],0)
               +ISNULL(o.[01105OP],0)+ISNULL(o.[01106OP],0)+ISNULL(o.[01108OP],0)+ISNULL(o.[01109OP],0)`
    const invDate = (c: string) => `SUBSTRING(${c}, 7, 4) + SUBSTRING(${c}, 4, 2) + SUBSTRING(${c}, 1, 2)`
    const rows = await query(
      CO,
      `SELECT TOP 400 k.code, MAX(e.exp_name) nm, MAX(${op}) + SUM(k.amt) AS bal
       FROM (
         SELECT i.inv_client code, CONVERT(float, ISNULL(NULLIF(c.inv_inramt, ''), '0')) amt
         FROM acc_invoice i JOIN acc_invcharge c ON c.inv_no = i.inv_no
         WHERE LEFT(i.inv_no, 2) = @cmp AND ${invDate("i.inv_date")} BETWEEN @from8 AND @to8 AND i.inv_client LIKE 'E%'
         UNION ALL
         SELECT i.inv_client, CONVERT(float, ISNULL(NULLIF(c.inv_inramt, ''), '0'))
         FROM acc_invoice i JOIN acc_invcharge1 c ON c.inv_no = i.inv_no
         WHERE LEFT(i.inv_no, 2) = @cmp AND ${invDate("i.inv_date")} BETWEEN @from8 AND @to8 AND i.inv_client LIKE 'E%'
         UNION ALL
         SELECT d.client,
                CASE WHEN b.status IN ('BP', 'CP', 'CE')
                     THEN CONVERT(float, d.amount) - CONVERT(float, ISNULL(NULLIF(d.deduction, ''), '0'))
                     ELSE CONVERT(float, ISNULL(NULLIF(d.deduction, ''), '0')) - CONVERT(float, d.amount) END
         FROM acc_bankdtls d JOIN acc_bank b ON b.entryno = d.entryno
         WHERE LEFT(b.entryno, 2) = @cmp AND b.entyr + b.entmm + b.entdd BETWEEN @from6 AND @to6 AND d.client LIKE 'E%'
         UNION ALL
         SELECT d.jv_account, ISNULL(d.jv_debit, 0) - ISNULL(d.jv_credit, 0)
         FROM acc_JournalVoucDtls d JOIN acc_JournalVouc j ON j.jvcode = d.jvcode
         WHERE LEFT(d.jvcode, 2) = @cmp AND ${invDate("j.jv_date")} BETWEEN @from8 AND @to8 AND d.jv_account LIKE 'E%'
         UNION ALL
         SELECT n.crt_client, -n.totalamt FROM acc_creditnote n
         WHERE LEFT(n.crt_no, 2) = @cmp AND ${invDate("n.crt_date")} BETWEEN @from8 AND @to8 AND n.crt_client LIKE 'E%'
       ) k
       LEFT JOIN exp_master e ON e.exp_code = k.code
       LEFT JOIN ${openingTable(asof)} o ON o.Code = k.code
       GROUP BY k.code
       HAVING MAX(${op}) + SUM(k.amt) > 0
       ORDER BY bal DESC`,
      { cmp: CMP, from8: ymd(fyStart(asof)), to8: ymd(asof), from6: yy(fyStart(asof)), to6: yy(asof) },
    )
    return rows.map((r): PartyRow => ({ code: s(r.code), name: s(r.nm) || s(r.code), amount: n(r.bal) }))
  })
}

// ── Vendor payments: open payment requests by payee ─────────────────────────
export function vendorQueue(asof: string) {
  return cached(`ven:${asof}`, 60_000, async () => {
    const rows = await query(
      CO,
      `SELECT LEFT(c.PayeeName, 60) payee, SUM(c.actualamount) amt
       FROM acc_bank_CMP c
       WHERE c.cmpcode = @cmp AND c.status = 'BP'
         AND ISNULL(c.CHKPrintAuthority, '0') <> '2' AND ISNULL(c.acc_bank_Entryno, '') = ''
         AND c.entyr + c.entmm + c.entdd BETWEEN @from AND @to
       GROUP BY LEFT(c.PayeeName, 60)
       ORDER BY 2 DESC`,
      { cmp: CMP, from: yy(fyStart(asof)), to: yy(asof) },
    )
    // Requests are keyed as "YOURSELF- RTGS- <payee>"; the sheet lists the payee alone.
    const byPayee = new Map<string, PartyRow>()
    for (const r of rows) {
      const name = s(r.payee).replace(/^YOURSELF[\s\-–.:·]*(?:(?:RTGS|NEFT|IMPS|DD|TT)[\s\-–.:·]*)?/i, "").trim() || s(r.payee)
      const code = name.toUpperCase()
      const hit = byPayee.get(code)
      if (hit) hit.amount += n(r.amt)
      else byPayee.set(code, { code, name, amount: n(r.amt) })
    }
    return [...byPayee.values()].filter((r) => r.code && r.amount > 0).sort((a, b) => b.amount - a.amount)
  })
}

// ── Bank book balances ──────────────────────────────────────────────────────
// Opening + bank book + contra entries + journal vouchers, per bank ledger.
// This is the balance in the books, which runs away from the bank's own figure
// whenever entries are posted late; all bank ledgers are kept in INR.
export type BankBook = { code: string; name: string; balance: number }

export function bankBooks(asof: string) {
  return cached(`bank:${asof}`, TTL, async () => {
    const invDate = (c: string) => `SUBSTRING(${c}, 7, 4) + SUBSTRING(${c}, 4, 2) + SUBSTRING(${c}, 1, 2)`
    const op = `ISNULL(o.[01101OP],0)+ISNULL(o.[01102OP],0)+ISNULL(o.[01103OP],0)+ISNULL(o.[01104OP],0)
               +ISNULL(o.[01105OP],0)+ISNULL(o.[01106OP],0)+ISNULL(o.[01108OP],0)+ISNULL(o.[01109OP],0)`
    const rows = await query(
      CO,
      `SELECT g.acctcode AS code, g.acctname AS nm,
              ISNULL((SELECT ${op} FROM ${openingTable(asof)} o WHERE o.Code = g.acctcode), 0) + ISNULL(SUM(k.amt), 0) AS bal
       FROM genacct_master g
       LEFT JOIN (
         SELECT b.ourbank code, CASE WHEN b.status IN ('BR', 'CR') THEN b.actualamount ELSE -b.actualamount END amt
         FROM acc_bank b
         WHERE LEFT(b.entryno, 2) = @cmp AND b.entyr + b.entmm + b.entdd BETWEEN @from6 AND @to6
         UNION ALL
         SELECT d.client,
                CASE WHEN b.status IN ('BP', 'CP', 'CE')
                     THEN CONVERT(float, d.amount) - CONVERT(float, ISNULL(NULLIF(d.deduction, ''), '0'))
                     ELSE CONVERT(float, ISNULL(NULLIF(d.deduction, ''), '0')) - CONVERT(float, d.amount) END
         FROM acc_bank b JOIN acc_bankdtls d ON d.entryno = b.entryno
         JOIN genacct_master gg ON gg.acctcode = d.client AND gg.bank = 'Y'
         WHERE LEFT(b.entryno, 2) = @cmp AND b.entyr + b.entmm + b.entdd BETWEEN @from6 AND @to6
         UNION ALL
         SELECT d.jv_account, ISNULL(d.jv_debit, 0) - ISNULL(d.jv_credit, 0)
         FROM acc_JournalVoucDtls d JOIN acc_JournalVouc j ON j.jvcode = d.jvcode
         JOIN genacct_master gg ON gg.acctcode = d.jv_account AND gg.bank = 'Y'
         WHERE LEFT(d.jvcode, 2) = @cmp AND ${invDate("j.jv_date")} BETWEEN @from8 AND @to8
       ) k ON k.code = g.acctcode
       WHERE g.bank = 'Y'
       GROUP BY g.acctcode, g.acctname
       HAVING COUNT(k.amt) > 0
       ORDER BY g.acctname`,
      { cmp: CMP, from8: ymd(fyStart(asof)), to8: ymd(asof), from6: yy(fyStart(asof)), to6: yy(asof) },
    )
    return rows.map((r): BankBook => ({ code: s(r.code), name: s(r.nm), balance: n(r.bal) }))
  })
}

export type FundsErp = {
  duty: DutyRow[] | null
  cheques: ChequeRow[] | null
  csr: CsrRow[] | null
  receivables: PartyRow[] | null
  vendors: PartyRow[] | null
  banks: BankBook[] | null
}

/** All ERP-fed blocks at once; a block that fails comes back null so the sheet still opens. */
export async function loadFundsErp(asof: string): Promise<FundsErp> {
  const soft = <T,>(p: Promise<T>) => p.catch(() => null)
  const [duty, cheques, csr, receivables, vendors, banks] = await Promise.all([
    soft(dutyAdvances(asof)),
    soft(unclearedCheques(asof)),
    soft(csrByFortnight(asof)),
    soft(topReceivables(asof)),
    soft(vendorQueue(asof)),
    soft(bankBooks(asof)),
  ])
  return { duty, cheques, csr, receivables, vendors, banks }
}
