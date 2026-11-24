import { LoginForm } from "./login-form"

export const metadata = { title: "Sign in · Daily Dashboard" }

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = (await searchParams).next
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold tracking-tight">Daily Dashboard</h1>
        <p className="mt-1 text-sm text-muted">Sign in to see today&apos;s operations and funds position.</p>
        <LoginForm next={typeof next === "string" ? next : ""} />
      </div>
    </main>
  )
}
