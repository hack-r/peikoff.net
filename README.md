# peikoff.net

A Cloudflare Worker serving the website from `public/`.

## Develop

Install dependencies and start the local Wrangler server:

```sh
npm install
npm run dev
```

## Deploy

Authenticate with Wrangler, then deploy the Worker:

```sh
npx wrangler login
npm run deploy
```

The Worker forwards requests to the static asset binding. Unmatched routes fall
back to `public/index.html`, so the scaffold also supports client-side routing.
