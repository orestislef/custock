# @custock/web

Next.js 16 app. It is also the phone app: staff and customers add it to the home screen (PWA),
with camera scanning, offline stock work and web push. Three parts:

- **customer pages**, server rendered and small, opened from a QR code: `/j/[code]` join,
  `/confirm/[token]`, `/p/[code]` shelf product, `/s/[org]` catalog and offers,
  `/unsubscribe/[token]`.
- **admin** under `/admin`: dashboard, stock, scan, customers, posts with the audience breakdown,
  team and roles, reports, settings, QR codes with printable posters, shelf labels.
- **super admin** under `/admin/platform`: every business, feature switches, limits and options,
  errors, the API docs and server health.
- **customer app** under `/s/[org]`: catalog, offers, news, saved items, alerts and account, one
  home screen app per business.

Every string comes from `@custock/i18n` (english, greek, russian). Every screen is gated by the
permissions in `me()`, the server still decides.

## run

```
CUSTOCK_DEV=1 CUSTOCK_SEED=1 pnpm dev:api              # api on :8787, dev tools and the demo seed on
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
node apps/web/scripts/flows.mjs <dir>        # clicks through create, receive, post, count, transfer, outbox
```

The checks against the api expect it started with `CUSTOCK_DEV=1 CUSTOCK_SEED=1`: sample logins,
dev confirm links and the dev outbox only exist then. Nothing is ever sent, messages land in the
outbox.
