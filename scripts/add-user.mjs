// Add a user, or change an existing user's password or role.
//   npm run add-user -- <username> <finance|ops> ["Full name"]
//   npm run add-user -- --remove <username>
//   npm run add-user -- --list
// The password is asked for on the keyboard and never shown or stored;
// only a salted scrypt hash goes into data/users.json.
import { randomBytes, scryptSync } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const file = path.join(root, "data", "users.json")
const envFile = path.join(root, ".env.local")
const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).users ?? [] : [])
const save = (users) => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ users }, null, 1))
}

// The cookie-signing secret is made once, on first use.
const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : ""
if (!/^AUTH_SECRET=.{32,}/m.test(env)) {
  appendFileSync(envFile, `${env.endsWith("\n") || !env ? "" : "\n"}AUTH_SECRET=${randomBytes(48).toString("base64url")}\n`)
  console.log("Made a new signing secret in .env.local. Restart the app so it is picked up.")
}

const args = process.argv.slice(2)
if (args[0] === "--list") {
  for (const u of load()) console.log(`${u.user.padEnd(20)} ${u.role.padEnd(8)} ${u.name}`)
  process.exit(0)
}
if (args[0] === "--remove") {
  const left = load().filter((u) => u.user !== String(args[1]).toLowerCase())
  save(left)
  console.log(`Removed. ${left.length} user(s) left.`)
  process.exit(0)
}

const [userRaw, role, name] = args
const user = String(userRaw ?? "").trim().toLowerCase()
if (!/^[a-z0-9._-]{2,40}$/.test(user) || !["finance", "ops"].includes(role)) {
  console.error('Usage: npm run add-user -- <username> <finance|ops> ["Full name"]')
  console.error("  finance = Operations and Funds position.   ops = Operations only.")
  process.exit(2)
}

function ask(prompt) {
  // DD_NEW_PASSWORD lets an automated test create its own throwaway user.
  if (process.env.DD_NEW_PASSWORD) return Promise.resolve(process.env.DD_NEW_PASSWORD)
  if (!process.stdin.isTTY) {
    console.error("Run this in a terminal so the password can be typed.")
    process.exit(2)
  }
  return new Promise((done) => {
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    let text = ""
    const onData = (buf) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.off("data", onData)
          process.stdout.write("\n")
          return done(text)
        }
        if (ch === "\u0003") process.exit(130)
        if (ch === "\u007f" || ch === "\b") text = text.slice(0, -1)
        else text += ch
      }
    }
    process.stdin.on("data", onData)
  })
}

const pw = await ask(`Password for ${user}: `)
if (pw.length < 10) {
  console.error("Use at least 10 characters.")
  process.exit(2)
}
if (!process.env.DD_NEW_PASSWORD && (await ask("Type it again: ")) !== pw) {
  console.error("The two did not match. Nothing changed.")
  process.exit(2)
}
const salt = randomBytes(16)
const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 })
const users = load().filter((u) => u.user !== user)
users.push({ user, name: name || user, role, salt: salt.toString("hex"), hash: hash.toString("hex") })
save(users)
console.log(`Saved ${user} (${role}). ${users.length} user(s) in total.`)
