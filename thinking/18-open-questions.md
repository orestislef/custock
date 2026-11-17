# 18. open questions

Things I still need to decide. Next to each, what we assume until I answer.

| # | question | assumed for now |
|---|----------|-----------------|
| 1 | what runs on my server today (language, framework), and how does the login service issue tokens? JWT with a public key we can verify, or something else? | it issues JWTs we can verify with a public key, the custock api runs next to it as its own service |
| 2 | does the login server already keep devices and FCM tokens, or does custock keep them? | custock keeps its own `devices` table and calls FCM itself |
| 3 | is custock a product many businesses sign up for (and pay), or something I set up for specific shops? | built multi tenant from day one, signup open later, no billing in v1 |
| 4 | TypeScript everywhere (Expo + Next.js) or Flutter? see [08](08-platform-choice.md) | TypeScript everywhere |
| 5 | do pilot shops have a POS? should custock record sales (quick sale) or sync from the POS later? | quick sale in v1, POS sync later |
| 6 | one app for staff and customers, or two apps in the stores? | one app |
| 7 | countries at the start: Greece only? Cyprus? | Greece first, Cyprus ready (VAT rates, +357, EUR) |
| 8 | can managers create and edit products by default, or only admins? | managers can create and edit, base price only admins |
| 9 | should managers see costs and money in reports by default? | no, one switch to turn on |
| 10 | do posts by managers need approval by default? | no, the business can turn it on |
| 11 | defaults for what customers see: catalog, prices, stock | catalog for subscribers, prices shown, stock off |
| 12 | SMS or Viber later? | not in v1 |
| 13 | the domain for links, emails and the customer pages | to pick. the code uses a config value |
| 14 | newsletters from my own mail server, or a relay (SES, Brevo)? | own server for transactional, relay when volume grows |
| 15 | who reviews the Greek and Russian texts? | I review Greek, a native Russian speaker reviews Russian before each release |
| 16 | weighing scale barcodes in pilot shops (deli, cheese)? | not in v1, internal code prefix stays configurable |
| 17 | do any pilot shops already have customer lists to import? | possible, import with the consent rules |
| 18 | branding of customer pages per business (logo, color)? | logo and one color per business |
| 19 | keep the github repo public after the demo, or move the thinking to a private repo and keep only the demo public? | public for now, as asked, so the team can see the demo |
| 20 | the app icon and the brand mark | the two overlapping shapes idea in [10](10-design.md#app-icon), to be drawn |
