# 17. roadmap

Phases. Each one ends with something a real shop can use. Nothing starts until the thinking is
reviewed and I say go.

## phase 0: thinking (now)

- [x] this folder
- [x] public demo on github pages, to show the team how it should behave
- [ ] review with the team, change what needs changing
- [ ] answers to [18-open-questions](18-open-questions.md)

## phase 1: foundation

The boring parts that everything sits on.

- monorepo with apps/web (also the phone app, installed to the home screen), apps/api and the shared packages
- database migrations from `thinking/db/schema.sql`
- auth against my login server, `/v1/me/context`
- orgs, shops, groups, members, invites, default roles, the permission engine with tests for the
  delegation rules and tenant isolation
- app shell: tabs per role, context bar, en/el/ru from the first screen, design tokens, light and
  dark, the tally number component
- audit log

**done when:** I can create a business, add shops, invite a manager and a staff member, and each
sees exactly what they should, in three languages.

## phase 2: stock (IMS core)

- catalog: products, variants, barcodes, photos to object storage
- scan: look up, receive, sell, with undo
- stock levels per shop, the ledger, history
- adjust with reasons, unknown codes list
- low stock alerts
- labels (pdf)

**done when:** a real shop puts its products in by scanning and keeps stock right for two weeks.

## phase 3: customers (CRM core)

- join links, the join web page, double opt in, consents
- customers list and detail, tags, notes
- customer side of the app: feed, shops, profile
- posts to feed and push, the audience breakdown, approval
- notify me and the back in stock push
- customer page settings: catalog, prices, stock visibility

**done when:** a shop's window QR brings in real followers and a post reaches them.

## phase 4: the rest of v1

- email newsletters with unsubscribe
- offers with offer prices and the was price
- catalog for customers, offers tab, favorites
- stock counts and transfers
- reports and dashboards, CSV and PDF exports
- custom roles editor
- import products and customers

**done when:** two or three pilot shops run on it daily.

## phase 5: after v1

- offline mode with the outbox
- web admin wide layouts for bulk work
- weekly summary emails
- ideas from [16](16-ideas.md) by what pilots ask for most: coupons, loyalty, suppliers

## definition of done for any feature

- works in English, Greek and Russian, checked by a native reader for el and ru
- permission checked on the server and gated in the app, with the "why not" text
- audit logged if it changes access, prices, stock policy or customer data
- light and dark, large text, reduce motion
- tested, including the edge cases in [15](15-edge-cases.md) that touch it
- no ci/cd: checks run with the local scripts before a release
