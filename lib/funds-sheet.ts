// The hand-entered half of the funds-position sheet. Shared by server and browser.

/** ERP bank ledger behind each bank line of the sheet. */
export const BANK_LEDGER = { idfc: "G102145", scb: "G100286", bobChennai: "G101441", bobMumbai: "G102173" } as const

export type ManualRow = { id: string; name: string; amount: number | null; remark?: string }
export type RowEdit = { amount?: number | null; remark?: string; hidden?: boolean; picked?: boolean }

export type FundsManual = {
  banks: { idfc: number | null; scb: number | null; bobChennai: number | null; bobMumbai: number | null }
  fx: {
    scbUsd: number | null
    idfcUsd: number | null
    usdRequired: number | null
    scbEur: number | null
    idfcEur: number | null
  }
  airline: ManualRow[] // airline advance by fortnight
  pdcCheques: number | null
  advNotRecd: number | null // advance not received but duty paid
  chequesOverride: number | null // replaces the ERP cheque total when set
  webPaymentTotal: number | null
  csr: { key: string; amount: number | null } // fortnight picked + amount (blank = ERP billed figure)
  duty: Record<string, { duty?: number | null; hidden?: boolean }>
  receivables: { edits: Record<string, RowEdit>; extra: ManualRow[] }
  vendors: { edits: Record<string, RowEdit>; extra: ManualRow[] }
}

export function emptyManual(): FundsManual {
  return {
    banks: { idfc: null, scb: null, bobChennai: null, bobMumbai: null },
    fx: { scbUsd: null, idfcUsd: null, usdRequired: null, scbEur: null, idfcEur: null },
    airline: [],
    pdcCheques: null,
    advNotRecd: null,
    chequesOverride: null,
    webPaymentTotal: null,
    csr: { key: "", amount: null },
    duty: {},
    receivables: { edits: {}, extra: [] },
    vendors: { edits: {}, extra: [] },
  }
}

/**
 * Start a new day from the last saved one: keep what stays true overnight
 * (follow-up remarks, which rows are left off, hand-added lines) and drop
 * every figure that has to be read fresh (balances, amounts, totals).
 */
export function carryForward(prev: FundsManual): FundsManual {
  const next = emptyManual()
  const keep = (edits: Record<string, RowEdit>) =>
    Object.fromEntries(
      Object.entries(edits)
        .map(([k, e]) => [k, { remark: e.remark || undefined, hidden: e.hidden || undefined, picked: e.picked || undefined }] as const)
        .filter(([, e]) => e.remark || e.hidden || e.picked),
    )
  next.receivables = { edits: keep(prev.receivables.edits), extra: prev.receivables.extra.map((r) => ({ ...r })) }
  next.vendors = { edits: keep(prev.vendors.edits), extra: [] }
  return next
}
