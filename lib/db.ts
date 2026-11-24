import "server-only"
import sql from "mssql"

export type Company = "links" | "manilal"

function makeConfig(company: Company): sql.config {
  const p = company === "links" ? "LINKS" : "MANILAL"
  return {
    server: process.env[`MSSQL_${p}_HOST`]!,
    port: parseInt(process.env[`MSSQL_${p}_PORT`] ?? "1433"),
    user: process.env[`MSSQL_${p}_USER`]!,
    password: process.env[`MSSQL_${p}_PASSWORD`]!,
    database: process.env[`MSSQL_${p}_DATABASE`]!,
    options: {
      encrypt: false, // SQL Server 2008 R2
      trustServerCertificate: true,
      enableArithAbort: true,
      readOnlyIntent: true,
    },
    connectionTimeout: 30000,
    requestTimeout: 60000,
    pool: { max: 8, min: 0, idleTimeoutMillis: 30000, acquireTimeoutMillis: 60000 },
  }
}

declare global {
  var __dashPools: Partial<Record<Company, Promise<sql.ConnectionPool>>> | undefined
}
const pools = (globalThis.__dashPools ??= {})

/** One shared pool per database; the in-flight connect promise is cached. */
export function getPool(company: Company): Promise<sql.ConnectionPool> {
  let p = pools[company]
  if (!p) {
    const pool = new sql.ConnectionPool(makeConfig(company))
    pool.on("error", () => {
      if (pools[company] === p) delete pools[company]
    })
    p = pool.connect().catch((err) => {
      if (pools[company] === p) delete pools[company]
      throw err
    })
    pools[company] = p
  }
  return p.then((pool) => {
    if (pool.connected) return pool
    if (pools[company] === p) delete pools[company]
    return getPool(company)
  })
}

type Param = string | number | Date | null

/**
 * Run one read-only statement. Dashboard queries never write, and every
 * request reads uncommitted so it cannot block the ERP's own users.
 */
export async function query<T = Record<string, unknown>>(
  company: Company,
  text: string,
  params: Record<string, Param> = {},
): Promise<T[]> {
  const pool = await getPool(company)
  const req = pool.request()
  // Strings go as varchar: an nvarchar parameter against the ERP's varchar
  // columns forces a conversion on every row and skips the indexes.
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") req.input(k, sql.VarChar(200), v)
    else req.input(k, v)
  }
  const r = await req.query("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; " + text)
  return (r.recordset ?? []) as T[]
}

export function friendlyDbError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/timed out|ETIMEOUT|Timeout/i.test(msg)) return "The database is responding slowly. Try again in a moment."
  if (/ECONN|ESOCKET|ENOTFOUND|Failed to connect/i.test(msg)) return "Cannot reach the database from this machine."
  return "Could not load this section."
}

/** Short in-memory cache so several open tabs do not repeat the same query. */
const cache = new Map<string, { at: number; value: Promise<unknown> }>()
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>
  const value = load().catch((e) => {
    cache.delete(key)
    throw e
  })
  cache.set(key, { at: Date.now(), value })
  return value
}
