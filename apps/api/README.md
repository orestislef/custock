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
| `CUSTOCK_STORAGE` | `local` in dev, off on a server | `s3` (R2 or AWS, needs the `CUSTOCK_S3_*` settings below), or `local` for files under `CUSTOCK_UPLOAD_DIR`. see photos and uploads |
| `CUSTOCK_S3_BUCKET`, `CUSTOCK_S3_REGION`, `CUSTOCK_S3_ENDPOINT`, `CUSTOCK_S3_ACCESS_KEY_ID`, `CUSTOCK_S3_SECRET_ACCESS_KEY`, `CUSTOCK_S3_PUBLIC_URL` | | the photo bucket. any of them set means s3, and then all but the endpoint are needed |
| `CUSTOCK_OWN_DOMAINS` | | more hosts our shelf QR codes may point at, comma separated. the host of `CUSTOCK_PUBLIC_WEB_URL` always counts |
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
  --name "Lemoni" --slug lemoni --owner-email eleni@example.com --shop "Kifisia"
docker exec -it custock node --import tsx apps/api/src/cli.ts invite-owner --org lemoni --email eleni@example.com
docker exec -it custock node --import tsx apps/api/src/cli.ts add-shop --org lemoni --name "Marousi"
docker exec -it custock node --import tsx apps/api/src/cli.ts set-password --email eleni@example.com
```

`create-business` makes the owner one of two ways:

- `--invite`, the default when mail is live: no password is made or mailed. The owner gets a "Your
  Custock is ready" email with a link (the link is printed too), opens it, sets a name and password
  and is the owner. The link works for 14 days and once, `invite-owner` makes a fresh one and the old
  one stops working. An email that already has an account signs in and accepts instead.
- `--set-password`, the default otherwise: the account is made now with `--owner-name`. The password
  comes from `CUSTOCK_NEW_PASSWORD`, or from stdin with `--password-stdin`, otherwise a random one is
  printed once. It refuses an email that already has an account.

`set-password` signs the person out everywhere. Locally: `pnpm --filter @custock/api cli <command> ...`.

The owner then invites the team from the admin. While mail is not live the invite comes back with
its link to share by hand. A new person opens it, sets a name and password and is in.

Customers need mail: joining from a QR code ends with a confirmation email (double opt in), and the
customer sign in is a code by email. Until `CUSTOCK_SMTP_URL` is live those emails wait in the
outbox. The join page also needs `CUSTOCK_TURNSTILE_SECRET`, or `CUSTOCK_TURNSTILE=off`.

## the platform: super admins

A super admin sits above every business owner: every permission in every business without being a
member of it, the screens at `/admin/platform`, and `/v1/platform/*` (403 for everyone else). The
first one comes from the command line, the account has to exist first:

```
docker exec -it custock node --import tsx apps/api/src/cli.ts make-superadmin --email me@example.com
docker exec -it custock node --import tsx apps/api/src/cli.ts remove-superadmin --email someone@example.com
docker exec -it custock node --import tsx apps/api/src/cli.ts delete-business --slug test --confirm test
```

More super admins are invited from the app (the link works 7 days and once, an existing account
signs in and accepts). The last one can never be removed, and nobody removes himself.
`delete-business` only takes a business without products, customers, posts or stock movements.

What a super admin decides, enforced in one place (`routes/platform.ts` guards, `lib/platform-access.ts`):

- per business features (`customer_pages`, `posts`, `email`, `push`, `transfers`, `counts`, `reports`,
  `uploads`): a route of a switched off feature answers 403 `feature_off`, sending skips with
  `feature_off`. the web simply leaves those screens and buttons out.
- per business limits (`maxShops`, `maxStaff`, pending invites count as staff): 403 `limit_reached`,
  and `shopsFull` / `staffFull` in the context so the apps leave the add button out.
- a paused business (`suspended`): its staff get 403 `org_suspended` and a calm paused screen, its
  customer pages say it is not available, nothing is sent for it. a super admin still gets in.
- platform wide pauses: `pause_email`, `pause_push` (messages wait in the outbox), `pause_signups`,
  `pause_invites`.
- the photo storage free tier: bytes stored and uploads this month against
  `CUSTOCK_STORAGE_FREE_BYTES` (10 GB) and `CUSTOCK_STORAGE_FREE_WRITES` (1,000,000). with
  "stop uploads at the free limit" on (the default), uploads past 95% answer 403 `storage_full`.

Every super admin action lands in `platform_audit` with before and after; inside a business it is
also in that business's audit log, marked `platform_admin`.

## emails

Every email has an html part that looks like the app and a plain text part with the same words:
the sign in code, the join confirmation (double opt in), staff invites, the first owner's "Your
Custock is ready", the email change code and notice, posts and offers (title, text, cover, linked
products with price, and for offers the lowest price of the last 30 days), and back in stock.
Staff alerts (low stock, approvals, counts, transfers) are push only.

The layout is in `src/email/layout.ts`, one builder per message in `src/email/messages.ts`, texts
under `email.*` in the server translations, sent in the reader's language. It is email safe on
purpose: tables and inline styles, 600 px at most, a dark version for Apple Mail and Outlook.com,
a preheader, no scripts and no tracking pixels. The Custock mark and the Commissioner font are
served by the api at `/email/mark.png` and `/email/commissioner-*.woff2` under `CUSTOCK_API_URL`,
so that address must be public. Posts carry `List-Unsubscribe` and `List-Unsubscribe-Post`
(RFC 8058) and the unsubscribe link in the footer.

In dev, `GET /v1/dev/emails` lists every template, and `/v1/dev/emails/<kind>?locale=el&scheme=dark`
shows one (`format=text` for the text part), with made up content. `pnpm --filter @custock/api
email-shots` saves phone width screenshots of all of them to `screenshots/email/`.

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
jpeg, png or webp, up to 5 MB, valid 10 minutes, needs the permission of the thing it is for. The
browser PUTs the file to `uploadUrl` with exactly the `headers` it got, then uses `publicUrl` in
`imageUrls` or `coverUrl`. Where the file goes depends on `CUSTOCK_STORAGE`, one line at startup says
which:

- `s3`: an S3 compatible bucket, Cloudflare R2 or AWS S3. `uploadUrl` is a SigV4 presigned PUT
  straight to the bucket (signed here with node crypto, no sdk), with the content type, the exact
  length and a long cache header signed in, so the bucket refuses anything else. Keys look like
  `orgs/<org>/products/<uuid>.webp`, `publicUrl` is `CUSTOCK_S3_PUBLIC_URL` plus the key. A photo
  taken off a product that nothing else uses is deleted from the bucket, best effort.
- `local`: the api checks the size, the type and the first bytes, keeps the file under
  `CUSTOCK_UPLOAD_DIR` and serves it at `/files/uploads/<org>/<file>` with a one year cache. The
  default in dev and tests. A server only uses it with `CUSTOCK_STORAGE=local` set on purpose.
- off: a server with no bucket settings and no `CUSTOCK_STORAGE` answers 501 to presign, so photos
  never end up on its disk by accident.

A bucket setting with some values missing stops the server at startup.

Setting up the bucket:

| | Cloudflare R2 | AWS S3 |
|---|---|---|
| `CUSTOCK_S3_BUCKET` | the bucket name | the bucket name |
| `CUSTOCK_S3_REGION` | `auto` | the bucket region, for example `eu-central-1` |
| `CUSTOCK_S3_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` | empty |
| `CUSTOCK_S3_ACCESS_KEY_ID`, `CUSTOCK_S3_SECRET_ACCESS_KEY` | an R2 API token with Object Read and Write on this bucket | an IAM user allowed `s3:PutObject` and `s3:DeleteObject` on `arn:aws:s3:::<bucket>/orgs/*` |
| `CUSTOCK_S3_PUBLIC_URL` | the bucket's public address: the `https://pub-<id>.r2.dev` url, or better a custom domain like `https://img.example.com` | `https://<bucket>.s3.<region>.amazonaws.com`, or a CloudFront address |
| public reads | bucket settings, Public access: turn on the r2.dev subdomain or connect a custom domain | turn off "Block public access" for bucket policies, then a bucket policy allowing `s3:GetObject` to everyone on `arn:aws:s3:::<bucket>/orgs/*` |

The browser uploads straight to the bucket, so the bucket needs a CORS rule for the web's origin. The
same JSON works on R2 (bucket settings, CORS policy) and on AWS (Permissions, CORS):

```json
[
  {
    "AllowedOrigins": ["https://custock.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "cache-control"],
    "MaxAgeSeconds": 3600
  }
]
```

Reads need no CORS, they are plain image loads. Keep exports and anything private out of this
bucket, it is public by design.

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

## Limits and options (the policy engine)

Every limit and option lives in one registry, `packages/core/src/policies.ts`: its type, default,
hard bounds, the levels it can be set at and how a narrower level is held by a wider one. Values
are stored in `policy_values` (migration 0013), read through `src/lib/policy.ts` and changed through
`/v1/platform/policies` (super admin), `/v1/platform/businesses/:orgId/policies` (super admin:
ceiling and "owner can change" per business), `/v1/orgs/:org/policies` (business),
`.../shops/:shop/policies`, `.../roles/:role/policies`, `.../members/:m/policies` and
`.../me/policies` (a person's own alert choices).

The narrowest value set wins and always stays inside the levels above it. Only someone above a
role or a person changes it, never their own role or themselves (apart from personal preferences),
nobody hands out more than they have, and super admin values bind owners. Business values of the
older settings stay in their `organizations` columns and are written back inside the ceilings, so
code that reads a column follows at once. Defaults equal what the app did before the engine.
