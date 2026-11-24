import "server-only"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { carryForward, emptyManual, type FundsManual } from "./funds-sheet"
import { isIsoDate } from "./dates"

// One small JSON file per day, next to the app. The ERP database is only ever
// read; nothing the accounts team types here is written back to it.
const DIR = path.join(process.cwd(), "data", "funds")
const file = (day: string) => path.join(DIR, `${day}.json`)

export type Saved = { manual: FundsManual; savedAt: string | null; carriedFrom: string | null }

async function read(day: string): Promise<{ manual: FundsManual; savedAt: string } | null> {
  try {
    const j = JSON.parse(await readFile(file(day), "utf8"))
    const base = emptyManual()
    // Fill any field added after the file was written.
    const manual: FundsManual = {
      ...base,
      ...j.manual,
      banks: { ...base.banks, ...j.manual?.banks },
      fx: { ...base.fx, ...j.manual?.fx },
      csr: { ...base.csr, ...j.manual?.csr },
      receivables: { ...base.receivables, ...j.manual?.receivables },
      vendors: { ...base.vendors, ...j.manual?.vendors },
    }
    return { manual, savedAt: String(j.savedAt ?? "") }
  } catch {
    return null
  }
}

export async function loadSheet(day: string): Promise<Saved> {
  const own = await read(day)
  if (own) return { manual: own.manual, savedAt: own.savedAt, carriedFrom: null }
  let days: string[] = []
  try {
    days = (await readdir(DIR)).map((f) => f.replace(/\.json$/, "")).filter((d) => isIsoDate(d) && d < day)
  } catch {
    /* nothing saved yet */
  }
  const last = days.sort().at(-1)
  const prev = last ? await read(last) : null
  return prev
    ? { manual: carryForward(prev.manual), savedAt: null, carriedFrom: last! }
    : { manual: emptyManual(), savedAt: null, carriedFrom: null }
}

export async function saveSheet(day: string, manual: FundsManual): Promise<string> {
  await mkdir(DIR, { recursive: true })
  const savedAt = new Date().toISOString()
  const tmp = file(day) + ".tmp"
  await writeFile(tmp, JSON.stringify({ day, savedAt, manual }, null, 1), "utf8")
  await rename(tmp, file(day))
  return savedAt
}
