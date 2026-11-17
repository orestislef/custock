# 14. api sketch

The shape of the API, not the final contract. Enough to see that every screen in
[09](09-app-per-role.md) has something to call and every call has a permission behind it.

## conventions

**decided:**

| thing | how |
|-------|-----|
| style | REST, JSON, everything under `/v1` |
| tenancy | in the path: `/v1/orgs/{org}/...` and `/v1/orgs/{org}/shops/{shop}/...`. the server checks membership and permission for that org and shop on every request |
| auth | `Authorization: Bearer <access token>` from the auth server, see [07](07-auth.md) |
| ids | uuid v7 strings |
| times | epoch ms in json, the app formats them in the shop timezone |
| money | integer cents plus the org currency |
| language | `Accept-Language` for anything the server writes for people (emails, push). the API itself never returns sentences for the UI |

### errors

RFC 9457 problem+json, with a stable `code` the app translates. No server prose ever reaches the
screen, so all three languages stay in the app.

```json
{
  "type": "https://custock.app/errors/permission_denied",
  "status": 403,
  "code": "permission_denied",
  "detail": "stock.adjust at shop 0193...",
  "params": { "permission": "stock.adjust" }
}
```

`detail` is for logs and developers. The app shows the translation of `code`, filled with `params`.

Common codes: `permission_denied`, `not_found`, `validation_failed` (with a field list),
`conflict` (stale ETag), `perms_stale`, `rank_too_low`, `ceiling_exceeded`, `last_owner`,
`negative_stock_blocked`, `barcode_taken`, `invite_expired`, `rate_limited`.

### pagination

Cursor based: `?limit=50&cursor=<opaque>`. Response has `items` and `next_cursor` (null at the end).
No page numbers, they break when rows are added while you scroll.

### idempotency

- stock movements carry their own id, made on the device. sending the same movement twice does
  nothing the second time. this is what makes offline safe.
- other creates take an `Idempotency-Key` header. same key within 24 hours returns the first result.

### concurrency

Edits return an `ETag`. Updates send `If-Match`. If someone else changed it first, `412` with code
`conflict` and the current version, and the app shows what changed.

### permissions version

- `GET /v1/me/context` returns `perms_version` per org.
- the app sends `X-Perms-Version` on every request.
- if the server has a newer one, it still answers (or refuses if the permission is gone) and adds
  `X-Perms-Stale: 1`. the app refetches context in the background.

## endpoints

Permission column: what you need at the org or shop in the path. `public` means no login,
rate limited. `self` means the logged in user acting on their own data.

### me

| method | path | what | needs |
|--------|------|------|-------|
| GET | `/v1/me/context` | user, orgs, per org: org level perms, perms per shop, rank per shop, `perms_version`. customer records too | self |
| PATCH | `/v1/me` | name, language | self |
| POST | `/v1/me/devices` | register device and FCM token | self |
| DELETE | `/v1/me/devices/{id}` | remove device (logout) | self |
| GET | `/v1/me/export` | my data as a file (gdpr) | self |
| DELETE | `/v1/me` | delete my account, see [07](07-auth.md) | self |

### orgs, shops, groups

| method | path | what | needs |
|--------|------|------|-------|
| POST | `/v1/orgs` | create an org, you become owner | any user |
| GET, PATCH | `/v1/orgs/{org}` | read, edit settings and customer page settings | member, `org.settings.manage` to edit |
| DELETE | `/v1/orgs/{org}` | delete the org | owner only |
| GET, POST | `/v1/orgs/{org}/shops` | list, create | member, `shops.create` |
| GET, PATCH | `/v1/orgs/{org}/shops/{shop}` | read, edit | member, `shop.settings.manage` |
| POST | `/v1/orgs/{org}/shops/{shop}/archive` | close a shop | `shops.archive` |
| GET, POST, PATCH, DELETE | `/v1/orgs/{org}/groups[/{group}]` | groups and their shops | `groups.manage` |
| POST | `/v1/orgs/{org}/support-access` | let the platform admin in until a time | `org.support_access.manage` |
| GET | `/v1/orgs/{org}/audit` | audit log, filters | `org.audit.view` |

### team

| method | path | what | needs |
|--------|------|------|-------|
| GET | `/v1/orgs/{org}/members` | members you can see, with assignments | `members.view` |
| PATCH | `/v1/orgs/{org}/members/{member}` | suspend, reactivate, remove | `members.manage` + rank rule |
| POST, DELETE | `/v1/orgs/{org}/members/{member}/assignments[/{id}]` | give or take a role at a scope | `members.manage` + scope, ceiling, rank rules |
| GET, POST | `/v1/orgs/{org}/invites` | list, send | `members.invite` + delegation rules |
| POST | `/v1/orgs/{org}/invites/{id}/resend`, `/revoke` | | `members.invite` |
| POST | `/v1/invites/accept` | accept with the token from the email | the invited user |
| GET, POST, PATCH | `/v1/orgs/{org}/roles[/{role}]` | roles and their permissions | `roles.manage` + ceiling and rank rules |
| GET | `/v1/orgs/{org}/roles/{role}/impact` | "this changes access for 7 people" | `roles.manage` |
| POST | `/v1/orgs/{org}/ownership-transfer` | start, accept | owner, then the target |

### catalog

| method | path | what | needs |
|--------|------|------|-------|
| GET | `/v1/orgs/{org}/products` | list, search (`q` uses the normalised search key), filters | `products.view` |
| POST | `/v1/orgs/{org}/products` | create with variants and barcodes | `products.create` |
| GET, PATCH | `/v1/orgs/{org}/products/{product}` | read, edit | `products.view`, `products.edit` |
| POST | `/v1/orgs/{org}/products/{product}/archive` | | `products.archive` |
| PATCH | `/v1/orgs/{org}/variants/{variant}/price` | base price | `products.price.edit` |
| PUT | `/v1/orgs/{org}/shops/{shop}/variants/{variant}/settings` | shop price, hide, reorder point | `prices.shop.edit` or `stock.settings.manage` |
| GET | `/v1/orgs/{org}/barcodes/{code}` | look up a scanned code (normalised on the server too) | `products.view` |
| POST, DELETE | `/v1/orgs/{org}/variants/{variant}/barcodes[/{id}]` | attach, detach | `products.edit` |
| POST | `/v1/orgs/{org}/barcodes/internal` | next internal EAN-13 for a label | `products.edit` |
| GET, POST, PATCH | `/v1/orgs/{org}/categories[/{id}]` | | `products.view`, `categories.manage` |
| POST | `/v1/orgs/{org}/products/import` | csv import, returns a job id | `products.import` |
| GET | `/v1/orgs/{org}/shops/{shop}/unknown-scans` | codes that matched nothing | `products.create` or `stock.settings.manage` |
| POST | `/v1/orgs/{org}/shops/{shop}/unknown-scans/{id}/resolve` | link to a variant or dismiss | `products.edit` |

Cost fields are stripped from every response for members without `products.cost.view`. Not hidden
in the app, absent from the JSON.

### stock

| method | path | what | needs |
|--------|------|------|-------|
| GET | `/v1/orgs/{org}/shops/{shop}/stock` | levels, filters (low, out, negative) | `stock.view` |
| GET | `/v1/orgs/{org}/variants/{variant}/stock` | on hand in every shop you can see | `stock.view` per shop |
| POST | `/v1/orgs/{org}/shops/{shop}/movements` | **batch** of movements (receive, sale, return, adjust, damage, initial, reversal). each checked against its own permission. partial success allowed, per item result | per kind, see [05](05-inventory.md) |
| GET | `/v1/orgs/{org}/shops/{shop}/movements` | the ledger, filters by variant, kind, user, time | `stock.history.view` |
| POST, GET | `/v1/orgs/{org}/shops/{shop}/counts[/{count}]` | start, read | `stock.count` |
| PUT | `/v1/orgs/{org}/shops/{shop}/counts/{count}/lines/{variant}` | set counted qty (server stamps expected) | `stock.count` |
| POST | `.../counts/{count}/submit`, `/apply`, `/cancel` | apply asks for the uncounted policy | `stock.count`, `stock.count.approve` |
| POST, GET | `/v1/orgs/{org}/transfers[/{id}]` | draft, read | `stock.transfer.send` at the source |
| POST | `/v1/orgs/{org}/transfers/{id}/send` | | `stock.transfer.send` |
| POST | `/v1/orgs/{org}/transfers/{id}/receive` | received quantities per line | `stock.transfer.receive` at the destination |

### customers

| method | path | what | needs |
|--------|------|------|-------|
| GET | `/v1/orgs/{org}/customers` | customers you can see (scope rules in [02](02-tenancy-and-roles.md)), filters: shop, tag, interest, consent, language, joined | `customers.view` |
| GET | `/v1/orgs/{org}/customers/{id}` | detail. email and phone masked unless `customers.contact.view` | `customers.view` |
| POST | `/v1/orgs/{org}/customers` | add at the counter, consent recorded with source `staff` | `customers.add` |
| PATCH | `/v1/orgs/{org}/customers/{id}` | tags, notes, interests | `customers.edit` |
| GET | `/v1/orgs/{org}/customers/{id}/consents` | the consent ledger | `customers.view` |
| GET | `/v1/orgs/{org}/customers/{id}/deliveries` | what we sent them | `customers.view` |
| POST | `/v1/orgs/{org}/customers/import` | csv, imported contacts get a double opt in email | `customers.import` |
| POST | `/v1/orgs/{org}/customers/export` | returns a job, file via presigned GET, audit logged | `customers.export` |
| POST | `/v1/orgs/{org}/customers/{id}/erase` | gdpr erase | `customers.erase` |
| GET, POST, PATCH | `/v1/orgs/{org}/join-links[/{id}]` | QR codes and links, stats | `joinlinks.manage` |
| GET | `/v1/orgs/{org}/join-links/{id}/poster.pdf` | printable poster in a chosen language | `joinlinks.manage` |
| GET | `/v1/orgs/{org}/variants/{variant}/alerts` | who is waiting (count, list if allowed) | `customers.view` |

### posts

| method | path | what | needs |
|--------|------|------|-------|
| GET, POST | `/v1/orgs/{org}/posts` | list, create draft | `posts.view`, `posts.create` |
| GET, PATCH, DELETE | `/v1/orgs/{org}/posts/{post}` | read, edit draft, delete | `posts.view`, `posts.create` (own drafts), `posts.delete` |
| POST | `/v1/orgs/{org}/posts/audience-preview` | count and breakdown: per scope, per channel, who is skipped and why | `posts.create` |
| POST | `/v1/orgs/{org}/posts/{post}/submit` | send for approval | `posts.create` |
| POST | `/v1/orgs/{org}/posts/{post}/publish` | send now or schedule. channels checked against `posts.channel.*`, offer prices against `offers.price.set` | `posts.publish` |
| POST | `/v1/orgs/{org}/posts/{post}/cancel` | stop a scheduled or sending post | `posts.publish` |
| GET | `/v1/orgs/{org}/posts/{post}/stats` | delivered, failed, opened, clicked, per channel | `posts.view` |

### reports

| method | path | what | needs |
|--------|------|------|-------|
| GET | `/v1/orgs/{org}/reports/{report}?shop=&from=&to=` | stock value, low, dead stock, sell through, shrinkage, customers growth, join links, posts, most wanted | `reports.view`, money fields need `reports.financial.view` |
| GET | `/v1/orgs/{org}/reports/staff` | activity per member | `reports.staff.view` |
| POST | `/v1/orgs/{org}/reports/{report}/export` | csv or pdf in the user's language | `reports.view` |

The list of reports and what they answer is in [12](12-reports-and-analytics.md).

### files

| method | path | what | needs |
|--------|------|------|-------|
| POST | `/v1/orgs/{org}/files/presign` | purpose, mime, size. returns upload URL and file id | the permission of the thing it is for (`products.edit`, `posts.create`, `org.settings.manage`) |
| POST | `/v1/orgs/{org}/files/{id}/complete` | confirm upload, server checks size and type | same |

### sync (offline)

| method | path | what | needs |
|--------|------|------|-------|
| GET | `/v1/orgs/{org}/shops/{shop}/sync?since=<cursor>` | changed products, variants, barcodes, categories, stock levels and settings since the cursor, plus **tombstones** for archived or removed rows. returns a new cursor | `products.view` + `stock.view` |

The outbox goes back through the normal movements batch endpoint.

### public (no login)

All rate limited per IP and per code, Turnstile on writes.

| method | path | what |
|--------|------|------|
| GET | `/v1/public/join/{code}` | branding, scope name, what you get, consent texts in the asked language |
| POST | `/v1/public/join/{code}` | name, email or phone, interests, channel choices. creates pending subscription and sends double opt in |
| POST | `/v1/public/confirm` | the double opt in token |
| GET | `/v1/public/p/{code}` | shelf product page: product, price and stock as the merchant allows |
| POST | `/v1/public/p/{code}/notify` | notify me, needs an email if not logged in |
| GET | `/v1/public/orgs/{slug}/catalog` | public catalog, only when the merchant set it to `public` |
| GET | `/v1/public/orgs/{slug}/offers` | running offers, same rule |
| GET, POST | `/v1/public/subscription/{token}` | manage or unsubscribe from the email link, one click |

### customer app (logged in customer)

| method | path | what |
|--------|------|------|
| GET | `/v1/c/feed` | posts from every shop I follow, across orgs, newest first |
| GET | `/v1/c/offers` | running offers only, ending soon first |
| GET | `/v1/c/orgs/{org}/catalog` | catalog, if the merchant allows it for subscribers |
| GET | `/v1/c/orgs/{org}/products/{product}` | product, availability per shop as the merchant allows |
| GET, POST, DELETE | `/v1/c/favorites[/{product}]` | hearts |
| GET, POST, DELETE | `/v1/c/alerts[/{id}]` | notify me list |
| GET, PATCH | `/v1/c/subscriptions` | follow, unfollow, channels per org |
| POST | `/v1/c/join/{code}` | join from a QR while logged in, skips the email step if my email is verified |

## realtime

**decided:** no websockets in v1. FCM data messages tell the app what to refetch.

| message | sent to | app does |
|---------|---------|----------|
| `stock_changed` | members with `stock.view` at that shop, throttled | refetch levels for that shop |
| `perms_changed` | the member whose access changed | refetch `/me/context`, rebuild tabs and gates |
| `post_published` | customers in the audience (with the notification) and members with `posts.view` | refresh feed or posts list |
| `transfer_sent` | members with `stock.transfer.receive` at the destination | show "on the way" |

Pull to refresh and refetch on focus cover the rest. If live stock on screen ever matters (two
people counting side by side), server sent events on one endpoint is the next step.
