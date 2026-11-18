# Custock

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![Languages](https://img.shields.io/badge/i18n-EN%20%7C%20EL%20%7C%20RU-B0234F)
![Status](https://img.shields.io/badge/status-building-B0234F)
![License](https://img.shields.io/badge/License-MIT-yellow)

A clean blend of Customer and Stock.

Custock is a CRM and an inventory management system (IMS) in one app, made for shops.
Owners and managers run one shop or many, keep stock right by scanning barcodes and QR codes,
and stay in touch with the people who buy from them. Customers join a shop, a group of shops
or a whole business from a QR code or a link, and get news, offers and back in stock alerts
by push and email.

Everything sits behind roles and permissions. The owner decides what admins can do, admins
decide for managers, managers for staff, and nobody can hand out more than they have.

English, Greek and Russian from the first screen.

## Demo

**[orestislef.github.io/custock/demo](https://orestislef.github.io/custock/demo/)**

A clickable demo of how the finished app should behave, with made up data. Switch roles to see what
each person can and cannot do, switch language, change what customers are allowed to see, scan,
receive, post an offer and watch the push land on a customer's phone. Works on a phone too, and
can be added to the home screen.

## Status

**[orestislef.github.io/custock/status](https://orestislef.github.io/custock/status/)** shows how far
each part is.

The thinking behind the project lives in [thinking/](thinking/README.md), start there. The code is
a pnpm monorepo:

```
apps/api        hono api on sqlite, dev logins, tests
apps/web        next.js: the app for staff and customers, installs to the home screen
packages/core   api contract, permissions and delegation rules, search, barcodes, money
packages/db     migrations, seed data, database helpers
packages/i18n   english, greek and russian for every app and the server
packages/tokens colors, type, spacing and motion for web and phone
```

Run it locally (Node 22+, pnpm 10):

```
pnpm install
pnpm db:reset
pnpm dev:api      # http://localhost:8787
pnpm dev:web      # http://localhost:3000
pnpm check        # typecheck, tests and missing translations
```

`pnpm dev:api` runs in dev mode: demo data, logins like `maria@example.com` with password
`custock`, codes shown on screen instead of emailed, and a dev outbox at `/admin/dev-outbox` that
shows every email and push that would have gone out. Nothing is ever sent from a dev setup. The API
describes itself at `http://localhost:8787/v1/openapi.json`.

Putting it on a server is in [deploy/](deploy/README.md): one Docker image with the api and the web,
built by hand with `deploy/ship.sh`, behind the reverse proxy the server already has, best on its own
subdomain. Sending (email, web push, FCM) and photo storage (any S3 compatible bucket) switch on per
channel from the server's settings, see [apps/api](apps/api/README.md).

## What it does

**IMS**: product catalog with variants, categories, barcodes and photos. Stock per shop, kept as a
ledger of movements so nothing gets overwritten. Scan with the phone camera to look up, receive,
sell, count or transfer: factory barcodes (EAN, UPC, Code 128) and QR codes, or a usb scanner on a
desk. Works without signal and syncs later. Stock counts, transfers between shops with shortages,
low stock alerts, printable shelf labels with barcode, price and a QR for customers.

**CRM**: customers join from a QR code or link. Consent per channel, double opt in, one tap
unsubscribe. Posts and offers to a feed, by push (with the shop's logo and the product photo) and
email in the shop's own look, linked to products, with the lowest price of the last 30 days on
offers. Notify me when back in stock, favourites, tags, notes. Each business decides if customers
see the catalog, prices and stock. Every business gets its own home screen app with its own icon.

**Both together**: the most wanted out of stock products, which QR poster brings people in,
what sells after an offer goes out. Reports and dashboards per role.

**Roles and settings**: owner, admin, manager, staff and viewer, per business, shop group or shop,
each handing out only what they have themselves. People only see what they can use. Every limit and
option (push limits and quiet hours, approvals, stock rules, catalog visibility, alerts, sessions)
is set from the level above: platform, business, shop, role, person.

**Super admin**: every business in one place, new businesses with their owner invited by email,
feature switches and limits per business, pausing a business, emergency switches for email, push,
signups and invites, a meter for the free storage tier, an error log, the API docs and server
health.

English, Greek and Russian everywhere: screens, emails, push texts, dates and numbers.

## Stack

TypeScript everywhere. The website is also the phone app: staff and customers add it to the home
screen, with camera scanning, offline stock work and web push. Next.js for the app, Node with Hono
and SQLite for the api, Cloudflare R2 for photos. One monorepo with shared permissions,
translations and design tokens. Why a web app and not a native one is in
[thinking/08](thinking/08-platform-choice.md). An earlier Expo version lives on the `expo-app`
branch.

No CI/CD. Builds and deploys are done by hand.

## License

MIT, see [LICENSE](LICENSE).
