// Date helpers on plain 'YYYY-MM-DD' strings (India time; no time-zone maths on the wire).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
}

/** A valid day from the query string, never in the future; otherwise today. */
export function pickDay(v: unknown): string {
  const today = todayIST()
  return isIsoDate(v) && v <= today && v >= "2020-01-01" ? v : today
}

export const ymd = (iso: string) => iso.replaceAll("-", "")

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export type Fortnight = { key: string; label: string; pattern: string }

/** The fortnight holding `iso` and the `count - 1` before it, oldest first. */
export function fortnightsBefore(iso: string, count: number): Fortnight[] {
  let [y, m] = iso.split("-").map(Number)
  let half = Number(iso.slice(8)) <= 15 ? 1 : 2
  const out: Fortnight[] = []
  for (let i = 0; i < count; i++) {
    const mon = MONTHS[m - 1]
    const ord = half === 1 ? "1st" : "2nd"
    out.unshift({
      key: `${y}-${String(m).padStart(2, "0")}-${half}`,
      label: `${ord} FN ${mon}-${String(y).slice(2)}`,
      pattern: `%CSR%${ord.toUpperCase()} FN ${mon.toUpperCase()}%${y}%`,
    })
    if (half === 2) half = 1
    else {
      half = 2
      m -= 1
      if (m === 0) {
        m = 12
        y -= 1
      }
    }
  }
  return out
}

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 })
export const money = (v: number) => inr.format(v)
export const count = (v: number) => inr0.format(v)
/** Short rupee figure for tiles: 35.9 L, 1.26 Cr. */
export function lakhs(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`
  return `₹${inr0.format(v)}`
}
