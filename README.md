# Custock

![Flutter](https://img.shields.io/badge/Flutter-02569B?logo=flutter&logoColor=white)
![Dart](https://img.shields.io/badge/Dart-0175C2?logo=dart&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![Languages](https://img.shields.io/badge/i18n-EN%20%7C%20EL%20%7C%20RU-6A5ACD)
![Status](https://img.shields.io/badge/status-planning-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)

A clean blend of Customer and Stock.

Custock is a CRM and an inventory management system (IMS) in one Flutter app, made for shops.
Owners and managers run one shop or many, keep stock right by scanning barcodes and QR codes,
and stay in touch with the people who buy from them. Customers join a shop, a group of shops
or a whole business from a QR code or a link, and get news, offers and back in stock alerts
by push and email.

Everything sits behind roles and permissions. The owner decides what admins can do, admins
decide for managers, managers for staff, and nobody can hand out more than they have.

English, Greek and Russian from the first screen.

## Status

Planning. No code yet. The thinking behind the project lives in [thinking/](thinking/README.md), start there.

## What it does

**IMS**: product catalog with variants, barcodes and photos. Stock per shop, kept as a ledger of
movements so nothing gets overwritten. Scan to look up, receive, sell, count or transfer.
Stock counts, transfers between shops, low stock alerts.

**CRM**: customers sign up from a QR code or link. Consent per channel, double opt in, one tap
unsubscribe. Posts and offers to a feed, push and email, linked to products. Notify me when
back in stock, tags, notes, interests.

**Both together**: the most wanted out of stock products, which QR poster brings people in,
what sells after an offer goes out. Reports and dashboards per role.

## Planned stack

Flutter for Android, iOS and web (admin). A self-hosted API on my own server, which already
handles logins, FCM and mail. SQLite to start, with a schema that moves to PostgreSQL when it
has to. S3 compatible storage (Cloudflare R2) for images.

## License

MIT, see [LICENSE](LICENSE).
