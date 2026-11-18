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

Every string comes from `@custock/i18n` (english, greek, russian). The browser imports
`@custock/i18n/client` and downloads only the reader's language; the server keeps its own texts. Every screen is gated by the
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

## speed

A big business has to feel the same as a small one, on a mid range phone with a slow connection.

- **one language per visitor.** `@custock/i18n/client` loads the reader's language as its own
  file (common and web texts only). The server texts (emails, pushes) never reach the browser.
  The language switch fetches the next language once and keeps the old screen until it is there.
- **no zod where it is not needed.** The shared packages are marked free of side effects and the
  zod schemas live in their own files (`core/src/zod.ts`, `policy-schemas.ts`, with `featureOn`
  in `features.ts`), so a page that only checks a feature or a right ships none of it. The product
  form still validates with the shared schema, so that screen keeps it.
- **long lists in pages.** Stock and customers come 100 at a time, posts 50, a product's history
  20, and the next page loads when the end of the list scrolls into view (a real button too). The
  count says "first 100 shown" until everything is there. Sorting the stock table by a stock
  column, or names from z, loads the rest first.
- **heavy parts on demand.** The camera of a barcode field loads when its sheet opens, the wasm
  barcode reader only in browsers without a built in one. The charts (plain svg), the calendars
  and the API docs tree are a few KB each and stay with their screens, so they are there at once.

Measure it on a local copy with thousands of products, 200,000 movements, 20,000 customers, 600
posts, 5,000 audit rows and 300 more businesses (never on a server):

```
node --import tsx apps/api/scripts/big-db.ts <db file>      # prints the owner login
E2E_BUILD_DIR=e2e-build-big E2E_BASE_PATH='' E2E_API_PORT=8861 node apps/web/e2e/build.mjs
node apps/web/scripts/route-sizes.mjs e2e-build-big/web       # first load js per route, gzip
PERF_OWNER=owner.<id>@example.com PERF_API_PORT=8861 node apps/web/scripts/perf.mjs e2e-build-big <db file>
```

`PERF_API_PORT` has to be the port the build was made with (the web's `/api` rewrite is fixed at
build time). The phone is 390x844 with the CPU slowed 4 times, 150 ms latency, 1.6 Mbit down.

Before and after the work above, on the big business (November 2026):

| | before | after |
|---|---:|---:|
| language texts in the browser | one 411 KB chunk (110 KB gzip): en, el, ru and the server texts, on every page | the reader's language only, 20 to 27 KB gzip |
| first load js, QR join page (build) | 305 KB gzip | 177 KB + language |
| first load js, sign in / staff screens (build) | 325 to 334 KB | 200 to 208 KB + language |
| first load js, new product (build) | 334 KB | 304 KB + language |
| js downloaded, QR join page (browser) | 309 KB | 214 KB |
| js downloaded, staff home (browser) | 342 KB | 249 KB |
| phone, QR join page ready | 3.4 s | 3.0 s |
| phone, sign in ready | 3.0 s | 2.7 s |
| phone, staff home ready | 3.9 s | 3.6 s |
| phone, stock list ready | 4.5 s (200 products) | 4.5 s (100 products, more on scroll) |
| phone, customers ready | 3.7 s | 3.5 s |
| phone, all businesses (super admin) ready | 3.4 s | 3.3 s |
| desktop, staff home / stock list ready | 336 / 496 ms | 257 / 345 ms |
| phone, stock search until the list changes | 1.2 to 1.3 s | 0.7 s |
| phone, customers again with cached files | 2.0 s | 1.8 s |
| desktop, 60 moves between busy screens, js heap | 6 MB to 9 MB | 4.7 MB to 7.6 MB |
| a product's history | the shop's latest 30, filtered in the browser: empty for most products | its own movements, 20 a page, about 5 ms on 200,000 movements |
| stock list request | 200 products, about 360 KB of json | 100 products, 180 KB (12 KB gzip) |
| reports page | also downloaded 200 whole products to look up units | only the report data |

Still worth knowing: the offline copy for the scan screen is about 1.9 MB of json for 2,000
products (one shop, synced once and then only changes), and a 365 day sales report takes about half
a second on the api.
