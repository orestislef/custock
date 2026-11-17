# @custock/web

Next.js 16 app with two halves:

- **customer pages**, server rendered and small, opened from a QR code: `/j/[code]` join,
  `/confirm/[token]`, `/p/[code]` shelf product, `/s/[org]` catalog and offers,
  `/unsubscribe/[token]`.
- **admin** under `/admin`: dashboard, stock, customers, posts with the audience breakdown,
  team and roles, reports, customer page settings, QR codes with printable posters.

Every string comes from `@custock/i18n` (english, greek, russian). Every screen is gated by the
permissions in `me()`, the server still decides.

## run

```
pnpm db:reset && pnpm dev:api                         # api on :8787
CUSTOCK_API_URL=http://localhost:8787 pnpm dev:web    # web on :3000, talks to the api
pnpm dev:web                                           # or with built in sample data, no api
```

Sample logins are on the login page (password `custock`).

## check

```
pnpm --filter @custock/web typecheck
pnpm --filter @custock/web lint
pnpm --filter @custock/web build
node apps/web/scripts/shots.mjs <dir>        # screenshots, sample data mode
node apps/web/scripts/real-check.mjs <dir>   # walks the admin as each role against the api
```
