# @custock/api

The Custock API. Hono on Node, SQLite through better-sqlite3, the shared contract from
`@custock/core`.

## run

```
pnpm db:reset          # from the repo root, builds apps/api/data/custock.db with the Lemoni data
pnpm dev:api           # http://localhost:8787, reloads on change
```

If the database file does not exist, `pnpm dev:api` creates and seeds it.

Environment:

| var | default | what |
|-----|---------|------|
| `CUSTOCK_DEV` | off | `1` turns on dev features: dev codes in responses, `/v1/dev/*`, the bot check stand in, the dev secret. `pnpm dev:api` passes `--dev`, which does the same |
| `CUSTOCK_JWT_SECRET` | none | required outside dev, a random value of 32 characters or more. the server refuses to start without it |
| `CUSTOCK_UNSUB_SECRET` | derived from the jwt secret | key for unsubscribe links |
| `CUSTOCK_TURNSTILE_SECRET` | none | bot check secret for join pages. outside dev, public signups are refused without it |
| `CUSTOCK_TURNSTILE` | `on` | `off` takes public signups without the bot check, on purpose and logged loudly at startup. rate limits still apply |
| `CUSTOCK_INTERNAL_KEY` | none | 32+ random characters shared with the web server in the same container. with it, the web passes the visitor's address in `X-Custock-Client-Ip` for rate limits and consent records |
| `CUSTOCK_TRUSTED_PROXY` | off | `1` when the api sits behind our own reverse proxy: the rightmost `X-Forwarded-For` hop is the client. otherwise the socket address is used |
| `CUSTOCK_SEED` | off | `1` seeds the made up Lemoni business into a new database. dev always does. outside dev it needs `CUSTOCK_SEED_PASSWORD` |
| `PORT` | 8787 | |
| `CUSTOCK_DB` | `apps/api/data/custock.db` | sqlite file |
| `CUSTOCK_PUBLIC_WEB_URL` | `http://localhost:3000` | base for join, confirm, invite and unsubscribe links |
| `CUSTOCK_CORS` | localhost 3000, 8081, 19006 | allowed origins |
| `CUSTOCK_WORKER` | on | `0` turns the job loop off |
| `CUSTOCK_API_URL` | `http://localhost:<PORT>` | the api's own public address, for upload links and files it serves |
| `CUSTOCK_UPLOAD_DIR` | next to the database, `uploads/` | where dev uploads are stored |
| `CUSTOCK_AUTH_MODE` | `local` | `local` is the built in login. `jwks` trusts the real login server |
| `CUSTOCK_AUTH_JWKS_URL`, `CUSTOCK_AUTH_ISSUER`, `CUSTOCK_AUTH_AUDIENCE` | | required with `jwks` |
| `CUSTOCK_TRANSPORT` | `outbox` | `outbox` keeps every message in the database. `live` sends them |
| `CUSTOCK_ALLOW_SENDING` | | must be `yes` for `live` |
| `CUSTOCK_VAPID_PUBLIC_KEY`, `CUSTOCK_VAPID_PRIVATE_KEY`, `CUSTOCK_VAPID_SUBJECT` | | web push to the installed web app. `pnpm --filter @custock/api vapid` prints a pair. the subject is `mailto:you@example.com` or an https url. the public key is also served at `GET /v1/push/key`, in any mode |
| `CUSTOCK_FCM_SERVICE_ACCOUNT` | | path to the Firebase service account json, only for a native app |
| `CUSTOCK_SMTP_URL`, `CUSTOCK_MAIL_FROM` | | the mail server and our sender address. Gmail: `smtps://name%40gmail.com:apppassword@smtp.gmail.com:465` (the @ of the user written as `%40`, the 16 letter app password without spaces) and `CUSTOCK_MAIL_FROM=name@gmail.com` |

Running on a server: see [deploy/README.md](../../deploy/README.md).

## a production database

A server starts with an empty database. The first business and its owner come from the command
line, in the container:

```
docker exec -it custock node --import tsx apps/api/src/cli.ts create-business \
  --name "Lemoni" --slug lemoni --owner-email eleni@example.com --owner-name "Eleni" --shop "Kifisia"
docker exec -it custock node --import tsx apps/api/src/cli.ts add-shop --org lemoni --name "Marousi"
docker exec -it custock node --import tsx apps/api/src/cli.ts set-password --email eleni@example.com
```

The password comes from `CUSTOCK_NEW_PASSWORD`, or from stdin with `--password-stdin`, otherwise a
random one is printed once. `create-business` refuses an email that already has an account.
`set-password` signs the person out everywhere. Locally: `pnpm --filter @custock/api cli <command> ...`.

The owner then invites the team from the admin. While mail is not live the invite comes back with
its link to share by hand. A new person opens it, sets a name and password and is in.

Customers need mail: joining from a QR code ends with a confirmation email (double opt in), and the
customer sign in is a code by email. Until `CUSTOCK_SMTP_URL` is live those emails wait in the
outbox. The join page also needs `CUSTOCK_TURNSTILE_SECRET`, or `CUSTOCK_TURNSTILE=off`.

## dev logins

Password for all of them: `custock`.

| email | who |
|-------|-----|
| eleni@example.com | owner of Lemoni |
| nikos@example.com | admin |
| maria@example.com | manager, Kifisia |
| giorgos@example.com | manager, Glyfada |
| dimitris@example.com | staff, Kifisia |
| katerina@example.com | staff, Marousi |
| sofia@example.com | viewer (accountant) |
| anna@example.com | customer, follows Lemoni |

Customers can also sign in with a one time code: `POST /v1/auth/otp/request` returns `devCode` in
dev. Outside dev, codes only sign in customer accounts (users without a password). Nothing is ever sent. Every email, push and sms lands in the `dev_outbox` table instead, and
owners and admins can read it at `GET /v1/dev/outbox`.

## test

```
pnpm --filter @custock/api test
```

Several suites on fresh in-memory databases: the read side (with a second business to prove nothing
leaks), the write side and the edge cases from `thinking/15-edge-cases.md`, and the shared client
against every path.

## endpoints

All under `/v1`. Errors are `application/problem+json` with a stable `code`.

Read:

- auth: `POST /auth/login`, `/auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `/auth/logout`
- me: `GET /me/context`
- org: `GET /orgs/{org}`, `/orgs/{org}/shops`, `/groups`, `/categories`, `/audit`
- catalog: `GET /orgs/{org}/products` (`q`, `shopId`, `filter=low|out|negative|waiting`, `categoryId`, `cursor`, `limit`), `/products/{id}`, `POST /scan`, `GET /unknown-scans`, `/movements`, `/shops/{shop}/sync?since=`
- stock: `GET /orgs/{org}/counts`, `/counts/{id}`, `/transfers`, `/transfers/{id}`
- customers: `GET /orgs/{org}/customers`, `/customers/{id}`, `/join-links`
- posts: `GET /orgs/{org}/posts`, `/posts/{id}`
- team: `GET /orgs/{org}/members`, `/roles`, `/roles/grantable?scopeType=&scopeId=`, `/roles/{id}/impact`, `/invites`
- reports: `GET /orgs/{org}/reports/dashboard`, `/sales`, `/top-sellers`, `/most-wanted`, `/join-links`, `/shrinkage`
- customer app: `GET /c/feed`, `/c/offers`, `/c/shops`, `/c/alerts`, `/c/favorites`, `/c/orgs/{slug}/catalog`, `/c/orgs/{slug}/products/{id}`
- public: `GET /public/join/{code}`, `/public/p/{code}`, `/public/orgs/{slug}/catalog`, `/public/subscription/{token}`

Write:

- me: `PATCH /me`, `GET /me/export`, `DELETE /me` (refused for the last owner of a business)
- org: `PATCH /orgs/{org}`, `PATCH /orgs/{org}/shops/{shop}`
- catalog: `POST /products`, `PATCH /products/{id}`, `POST /products/{id}/archive`, `PATCH /variants/{v}/price`, `PUT /shops/{shop}/variants/{v}/settings`, `POST /variants/{v}/barcodes`, `POST /barcodes/internal`, `POST /unknown-scans/{id}/resolve`
- stock: `POST /movements` (a batch, one result per movement), counts (`POST /shops/{shop}/counts`, `PUT /counts/{id}/lines/{v}`, `POST /counts/{id}/submit`, `/apply`, `/cancel`), transfers (`POST /transfers`, `/transfers/{id}/send`, `/receive`, `/cancel`)
- customers: `POST /customers`, `POST /customers/{id}/notes`, `PUT /customers/{id}/tags`, `POST /customers/{id}/erase`, `POST /join-links`, `PATCH /join-links/{id}`
- posts: `POST /posts`, `PATCH /posts/{id}`, `DELETE /posts/{id}`, `POST /posts/audience-preview`, `POST /posts/{id}/publish` (publishes, or submits for approval when the caller cannot publish), `/approve`, `/cancel`
- team: `POST /invites` (returns the accept `link` to share by hand, and `emailed`), `POST /invites/{id}/revoke`, `POST /v1/invites/accept`, `POST /members/{m}/assignments`, `DELETE /members/{m}/assignments/{a}`, `PATCH /members/{m}`, `POST /roles`
- invite link, no sign in: `GET /v1/invites/{token}` (who invites, to what, and whether the email has an account), `POST /v1/invites/register` (a new person sets a name and password and joins). an email that already has an account gets 409 `account_exists`: sign in, then `POST /v1/invites/accept`
- shops: `POST /orgs/{org}/shops` (needs `shops.create`), `GET /orgs/{org}/shops?all=1` (every shop, for transfer destinations, needs `stock.transfer.send` somewhere)
- web push: `GET /v1/push/key`, `POST /v1/me/push-subscriptions` (the browser's subscription, optional `orgId` for one business's home screen app), `DELETE /v1/me/push-subscriptions`
- customer app: `POST /c/join/{code}`, `POST /c/follow`, `POST /c/unfollow`, `PUT /c/channels`, `POST /c/alerts`, `DELETE /c/alerts/{id}`, `PUT /c/favorites/{product}`
- public: `POST /public/join/{code}`, `POST /public/confirm`, `POST /public/subscription/{token}`
- me: `POST /me/email`, `POST /me/email/verify` (email change with a code to the new address)
- catalog: `DELETE /variants/{v}/barcodes/{id}` (sync reports it as a tombstone)
- stock: `GET /orgs/{org}/review/negative` (movements accepted offline below zero in strict mode, needs `stock.adjust`)
- dev only: `GET /v1/dev/outbox`, `POST /v1/dev/run-jobs`

Creates take an `Idempotency-Key` header: the same key from the same user on the same org, method and
path within 24 hours returns the first answer. Product and post reads return an `ETag`. An edit with a stale `If-Match` gets
412 `conflict`.

The join page uses a stand in for the bot check: in dev it accepts no token or `dev-turnstile-ok`.

`/reports/sales` returns money per day when the caller may see money, otherwise pieces sold. The
`X-Series-Unit` header says which.

## browsing the api

`GET /v1/openapi.json` is an OpenAPI 3.1 document built from the registered routes and the zod
contract (`z.toJSONSchema`). Paste the url into any OpenAPI viewer.

## sign in: local or the real login server

`CUSTOCK_AUTH_MODE=local` (the default) is the built in login with short access tokens and rotating
refresh tokens. With `CUSTOCK_AUTH_MODE=jwks` the api trusts tokens from the real login server:
RS256 or ES256, checked against its JWKS, issuer and audience. `sub` is the user id. A user row is
made the first time a subject is seen, with the `email`, `name` and `locale` claims; an email that
already belongs to another account is not taken over. Customer records with the same confirmed
email are linked when `email_verified` is true. In this mode our own `/v1/auth/*` endpoints answer
404, the login server owns sign in.

## messages: outbox or live

Every email and push is written to the `dev_outbox` table first. In `outbox` mode (the default)
that is where it stays, for reading in the admin. In `live` mode the worker drains the table through
the channels that are set up, each on its own:

- web push (VAPID): to every web push subscription of the person, the ones for this business and
  the ones for all businesses. a subscription the push service calls gone (404, 410) is dropped,
  one that keeps failing too. silent pushes never go by web push.
- FCM HTTP v1: a service account, one message per device token, a dead token is dropped.
- email through SMTP.

A channel without any of its settings stays off and its messages wait in the outbox. A channel with
some settings but not all refuses to start the server, so nothing half works. The startup log has
one line per channel. `CUSTOCK_ALLOW_SENDING=yes` is needed for any of it.

What a message carries:

- push: the shop or business as title, the post title (or the back in stock line) in the reader's
  language, the cover image, `custock://post/<id>` or `custock://product/<id>` as the deep link,
  the org as the iOS thread id so the lock screen groups per business. Permission changes go as
  silent data pushes.
- web push: json `{ title, body, url, tag, type, orgId, image }` for the service worker. `url` is
  the page a tap opens under `CUSTOCK_PUBLIC_WEB_URL`: `/s/<slug>?post=<id>` for a post,
  `/s/<slug>/p/<product>` for back in stock, `/admin/posts/<id>`, `/admin/stock/counts/<id>`,
  `/admin/stock/transfers/<id>`, `/admin/stock/<product>` (low stock), `/admin/team` for staff.
  TTL 12 hours for staff alerts (urgency high), 2 days for posts, 3 for back in stock, and a topic
  so a phone that was offline only gets the newest of the same message.
- email: "Lemoni Kifisia via Custock" as the sender name with our address, reply-to the shop,
  `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, the unsubscribe link
  in the footer, `Content-Language` set to the reader's language.

## photos and uploads

`POST /orgs/{org}/uploads/presign` with `{ purpose, mime, bytes }` returns a signed upload slot:
jpeg, png or webp, up to 5 MB, valid 10 minutes, needs the permission of the thing it is for. In
dev the api stores the file under `CUSTOCK_UPLOAD_DIR` after checking the size, the type and the
first bytes, and serves it at `/files/uploads/<org>/<file>`. Use that url in `imageUrls`. Outside
dev the endpoint answers 501 until object storage (R2) is wired; the response shape stays the same.

Products take the full list of `variants` (sku, options, price, cost, barcodes) and `imageUrls`
on create and update. Variants left out are archived when they have history and deleted when they
do not. A changed price needs `products.price.edit`, a cost needs `products.cost.edit`.

## languages

Names come back in the reader's language: `Accept-Language`, else the signed in person's language,
else the business default. That covers categories, `product.displayName` and `categoryName`
(staff keep `name` in the default language, it is the one they edit), customer facing product
names, linked products in posts, report names, count and transfer lines, `movement.productName`,
and the join page interests.

## speed

`pnpm --filter @custock/api bench` builds a made up business with 2,000 products, 200,000 stock
movements and 20,000 customers in a temporary database and times the main reads. On the
development machine (Windows 10, node 22, sqlite 3.54 with FTS5), median of 7 runs:

| endpoint | median ms | worst ms |
|---|---:|---:|
| products, first page | 6 | 7 |
| products, search "meli" | 5 | 7 |
| products, low stock filter | 28 | 30 |
| product detail | 3 | 3 |
| customers, first page (owner) | 52 | 57 |
| customers, first page (shop manager) | 60 | 67 |
| customers, search "maria" | 23 | 27 |
| customers, exact phone | 24 | 24 |
| movements, first page | 2 | 2 |
| dashboard (owner, all shops) | 42 | 48 |
| dashboard (shop manager) | 17 | 18 |
| sales per day, 30 days | 108 | 109 |
| top sellers, 30 days | 44 | 45 |
| most wanted | 3 | 3 |
| shrinkage, 30 days | 7 | 8 |
| sync, full (one shop) | 56 | 58 |

`CUSTOCK_PERF=1 pnpm --filter @custock/api test` runs the same check as a test (under 150 ms each).
Search uses FTS5 tables over the normalised `search_key`, kept in step by triggers and rebuilt when
the server starts (row ids can move after a restore). Without FTS5 in the sqlite build it falls
back to `LIKE`. Reports group the ledger in sql before joining products, and a covering index
serves the sales queries.

## the worker

The server runs a job loop every 5 seconds. Jobs live in the `jobs` table:

- `send_post`: snapshots the audience into `deliveries`, one row per customer per channel, with a
  reason when skipped (no consent, no device, cap reached, suppressed). Pushes in quiet hours are
  held until they end. Scheduled posts run at their time.
- `send_deliveries`: sends through the dev transport in each recipient's language, with an
  unsubscribe link and one click headers on emails. Back in stock alerts go out the same way.
- `rollup_day`: rebuilds `daily_shop_stats` for the last three days, once a day.

## limits

- per ip: 20 auth calls and 120 public calls a minute.
- per email: 5 wrong passwords in 15 minutes lock login for 15 minutes. 5 codes an hour. 5 wrong
  codes in 15 minutes lock codes for 15 minutes. 3 join confirmations an hour per business.
- bodies up to 1 MB, lists and free text have maximum lengths in the shared contract.
- a 500 never says what broke, the details go to the server log with the request id.

## rules the code keeps

- `/v1/orgs/{org}/*` loads the member's role assignments and builds their access with
  `@custock/core`. Not a member looks the same as not existing (404).
- "posts need approval" removes `posts.publish` from every role ranked below admin.
- every business query goes through `Tenant`, which refuses sql without `@org`.
- the stock ledger is append only. Each movement checks its own permission, sign and reason. The
  movement id is the idempotency key. Negative stock follows the org policy, and a movement older
  than two minutes counts as made offline and is accepted with an audit row.
- back in stock fires only on receive, transfer in and return, once per alert. Low stock fires once
  per dip below the reorder point.
- delegation: scope, ceiling, rank, no self service, and at least one owner, checked on every
  invite, assignment, member change and role edit. a member's status is judged at every scope they
  hold. an invite never brings back the old roles of a suspended or removed member.
- consent belongs to the customer: a join page or a staff member only creates a pending request
  held with the confirmation token. nothing about an existing customer changes until they click,
  and a join never withdraws anything. one click unsubscribe stops email from the whole business.
- contact details are not in the searchable key. callers who may see contacts can find someone by
  the whole email or phone number, nobody can find them by a piece of it.
- status changes (count apply, transfer send and receive, publish, approve, cancel, invite accept,
  confirm) are one shot: the update only happens from the expected status.
- held and queued messages are checked again when they go out: consent, following, suppression.
- unconfirmed signups are erased after 30 days by the nightly job.
