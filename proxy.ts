import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE, canSee, openSession } from "@/lib/session"

// Every page and API route sits behind sign-in. Pages re-check the session
// themselves, so this is the first gate, not the only one.
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  let session = null
  try {
    session = openSession(req.cookies.get(SESSION_COOKIE)?.value)
  } catch {
    session = null // no signing secret configured: nobody is signed in
  }

  if (pathname === "/login") {
    return session ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next()
  }
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in again." }, { status: 401 })
    const to = new URL("/login", req.url)
    if (pathname !== "/") to.searchParams.set("next", pathname + search)
    return NextResponse.redirect(to)
  }
  if (!canSee(session.role, pathname)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not allowed." }, { status: 403 })
    return NextResponse.redirect(new URL("/", req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
