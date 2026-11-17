# @custock/api

The Custock API. Hono on Node, SQLite through better-sqlite3, the shared contract from
`@custock/core`.

## run

```
pnpm db:reset          # from the repo root, builds apps/api/data/custock.db with the Lemoni data
pnpm dev:api           # http://localhost:8787, reloads on change
```

If the database file does not exist, `pnpm dev:api` creates and seeds it.

Environment, all optional in dev:

| var | default | what |
|-----|---------|------|
| `PORT` | 8787 | |
| `CUSTOCK_DB` | `apps/api/data/custock.db` | sqlite file |
| `CUSTOCK_JWT_SECRET` | a dev value | required when `NODE_ENV=production` |
| `CUSTOCK_PUBLIC_WEB_URL` | `http://localhost:3000` | base for join links, confirm, invite and unsubscribe links |
| `CUSTOCK_CORS` | localhost 3000, 8081, 19006 | allowed origins |
| `CUSTOCK_WORKER` | on | `0` turns the job loop off |

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
dev. Nothing is ever sent. Every email, push and sms lands in the `dev_outbox` table instead, and
owners and admins can read it at `GET /v1/dev/outbox`.

## test

```
pnpm --filter @custock/api test
```

Four suites on a fresh in-memory database: the read side (with a second business to prove nothing
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
- team: `POST /invites`, `POST /invites/{id}/revoke`, `POST /v1/invites/accept`, `POST /members/{m}/assignments`, `DELETE /members/{m}/assignments/{a}`, `PATCH /members/{m}`, `POST /roles`
- customer app: `POST /c/join/{code}`, `POST /c/follow`, `POST /c/unfollow`, `PUT /c/channels`, `POST /c/alerts`, `DELETE /c/alerts/{id}`, `PUT /c/favorites/{product}`
- public: `POST /public/join/{code}`, `POST /public/confirm`, `POST /public/subscription/{token}`
- dev only: `GET /v1/dev/outbox`, `POST /v1/dev/run-jobs`

Creates take an `Idempotency-Key` header: the same key from the same user within 24 hours returns
the first answer. Product and post reads return an `ETag`. An edit with a stale `If-Match` gets
412 `conflict`.

The join page uses a stand in for the bot check: in dev it accepts no token or `dev-turnstile-ok`.

`/reports/sales` returns money per day when the caller may see money, otherwise pieces sold. The
`X-Series-Unit` header says which.

## the worker

The server runs a job loop every 5 seconds. Jobs live in the `jobs` table:

- `send_post`: snapshots the audience into `deliveries`, one row per customer per channel, with a
  reason when skipped (no consent, no device, cap reached, suppressed). Pushes in quiet hours are
  held until they end. Scheduled posts run at their time.
- `send_deliveries`: sends through the dev transport in each recipient's language, with an
  unsubscribe link and one click headers on emails. Back in stock alerts go out the same way.
- `rollup_day`: rebuilds `daily_shop_stats` for the last three days, once a day.

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
  invite, assignment, member change and role edit.
