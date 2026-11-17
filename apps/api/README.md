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
| `CUSTOCK_PUBLIC_WEB_URL` | `http://localhost:3000` | base for join links and shelf pages |
| `CUSTOCK_CORS` | localhost 3000, 8081, 19006 | allowed origins |

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
dev. Nothing is ever sent. Every email, push and sms lands in the `dev_outbox` table instead.

## test

```
pnpm --filter @custock/api test
```

The tests build a fresh in-memory database, seed it, add a second small business, and check
permissions, masking, delegation, the customer side, public pages and that nothing leaks between
the two businesses.

## endpoints (stage 1, read side)

All under `/v1`. Errors are `application/problem+json` with a stable `code`.

- auth: `POST /auth/login`, `/auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `/auth/logout`
- me: `GET /me/context`
- org: `GET /orgs/{org}`, `/orgs/{org}/shops`, `/groups`, `/categories`
- catalog: `GET /orgs/{org}/products` (`q`, `shopId`, `filter=low|out|negative|waiting`, `categoryId`, `cursor`, `limit`), `/products/{id}`, `POST /scan`, `GET /unknown-scans`, `/movements`
- customers: `GET /orgs/{org}/customers`, `/customers/{id}`, `/join-links`
- posts: `GET /orgs/{org}/posts`, `/posts/{id}`
- team: `GET /orgs/{org}/members`, `/roles`, `/roles/grantable?scopeType=&scopeId=`
- reports: `GET /orgs/{org}/reports/dashboard`, `/sales`, `/top-sellers`, `/most-wanted`, `/join-links`, `/shrinkage`
- customer app: `GET /c/feed`, `/c/offers`, `/c/shops`, `/c/orgs/{slug}/catalog`, `/c/orgs/{slug}/products/{id}`
- public: `GET /public/join/{code}`, `/public/p/{code}`, `/public/orgs/{slug}/catalog`

`/reports/sales` returns money per day when the caller may see money, otherwise pieces sold. The
`X-Series-Unit` header says which.

## how access works here

- `/v1/orgs/{org}/*` loads the member's role assignments and builds their access with
  `@custock/core`. Not a member looks the same as not existing (404).
- "posts need approval" removes `posts.publish` from every role ranked below admin.
- every business query goes through `Tenant`, which refuses sql without `@org`.
