# 08. platform choice

What we write custock in. I know Flutter, so Flutter was the starting point. This file is the
honest comparison and the pick.

## the pick

**decided: TypeScript everywhere, and the website is the phone app.** Staff and customers use the
same site, in the browser or added to the home screen as a web app (PWA). No store app.

- **app:** Next.js. staff screens, the super admin area and the customer app per business, all in
  one, server rendered where it matters and installable to the home screen.
- **server:** Node + Hono on SQLite, zod for validation.
- **one pnpm monorepo** with shared packages: `core` (permissions, schemas, money, quantities,
  search normalisation, validation rules), `i18n` (all strings in en, el, ru), `tokens` (colors,
  type, spacing, motion).

Why:

- one app to build and run. the web had to exist anyway (join pages, the admin), so the phone app
  is the same code.
- no app store review, no builds on a mac, updates are live the moment we deploy.
- a shop can put "add us to your home screen" on a poster. each business gets its own home screen
  app with its own name and icon (a manifest per business).
- **one source of truth** for permissions, validation and translations, imported directly by the
  web and the server.
- a big pool of people who can help with React and TypeScript.

What the browser gives us, and the limits we accept:

| need | on the web | limit |
|---|---|---|
| scanning | camera plus BarcodeDetector, a self hosted zxing wasm reader where the browser has none (iPhone) | a bit slower than a native scanner, fine for counter and shelf work |
| push | Web Push with our own VAPID keys | on iPhone only after the app is added to the home screen (iOS 16.4 and up), no big pictures there |
| offline stock work | service worker plus an IndexedDB outbox, same idempotent movement ids | iPhone may clear storage of sites not used for weeks, the outbox syncs on every open |
| haptics | navigator.vibrate on Android | none on iPhone |
| look and feel | our own tab bar, sheets, transitions, safe areas, standalone mode | not the system tab bar, so the glass look is drawn by us |

## what the product actually needs

1. **a phone app that feels native and polished.** smooth transitions, tab bars and sheets that
   behave like the platform's, safe areas, no jumps when the keyboard opens.
2. **continuous barcode scanning** that is fast and does not drain the battery.
3. **offline** stock work with a local store and an outbox.
4. **push notifications** that deep link to the exact page.
5. **web pages that open in a second from a QR code**: join page, shelf product page, public
   catalog, manage subscription. no install needed.
6. **an admin on wide screens**: product editing, reports with charts, team and roles, tables.
7. **three languages everywhere**: screens, emails, push texts, dates and numbers, from one source.
8. **one set of rules everywhere**: permissions, validation, money and quantity math, search
   normalisation. the web and the server must agree, or we get holes.
9. **a small team** that can grow, and no ci/cd.

## the options we compared

| | Flutter everywhere | native Swift + Kotlin + web | TypeScript, the web app is the phone app |
|---|---|---|---|
| phone look | drawn by flutter, imitates the platform | best | drawn by us with the platform's patterns |
| public web pages | flutter web is heavy (canvas, slow first load), needs a second stack anyway | needs a web stack | **the same app** |
| admin on wide screens | works but does not feel like the web | needs a web stack | **the same app** |
| shared rules with the server | only with a dart server | via codegen | **direct imports** |
| translations | ARB in the app, something else on web and server | three formats | **one JSON source** |
| store review and builds | yes, a mac for iOS | yes, a mac for iOS | **none** |
| codebases | 1 plus web pages anyway | 3 | **1** |

## when I would pick Flutter instead

- if the team that builds this is Flutter only and nobody wants to touch React.
- if the web part shrinks to just the join page and the admin lives in the app.

The thinking in every other file still holds then; only [13-stack](13-stack.md) changes.

## no ci/cd

Same rule in any stack: no github actions, no pipelines. local scripts for lint, tests, the
missing translations check and builds. deploys by hand over ssh. see [13](13-stack.md).
