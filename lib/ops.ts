import "server-only"
import { cached, query, type Company } from "./db"

/** One breakdown line: a branch (+ optional kind/mode) with a day figure and a month-to-date figure. */
export type Line = {
  cmp: string
  city: string
  kind: string // export | import | misc | other
  mode: string // sea | air | ""
  today: number
  mtd: number
  amtToday?: number
  amtMtd?: number
}

const IMPORT_CITY: Record<Company, Record<string, string>> = {
  links: { "110": "MUM", "111": "DEL", "112": "MAA", "116": "BDQ" },
  manilal: {
    "101": "MUM", "102": "DEL", "103": "MAA", "104": "BLR",
    "105": "AMD", "106": "COC", "107": "CAL", "108": "TRN",
  },
}

const s = (v: unknown) => String(v ?? "").trim()
const n = (v: unknown) => Number(v ?? 0) || 0

function norm(co: Company, rows: Record<string, unknown>[]): Line[] {
  return rows.map((r) => {
    const city = s(r.city)
    return {
      cmp: s(r.cmp),
      city: IMPORT_CITY[co][city] ?? city.toUpperCase(),
      kind: s(r.kind).toLowerCase(),
      mode: s(r.mode).toLowerCase(),
      today: n(r.today),
      mtd: n(r.mtd),
      amtToday: r.amt_today === undefined ? undefined : n(r.amt_today),
      amtMtd: r.amt_mtd === undefined ? undefined : n(r.amt_mtd),
    }
  })
}

/** @d = selected day, @m = first day of its month, both 'YYYYMMDD'. */
function range(day: string) {
  const d = day.replaceAll("-", "")
  return { d, m: d.slice(0, 6) + "01" }
}

const TTL = 60_000
const key = (name: string, co: Company, day: string) => `${name}:${co}:${day}`

// ── 1. House BLs: made, released, still open ────────────────────────────────
// Read from the print audit trail (append-only):
//   made      = a draft BL was printed that day
//   released  = the original or express BL was printed that day (air: final MAWB)
//   ongoing   = drafted in the last 45 days and not released yet
export type BlLine = {
  cmp: string; city: string; mode: string
  made: number; released: number; releasedMtd: number; ongoing: number
}

export function blStatus(co: Company, day: string) {
  return cached(key("bl", co, day), TTL, async () => {
    const rows = await query(
      co,
      `SELECT E.cmpcode AS cmp, E.citycode AS city, E.expt_mode AS mode,
              SUM(j.made_day) AS made, SUM(j.rel_day) AS released, SUM(j.rel_mtd) AS released_mtd,
              SUM(CASE WHEN j.drafted = 1 AND j.rel_any = 0 AND ISNULL(H.ISPRINT, '') NOT IN ('1', '2')
                        AND ISNULL(E.exptcancel, '') <> 'Y' THEN 1 ELSE 0 END) AS ongoing
       FROM (SELECT LTRIM(RTRIM(P.WhatDone)) AS job,
                    MAX(CASE WHEN P.itemdesc LIKE '%DRAFT PRINT%' AND P.WhenDone >= @d THEN 1 ELSE 0 END) AS made_day,
                    MAX(CASE WHEN P.itemdesc LIKE '%DRAFT PRINT%' THEN 1 ELSE 0 END) AS drafted,
                    MAX(CASE WHEN (P.itemdesc LIKE '%FIRST PRINT FLG%' OR P.itemdesc LIKE '%XPRESS PRINT FLG%')
                              AND P.WhenDone >= @d THEN 1 ELSE 0 END) AS rel_day,
                    MAX(CASE WHEN (P.itemdesc LIKE '%FIRST PRINT FLG%' OR P.itemdesc LIKE '%XPRESS PRINT FLG%')
                              AND P.WhenDone >= @m THEN 1 ELSE 0 END) AS rel_mtd,
                    MAX(CASE WHEN P.itemdesc LIKE '%FIRST PRINT FLG%' OR P.itemdesc LIKE '%XPRESS PRINT FLG%'
                             THEN 1 ELSE 0 END) AS rel_any
             FROM PrintingUserTrack P
             WHERE P.WhereDone = 'EXPT_HBL_PRINT'
               AND P.WhenDone >= DATEADD(DAY, -45, @d) AND P.WhenDone < DATEADD(DAY, 1, @d)
             GROUP BY LTRIM(RTRIM(P.WhatDone))) j
       JOIN expt_master E ON E.exptno = j.job
       LEFT JOIN (SELECT ExptNo, MAX(ISPRINT) AS ISPRINT FROM EXPT_HBL_PRINT GROUP BY ExptNo) H ON H.ExptNo = j.job
       GROUP BY E.cmpcode, E.citycode, E.expt_mode
       UNION ALL
       SELECT E.cmpcode, E.citycode, 'air', 0,
              COUNT(DISTINCT CASE WHEN M.printdt >= @d THEN M.exptno END), COUNT(DISTINCT M.exptno), 0
       FROM expt_mawb_print M
       JOIN expt_master E ON E.exptno = M.exptno
       WHERE M.isPrint = '1' AND M.printdt >= @m AND M.printdt < DATEADD(DAY, 1, @d)
       GROUP BY E.cmpcode, E.citycode`,
      range(day),
    )
    return rows.map(
      (r): BlLine => ({
        cmp: s(r.cmp), city: s(r.city).toUpperCase(), mode: s(r.mode).toLowerCase(),
        made: n(r.made), released: n(r.released), releasedMtd: n(r.released_mtd), ongoing: n(r.ongoing),
      }),
    )
  })
}

// ── 1b. Shipping bills filed ────────────────────────────────────────────────
// Jobs carrying a shipping bill number whose shipping bill date is that day.
// "entered" = the shipping bill details were keyed into the job that day,
// whatever date is on the bill.
export type SbLine = { cmp: string; city: string; mode: string; filed: number; filedMtd: number; entered: number }

export function shippingBills(co: Company, day: string) {
  const [y, m, d] = day.split("-")
  return cached(key("sb", co, day), TTL, async () => {
    const rows = await query(
      co,
      `SELECT E.cmpcode AS cmp, E.citycode AS city, E.expt_mode AS mode,
              SUM(CASE WHEN E.expt_shipbilldt = @dmy THEN 1 ELSE 0 END) AS filed,
              SUM(CASE WHEN RIGHT(RTRIM(E.expt_shipbilldt), 7) = @my
                        AND LEFT(E.expt_shipbilldt, 2) <= @dd THEN 1 ELSE 0 END) AS filed_mtd,
              SUM(CASE WHEN E.sysexpt_shipbilldt >= @d AND E.sysexpt_shipbilldt < DATEADD(DAY, 1, @d)
                       THEN 1 ELSE 0 END) AS entered
       FROM expt_master E
       WHERE E.sysexpt_docrecd >= DATEADD(DAY, -75, @d)
         AND ISNULL(RTRIM(E.expt_shipbillno), '') <> ''
         AND ISNULL(E.exptcancel, '') <> 'Y'
       GROUP BY E.cmpcode, E.citycode, E.expt_mode`,
      { d: range(day).d, dmy: `${d}/${m}/${y}`, my: `${m}/${y}`, dd: d },
    )
    return rows.map(
      (r): SbLine => ({
        cmp: s(r.cmp), city: s(r.city).toUpperCase(), mode: s(r.mode).toLowerCase(),
        filed: n(r.filed), filedMtd: n(r.filed_mtd), entered: n(r.entered),
      }),
    )
  })
}

// ── 2. Checklists made ──────────────────────────────────────────────────────
// The ERP keeps no checklist record of its own; the only trace is the customs
// checklist (export) / BE copy (import) filed in e-docs.
export function checklists(co: Company, day: string) {
  return cached(key("chk", co, day), TTL, async () =>
    norm(
      co,
      await query(
        co,
        `SELECT E.cmpcode AS cmp, E.citycode AS city, 'export' AS kind, E.expt_mode AS mode,
                COUNT(DISTINCT CASE WHEN U.MAKERDT >= @d THEN U.JOBNO END) AS today,
                COUNT(DISTINCT U.JOBNO) AS mtd
         FROM TBL_EDOC_MST_UPLOAD U
         JOIN expt_master E ON E.exptno = U.JOBNO
         WHERE U.FK_MODULEID = 3 AND U.FK_FORMID = 20 AND U.FK_DOCUMENTID = 28
           AND ISNULL(U.ISDELETED, '') <> 'Y'
           AND U.MAKERDT >= @m AND U.MAKERDT < DATEADD(DAY, 1, @d)
         GROUP BY E.cmpcode, E.citycode, E.expt_mode
         UNION ALL
         SELECT I.cmp_code, CAST(I.citycode1 AS varchar(10)), 'import', LOWER(RTRIM(I.Mode)),
                COUNT(DISTINCT CASE WHEN U.MAKERDT >= @d THEN U.JOBNO END),
                COUNT(DISTINCT U.JOBNO)
         FROM TBL_EDOC_MST_UPLOAD U
         JOIN TBL_IMP_IMPORT I ON I.Import_Code = U.JOBNO
         WHERE U.FK_MODULEID = 4 AND U.FK_FORMID = 22 AND U.FK_DOCUMENTID = 129
           AND ISNULL(U.ISDELETED, '') <> 'Y'
           AND U.MAKERDT >= @m AND U.MAKERDT < DATEADD(DAY, 1, @d)
         GROUP BY I.cmp_code, I.citycode1, LOWER(RTRIM(I.Mode))`,
        range(day),
      ),
    ),
  )
}

// ── 3. E-doc upload left ────────────────────────────────────────────────────
// Export jobs opened in the last 60 days (yesterday's and today's excluded so
// fresh jobs get a day) that still miss one of the three core papers:
// invoice, packing list, EC copy of the shipping bill.
export type EdocLine = { cmp: string; city: string; mode: string; jobs: number; noUpload: number; missingCore: number }

export function edocPending(co: Company, day: string) {
  return cached(key("edoc", co, day), TTL, async () => {
    const rows = await query(
      co,
      `SELECT E.cmpcode AS cmp, E.citycode AS city, E.expt_mode AS mode, COUNT(*) AS jobs,
              SUM(CASE WHEN U.JOBNO IS NULL THEN 1 ELSE 0 END) AS no_upload,
              SUM(CASE WHEN ISNULL(U.core_docs, 0) < 3 THEN 1 ELSE 0 END) AS missing_core
       FROM expt_master E
       LEFT JOIN (SELECT JOBNO,
                         COUNT(DISTINCT CASE WHEN FK_DOCUMENTID IN (1, 2, 27) THEN FK_DOCUMENTID END) AS core_docs
                  FROM TBL_EDOC_MST_UPLOAD
                  WHERE FK_MODULEID = 3 AND FK_FORMID = 20 AND ISNULL(ISDELETED, '') <> 'Y'
                    AND MAKERDT >= DATEADD(DAY, -60, @d)
                  GROUP BY JOBNO) U ON U.JOBNO = E.exptno
       WHERE E.sysexpt_docrecd >= DATEADD(DAY, -60, @d) AND E.sysexpt_docrecd < DATEADD(DAY, -1, @d)
         AND ISNULL(E.exptcancel, '') <> 'Y'
       GROUP BY E.cmpcode, E.citycode, E.expt_mode`,
      { d: range(day).d },
    )
    return rows.map(
      (r): EdocLine => ({
        cmp: s(r.cmp),
        city: s(r.city).toUpperCase(),
        mode: s(r.mode).toLowerCase(),
        jobs: n(r.jobs),
        noUpload: n(r.no_upload),
        missingCore: n(r.missing_core),
      }),
    )
  })
}

// ── 4a. Invoices made ───────────────────────────────────────────────────────
// Counted on the time the invoice was keyed (the printed invoice date can be
// back-dated). Amount is converted to INR at the invoice's own rate.
export function invoicesMade(co: Company, day: string) {
  const inr = `I.totalamt * CASE WHEN I.inv_currate <> '' AND I.inv_currate <> '.'
                                  AND I.inv_currate NOT LIKE '%[^0-9.]%'
                             THEN CAST(I.inv_currate AS decimal(18, 6)) ELSE 1 END`
  return cached(key("inv", co, day), TTL, async () =>
    norm(
      co,
      await query(
        co,
        `SELECT I.cmpcode AS cmp, I.citycode AS city, '' AS mode,
                CASE I.INV_TYPE WHEN '1' THEN 'export' WHEN '5' THEN 'import'
                                WHEN '7' THEN 'misc' ELSE 'other' END AS kind,
                SUM(CASE WHEN I.MakerDT >= @d THEN 1 ELSE 0 END) AS today,
                COUNT(*) AS mtd,
                SUM(CASE WHEN I.MakerDT >= @d THEN ${inr} ELSE 0 END) AS amt_today,
                SUM(${inr}) AS amt_mtd
         FROM acc_invoice I
         WHERE I.MakerDT >= @m AND I.MakerDT < DATEADD(DAY, 1, @d)
         GROUP BY I.cmpcode, I.citycode, I.INV_TYPE`,
        range(day),
      ),
    ),
  )
}

// ── 4b. Invoices pending ────────────────────────────────────────────────────
// Work done (sailed) 7–60 days ago and still not invoiced. Always "as of now":
// it reads the job-state snapshot the ERP refreshes every 15 minutes.
export type PendingLine = { city: string; mode: string; pending: number; critical: number }

export function invoicesPending(co: Company) {
  const today = `DATEADD(DAY, DATEDIFF(DAY, 0, GETDATE()), 0)`
  const text =
    co === "links"
      ? `SELECT S.citycode AS city, S.mode, COUNT(*) AS pending,
                SUM(CASE WHEN R.crit_days IS NOT NULL
                          AND S.work_done_dt <= DATEADD(DAY, -R.crit_days, ${today}) THEN 1 ELSE 0 END) AS critical
         FROM TBL_EXPT_JOB_STATE S
         CROSS JOIN TBL_EXPT_ALERT_RULE R
         WHERE R.rule_code = 'NOT_INVOICED_AFTER_SAIL' AND R.enabled = 1
           AND S.invoiced_flag = 0 AND S.billing_tracked = 1
           AND S.work_done_dt <= DATEADD(DAY, -R.grace_days, ${today})
           AND (R.max_days IS NULL OR S.work_done_dt >= DATEADD(DAY, -R.max_days, ${today}))
         GROUP BY S.citycode, S.mode`
      : `SELECT S.citycode AS city, S.mode, COUNT(*) AS pending,
                SUM(CASE WHEN S.sailed_dt <= DATEADD(DAY, -21, ${today}) THEN 1 ELSE 0 END) AS critical
         FROM TBL_EXPT_JOB_STATE S
         WHERE S.invoiced_flag = 0 AND S.billing_tracked = 1 AND S.sailed_dt IS NOT NULL
           AND S.sailed_dt <= DATEADD(DAY, -7, ${today})
           AND S.sailed_dt >= DATEADD(DAY, -60, ${today})
         GROUP BY S.citycode, S.mode`
  return cached(`pend:${co}`, TTL, async () =>
    (await query(co, text)).map(
      (r): PendingLine => ({
        city: s(r.city).toUpperCase(),
        mode: s(r.mode).toLowerCase(),
        pending: n(r.pending),
        critical: n(r.critical),
      }),
    ),
  )
}

// ── 5. Shipments (jobs opened) ──────────────────────────────────────────────
export function shipments(co: Company, day: string) {
  return cached(key("ship", co, day), TTL, async () =>
    norm(
      co,
      await query(
        co,
        `SELECT E.cmpcode AS cmp, E.citycode AS city, 'export' AS kind, E.expt_mode AS mode,
                SUM(CASE WHEN E.sysexpt_docrecd >= @d THEN 1 ELSE 0 END) AS today,
                COUNT(*) AS mtd
         FROM expt_master E
         WHERE E.sysexpt_docrecd >= @m AND E.sysexpt_docrecd < DATEADD(DAY, 1, @d)
           AND ISNULL(E.exptcancel, '') <> 'Y'
         GROUP BY E.cmpcode, E.citycode, E.expt_mode
         UNION ALL
         SELECT I.cmp_code, CAST(I.citycode1 AS varchar(10)), 'import', LOWER(RTRIM(I.Mode)),
                SUM(CASE WHEN I.Import_Date >= @d THEN 1 ELSE 0 END),
                COUNT(*)
         FROM TBL_IMP_IMPORT I
         WHERE I.Import_Date >= @m AND I.Import_Date < DATEADD(DAY, 1, @d)
           AND ISNULL(I.Doc_Cancel, 'N') <> 'Y'
         GROUP BY I.cmp_code, I.citycode1, LOWER(RTRIM(I.Mode))`,
        range(day),
      ),
    ),
  )
}
