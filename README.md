# peikoff.net

A Cloudflare Worker serving the website from `public/` with a D1-backed API.

The homepage is a virtual terminal. Users must enter the correct password
first, then they can run read-only SQLite `SELECT` statements. Query results are
rendered in a table in the page.

## Develop

Install dependencies and start the local Wrangler server:

```sh
npm install
npm run dev
```

Create the D1 database and update `wrangler.toml` with the real `database_id`:

```sh
npx wrangler d1 create whoneedsit
```

Set the Worker secret used by the password gate:

```sh
npx wrangler secret put USER_PASSWORD
```

Important: a GitHub repository variable/secret is not directly available at
Worker runtime. The Worker can only read values configured in Cloudflare for
the Worker itself (Secrets/Vars), or values injected during a deployment step.

The Worker includes `GET /api/tables`, which reads from the `whoneedsit` D1
binding and returns the current table names.

It also includes:

- `POST /api/auth` to verify the password
- `POST /api/query` to execute password-gated read-only `SELECT` SQL against D1

## Deploy

Authenticate with Wrangler, then deploy the Worker:

```sh
npx wrangler login
npm run deploy
```

The Worker forwards non-API requests to the static asset binding. Unmatched
routes fall back to `public/index.html`, so the scaffold also supports
client-side routing.
