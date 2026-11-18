# 13. stack

What we build it with, piece by piece, and why. The reasoning for TypeScript over Flutter is in
[08-platform-choice](08-platform-choice.md). This file is the "with what" once that is settled.

## the short version

**decided:** TypeScript everywhere, one repo. the website is also the phone app.

| part | what | why |
|------|------|-----|
| phone app | the web app itself, added to the home screen (PWA), see [08](08-platform-choice.md) | one app to build and run, no store review, updates are live on deploy. one codebase for staff and customers |
| web | Next.js | customer pages must open fast from a QR with no install. admin needs real tables and charts on a big screen |
| server | Node + Hono | small, fast, typed, runs anywhere. same language as the app and web |
| database | SQLite | light, one file, no extra service |
| validation | zod | one schema checks input on the server and forms in the app and web |
| storage | Cloudflare R2 (S3 compatible) | free allowance covers us for a long time, no egress fees |
| push | Web Push with our own VAPID keys | works in every modern browser, on iPhone once the app is on the home screen. FCM stays as an optional channel on the server |
| mail | my own server, optional relay for bulk | already there for logins |
| repo | pnpm monorepo | shared code is a folder, not a published package |

## phone app

The phone app is the web app. What the browser gives us:

| piece | what for | how |
|-------|----------|-----|
| web app manifest | home screen icon, full screen | one manifest for staff, one per business for its customers, with the business's icon |
| service worker | offline pages, push, notification clicks | cache first for built files, network first for pages, never caches the api |
| camera + BarcodeDetector | barcode and QR scanning | native detector where the browser has one, a self hosted zxing wasm reader elsewhere (iPhone) |
| IndexedDB | offline outbox for stock movements | same idempotent movement ids as the server, syncs when the signal is back |
| Web Push (VAPID) | notifications | asked only from a tap, deep links into the right page |
| navigator.vibrate | the tick on each scan | Android only, iPhone has no web haptics |
| visualViewport | sheets above the keyboard | keeps buttons and fields visible while typing |

## web

| piece | what for | why this one |
|-------|----------|--------------|
| Next.js (app router) | customer pages and admin | server rendered customer pages are small and fast from a QR scan. admin lives in the same app under `/admin` |
| Tailwind CSS v4 | styling | reads our tokens from `packages/tokens`, so web and phone share colors, spacing and radius |
| Radix primitives or React Aria | menus, dialogs, popovers, selects | accessible behavior without a look. we style them ourselves so it does not end up looking like default shadcn |
| Motion | transitions | page and list transitions, shared layout animations on the dashboard |
| visx or Recharts | charts | visx if we want full control of the look, Recharts if we want speed. leaning visx for the dashboard, see [12](12-reports-and-analytics.md) |
| i18next | translations | same message files as the app |

Customer web pages: join page (`/j/<code>`), shelf product page (`/p/<code>`), public catalog and
offers of a shop (when the merchant turns them on), single post page for sharing, manage
subscription page from the email link (token based, no login).

## server

| piece | what for | why this one |
|-------|----------|--------------|
| Node (LTS) + Hono | the API | small, fast, typed routes, middleware for auth, org context and permission checks |
| `drizzle-orm` + `better-sqlite3` | database access | typed queries, migrations as plain sql files, synchronous sqlite driver that is the fastest option on one box |
| zod | input and output | the same schemas the app and web use |
| in-process job worker | sends, scheduled posts, rollups, cleanups | reads the `jobs` table. one process, no redis, no extra service |
| cron inside the worker | scheduled posts, nightly rollups, weekly report emails | same process, ticks every minute |

The custock API talks to my existing auth server for login and tokens (see [07](07-auth.md)) and
uses the same FCM credentials and mail setup that are already running there.

## repo layout

```
custock/
  apps/
    web/             next.js: staff, super admin and customer app, installs to the home screen
    api/             hono server + job worker
  packages/
    core/            permissions.json and generated constants, zod schemas,
                     money and quantity helpers, search normalisation, barcode normalisation
    i18n/            shared ICU messages: en, el, ru
    tokens/          design tokens (colors, type scale, spacing, radius, motion)
    db/              drizzle schema, migrations, seed data
  thinking/          these notes
  demo/              the static clickable demo for github pages
  scripts/           local scripts: check, test, build, deploy
```

Rules:

- anything used by two apps goes in `packages/`. no copy paste between apps.
- `packages/core` has no react and no node specific code, so it runs on the phone, in the browser
  and on the server.
- permission keys, error codes and message keys are generated or typed, so a typo is a compile error.

## database

**decided:** SQLite on the server for v1, schema written to move to PostgreSQL when it has to.
The draft is in [db/schema.sql](db/schema.sql).

Settings on every connection:

| pragma | value | why |
|--------|-------|-----|
| `journal_mode` | `WAL` | readers do not block the writer |
| `foreign_keys` | `ON` | sqlite has them off by default |
| `busy_timeout` | `5000` | wait instead of failing when the writer is busy |
| `synchronous` | `NORMAL` | safe with WAL, much faster than FULL |

- **one writer.** all writes go through one connection in the API process, reads use a small pool.
  sqlite handles thousands of small writes a second this way, far more than a few hundred shops need.
- **backups:** Litestream streams the WAL to object storage continuously, so we lose seconds at
  most. on top of that a nightly `VACUUM INTO` snapshot, kept for 30 days.
- **restore test once a month.** a backup nobody restored is a hope, not a backup.
- **migrations:** numbered plain sql files, forward only, applied at startup inside a transaction.
  no down migrations. a mistake gets fixed by the next migration.

**when to move to postgres:**

- more than one API server, or the API and worker need to scale apart.
- write contention shows up in the logs (busy timeouts).
- we want row level security as a second wall between tenants.
- reports get heavy enough that we want proper analytics queries.

What changes then: types map almost one to one (text, integer, real), partial indexes work the
same, the append only triggers become a trigger function or revoked UPDATE and DELETE grants,
FTS5 search becomes `pg_trgm` or `tsvector`, and Litestream becomes `pg_dump` plus WAL archiving.
Drizzle supports both, so the app code mostly stays.

**alternatives looked at:**

| option | why not now |
|--------|-------------|
| PostgreSQL from day one | more to run and back up on one server. the right next step, not the first one |
| PocketBase | sqlite + auth + admin UI in one binary, nice. but its auth overlaps my login server, and our scoped permission rules are awkward in its rule syntax |
| Supabase self-hosted | a lot of containers for one server. great when you want everything, heavy when you want light |
| Firestore | lock in, costs that grow with reads, and weak queries for reports |

## storage

**decided:** Cloudflare R2, behind our own storage interface so the provider is just config.

| option | free part | notes |
|--------|-----------|-------|
| **Cloudflare R2** | 10 GB-month storage, 1M class A and 10M class B operations per month, egress free | our pick. may ask for a payment method to turn it on |
| Backblaze B2 | first 10 GB free | egress free up to 3x what you store. good backup target for Litestream |
| AWS S3 | free tier is credit based for new accounts | not a long term free option |
| MinIO community edition | | archived in 2026. do not build on it |
| Garage or SeaweedFS | self hosted | only if we ever must self host objects |
| plain disk + nginx | free | fine to start, but backups are then our problem |

How we use it:

- **presigned uploads.** the app asks the API for an upload URL, the API decides the key, the app
  uploads straight to R2. our server never carries the bytes.
- **keys:** `orgs/<org>/products/<uuid>.webp`, `orgs/<org>/posts/<uuid>.webp`, `orgs/<org>/exports/<uuid>.csv`.
- **resize on the device** before upload: max 1600 px, webp or jpeg around 80% quality, plus a
  400 px thumbnail. keeps us inside the free allowance for a long time.
- **public bucket only for product and post images**, served through our custom domain.
- **private files** (exports, imports) live in a private bucket and are read through short lived
  presigned GET URLs. customer data never goes in the public bucket.
- every upload gets a row in `files`. a nightly **orphan cleanup** job deletes objects nobody
  points to anymore.

Sources: [R2 free tier](https://nubbo.app/blog/cloudflare-r2-free-tier/),
[B2 pricing](https://upstash.com/blog/backblaze-b2-pricing-explained-2026),
[MinIO status](https://glukhov.org/data-infrastructure/object-storage/minio-dead/). These are third
party summaries, check the official pricing pages before relying on the numbers.

## push

- **Web Push** from the server with our own VAPID keys. Subscriptions per person and device, scoped
  to a business for a business's home screen app.
- notifications for people: offers, back in stock, staff alerts, super admin alerts. title and body
  in the receiver's language, the business icon, the post or product photo where the platform shows
  it, action buttons, and a deep link to the exact page.
- a subscription the push service reports gone (404 or 410) is removed; sign out removes it too.
- **FCM HTTP v1** stays available on the server as an optional channel.

## email

- **transactional** (verify email, invites, password reset, double opt in) from my own server.
  needs SPF, DKIM, DMARC and reverse DNS set right, or it lands in spam.
- **bulk** (newsletters): own server is fine while volume is small. when it grows, an optional
  relay like Amazon SES or Brevo protects the reputation of the transactional mail.
- gmail and yahoo bulk sender rules apply: SPF and DKIM and DMARC, **one click unsubscribe**
  (`List-Unsubscribe` and `List-Unsubscribe-Post` headers), and a low spam complaint rate.
- from address: "Shop name via Custock" on our domain, reply-to the shop's own email. we do not
  send as the shop's domain unless they verify it, or DMARC fails.

## bot protection

Cloudflare Turnstile on public join pages and the notify me form. free, no puzzles for real
people. plus rate limits per IP and per join link on the API.

## deep links

- every notification and email link opens the exact page, signs in first when needed and switches
  to the right business, see the route map in the web app.
- `/j/<code>`, `/p/<code>` and `/s/<business>` are plain web pages, so a phone camera opens them
  straight from a QR code.

## environments

| env | where | data |
|-----|-------|------|
| dev | my machine | seed data |
| staging | same server as prod, other port and other database file | copy of seed data, never real customers |
| prod | the server | real |


## monitoring

- uptime check on the API and the join page (a free uptime service is enough).
- structured logs with request id, org id and user id. no customer emails or phones in logs.
- an error log for the super admin, browser and server errors, with personal data scrubbed.
- a tiny `/health` endpoint that checks the database and the job queue age.

## builds and deploys

**decided: no ci/cd, no github actions.** everything is built and shipped by hand.

- local scripts in `scripts/`: type check, lint, tests, i18n missing keys check, schema check.
  run before every release.
- **phone:** nothing to build, the web app is the phone app.
- **server:** deploy over ssh, docker compose or a systemd service. migrations run at startup.
- **web:** built locally, shipped to the server the same way.
- **demo:** the static clickable demo in `demo/` is served by github pages straight from the branch.
  no workflow file in the repo.
- versions: the git revision of each deploy is shown to the super admin.
