# Custock

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Expo](https://img.shields.io/badge/Expo%20(React%20Native)-000020?logo=expo&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![Languages](https://img.shields.io/badge/i18n-EN%20%7C%20EL%20%7C%20RU-B0234F)
![Status](https://img.shields.io/badge/status-planning-orange)
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
receive, post an offer and watch the push land on a customer's phone. Works on a phone too.

## Status

Planning. No real code yet. The thinking behind the project lives in [thinking/](thinking/README.md),
start there.

## What it does

**IMS**: product catalog with variants, barcodes and photos. Stock per shop, kept as a ledger of
movements so nothing gets overwritten. Scan to look up, receive, sell, count or transfer.
Stock counts, transfers between shops, low stock alerts.

**CRM**: customers sign up from a QR code or link. Consent per channel, double opt in, one tap
unsubscribe. Posts and offers to a feed, push and email, linked to products. Notify me when
back in stock, tags, notes, interests. Each business decides if customers see the catalog,
prices and stock.

**Both together**: the most wanted out of stock products, which QR poster brings people in,
what sells after an offer goes out. Reports and dashboards per role.

## Planned stack

TypeScript everywhere: Expo (React Native) for the phone app, Next.js for the customer pages and
the admin dashboard, Node with Hono, Drizzle and SQLite on my own server, which already handles
logins, FCM and mail. Cloudflare R2 for images. One monorepo with shared permissions,
translations and design tokens. Why not Flutter is in [thinking/08](thinking/08-platform-choice.md).

No CI/CD. Builds and deploys are done by hand.

## License

MIT, see [LICENSE](LICENSE).
