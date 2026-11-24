import { NextResponse } from "next/server"
import { isIsoDate, todayIST } from "@/lib/dates"
import { saveSheet } from "@/lib/funds-store"
import type { FundsManual } from "@/lib/funds-sheet"

export async function PUT(req: Request) {
  const text = await req.text()
  if (text.length > 400_000) return NextResponse.json({ error: "Sheet is too large to save." }, { status: 413 })
  let body: { day?: unknown; manual?: FundsManual }
  try {
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: "Could not read the sheet." }, { status: 400 })
  }
  const { day, manual } = body
  if (!isIsoDate(day) || day > todayIST() || !manual || typeof manual !== "object" || !manual.banks) {
    return NextResponse.json({ error: "Could not read the sheet." }, { status: 400 })
  }
  try {
    return NextResponse.json({ savedAt: await saveSheet(day, manual) })
  } catch {
    return NextResponse.json({ error: "Could not save. Check the app can write to its data folder." }, { status: 500 })
  }
}
