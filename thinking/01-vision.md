# 01. vision

## the name

Custock. A clean blend of Customer and Stock. Short, easy to remember, says what it does.

## what it is

A CRM and an IMS in one app, for shops.

- **IMS** (inventory management): what products we have, how many, in which shop, and every
  change to that number with who did it and why.
- **CRM** (customer relationship management): who our customers are, which shops they follow,
  how we can reach them, and what we send them.

Most small shops keep stock in a notebook or an excel file, and talk to customers through an
instagram page or a viber group. Two separate worlds. The point of Custock is that they are the
same world: new stock arrives, it gets scanned in, and the customers who asked for it or care
about that category hear about it right away. Then they come in and buy, and that sale is
scanned out.

```
  stock arrives -> scan in -> customers who wanted it get told -> they come in -> sale scanned out
        ^                                                                              |
        +------------------------- reports show what to order next --------------------+
```

That loop is the product. Everything else supports it.

## who uses it

| who | what they are | what they want |
|-----|---------------|----------------|
| platform admin | me, running custock | support, keep it healthy, see usage, never see shop data unless invited |
| owner | owns a business (organization) | everything about their business, all shops, all people |
| admin | right hand of the owner | run the business day to day, almost everything except billing and deleting it |
| manager | runs one shop or a group of shops | stock, team and customers of their shops |
| staff | works in a shop | scan, receive, sell, count. fast, no clutter |
| viewer | accountant, partner | look at stock and reports, change nothing |
| customer | buys from the shop | hear about new stuff and offers, only what they asked for, unsubscribe easily |

Roles above are the defaults. Owners and admins can make their own roles, see
[02](02-tenancy-and-roles.md) and [03](03-permissions.md).

## goals for the first real version

1. A shop can put its products in fast, mostly by scanning barcodes.
2. Stock per shop is always right and every change is traceable.
3. Staff only see and do what their role allows, on the phone, in one hand.
4. A customer can join a shop from a QR code in under 30 seconds, without installing anything.
5. A manager can post news or an offer and reach the customers of their shop by feed, push and email.
6. Customers can ask to be told when something is back in stock, and they are.
7. Works in English, Greek and Russian.
8. Owners get reports that help them decide what to order and what to promote.

## not doing (for now)

- **not a POS.** no cash register, no fiscal receipts, no myDATA/AADE. A quick sale (scan, minus one)
  is there to keep stock right, not to replace the register. POS integration maybe later.
- **not accounting.** no invoices, no VAT returns. we keep prices and costs for reports only.
- **not an e-shop.** no checkout, no payments. maybe a public catalog page later (see [14](14-ideas.md)).
- **no suppliers and purchase orders** in v1. later.
- **no batches, expiry dates or serial numbers** in v1. the model leaves room for them.
- **no ci/cd.** builds and deploys by hand.

## principles

- **phone first, scan first.** the camera is the main input for stock work.
- **the server decides permissions.** the app hides what you cannot do, but the server is the one that says no.
- **never overwrite stock.** stock is a ledger of movements. the number on screen is the sum.
- **privacy by default.** customers opt in per channel, can see and delete their data, and one
  business never sees another business's customers. GDPR applies, we are in the EU.
- **three languages from day one.** no hardcoded strings, ever.
- **light infra.** one server, sqlite, cheap object storage. grow when real usage asks for it, not before.
