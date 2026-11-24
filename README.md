# Daily Dashboard

Today's operations counts and the accounts funds-position sheet, read live from the ERP databases.

## Run

```
npm install
npm run dev -- -p 3210
```

`.env.local` needs the `MSSQL_MANILAL_*` and `MSSQL_LINKS_*` values (host, port, user, password, database). The app only reads the ERP.

## Sign-in

Every page needs a sign-in. Add people from a terminal in this folder; the password is typed at the prompt and only a salted hash is stored in `data/users.json`.

```
npm run add-user -- <username> <finance|ops> "Full name"
npm run add-user -- --list
npm run add-user -- --remove <username>
```

- `finance` sees Operations and Funds position.
- `ops` sees Operations only.

Running `add-user` again for the same username changes the password or role. The first run also writes `AUTH_SECRET` to `.env.local`; restart the app after that. Set `AUTH_COOKIE_SECURE=1` once the app is served over https.

## Data kept by the app

`data/` (not in git): `users.json`, and one `funds/<day>.json` per day holding the figures typed into the funds sheet.
