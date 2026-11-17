# 05. inventory (IMS)

Catalog, stock, scanning, counts, transfers, alerts.

## catalog

**decided:**

- one catalog per organization. product -> variants -> barcodes.
- stock is per **variant per shop**.
- per shop: price override, hide, reorder point.
- product fields: name, description, brand, category, unit (piece, kg, l, m), vat rate, photos,
  "track stock" switch (off for services or things nobody counts).
- vat rates for greece: 24, 13, 6. cyprus: 19, 9, 5. the org country gives the list, prices are
  entered **with vat**, because that is what is on the shelf.
- variants: options as free pairs (size, color, flavour). the editor makes the grid
  ("S, M, L" x "black, white" = 6 variants) and lets you delete the ones you do not sell.
- each variant: sku (optional), price, cost (hidden without permission), barcodes, photos.

## the ledger

Stock is never "set". Every change is a **movement** with a sign, a kind, who, when, where, why.
On hand is the sum of movements. The cached number in `stock_levels` is updated in the same
transaction, and can be rebuilt from the ledger any time.

Why this matters:

- two people scanning the same product at the same time both count, nothing is lost.
- offline phones can sync later without conflicts, because adding deltas does not care about order.
- every "where did 3 pieces go" has an answer.

| kind | sign | from | needs |
|------|------|------|-------|
| `initial` | + | first stock when a shop starts using custock | `stock.adjust` |
| `receive` | + | goods arrived | `stock.receive` |
| `sale` | - | quick sale | `stock.sell` |
| `return` | + | customer brought it back | `stock.return` |
| `adjust` | +/- | found, lost, own use, correction. reason required | `stock.adjust` |
| `damage` | - | broken, expired, stolen. reason required | `stock.adjust` |
| `count` | +/- | difference applied from a stock count | `stock.count.approve` |
| `transfer_out` | - | sent to another shop | `stock.transfer.send` |
| `transfer_in` | + | arrived from another shop | `stock.transfer.receive` |
| `reversal` | opposite | undo of a movement, points to it | same permission as the original |

**undo:** after any scan action a snackbar shows "sold 1 x Freddo Espresso. undo" for 10 seconds.
undo makes a `reversal` movement. nothing is ever deleted. after 10 seconds, a manager can still
reverse from the history screen.

**big moves need a confirm:** more than 50 units in one go, or anything that makes stock negative.

## scanning

Package: `mobile_scanner` (ml kit on android, apple vision on ios). Works with EAN-13, EAN-8,
UPC-A, UPC-E, ITF-14, Code 128, Code 39, QR, DataMatrix.

### scan modes

The scan screen has a mode switch at the bottom. The mode decides what a scan does.

| mode | one scan does | who sees it |
|------|---------------|-------------|
| **look up** | opens the product: stock here and in other shops, price, quick actions | `products.view` |
| **receive** | +1 (or +pack qty) into a running list. confirm at the end | `stock.receive` |
| **sell** | -1 right away, with undo | `stock.sell` |
| **count** | +1 on the count line of the open count | `stock.count` |
| **transfer** | +1 on the transfer list | `stock.transfer.send` |
| **attach** | links the scanned code to the product you are editing | `products.edit` |

Modes you do not have are not in the switch. Staff with only `stock.sell` and `stock.receive`
see two modes and that is it.

### one scan vs continuous

- **single:** scan, sheet opens, camera pauses.
- **continuous:** camera stays on, each scan beeps, vibrates and adds to the list on the bottom
  half of the screen. the same code within 1.5 seconds is ignored, so holding the phone still does
  not count the same box 20 times. a "+" and "-" on each line fixes mistakes. typing a number
  sets the quantity ("24" for a box you did not want to scan 24 times).
- torch button. manual entry button for codes the camera will not read. search button for things
  without a barcode.

### what happens after a scan

```
code read
  -> normalise (below)
  -> look up barcode in this org
       found           -> variant, quantity = 1 x pack_qty
       found, archived -> show it, ask before acting
       not found       ->
           can create products -> "new product with this code" or "add this code to a product"
                                  (prefill from a public product database if we have one, see 14-ideas)
           cannot              -> "unknown code, saved for your manager", goes to unknown_scans
```

### normalising codes

So that the same product scanned as UPC by one phone and EAN by another is still one product.

1. trim spaces. keep the raw code too.
2. if the scanner says UPC-E, expand to UPC-A first.
3. if it is 8, 12, 13 or 14 digits and the check digit is right: it is a GTIN. left pad with zeros
   to 14 digits. `5201234567890` and `05201234567890` become the same thing. a 12 digit UPC-A
   and the 13 digit EAN with a leading zero become the same thing.
4. digits with a wrong check digit: keep as is, warn "this code looks damaged".
5. GS1 DataMatrix or GS1-128 with application identifiers: take the GTIN from `(01)`. expiry
   `(17)` and batch `(10)` get ignored for now, kept in mind for later.
6. GS1 Digital Link QR (`https://id.gs1.org/01/<gtin>` or a brand domain with `/01/<gtin>`): take the GTIN.
7. our own QR (`https://<our domain>/p/<code>`): our internal code.
8. anything else (Code 128, Code 39, random QR): exact text, case kept.

### our own labels

For products with no barcode (handmade, bulk, things repacked in the shop):

- we generate an **internal EAN-13** with a prefix in the GS1 "in store" range (default `20`,
  configurable per org), a running number, and the check digit. it prints on any label printer and
  scans on any scanner, including a POS if the shop gets one later.
- the prefix is configurable because some shops already use `2x` codes from their weighing
  scales (price or weight inside the barcode). we must not clash with those.
- labels print as a pdf: a4 sheet of labels, or one label per page for small label printers.
  bluetooth label printers later.

### shelf QR for customers

A QR on the shelf with `https://<our domain>/p/<code>`:

- scanned by the **staff app**: opens the product in look up mode.
- scanned by a **customer's phone camera**: opens a small web page with the product, whether it is
  in stock in this shop, a "notify me when back" button, and "join this shop for news".

One code, two uses. Ties the IMS to the CRM right at the shelf.

## receiving

1. tap receive (or switch mode on the scan screen). pick the shop if you work in more than one.
2. scan everything in continuous mode. adjust quantities on the list.
3. optional: unit cost per line (only with `products.cost.edit`), a note ("supplier X, invoice 123").
4. confirm. one `receive` movement per line, all with the same `batch_id`.
5. after commit: back in stock check and low stock reset for each line.

Unknown codes during receiving: if you can create products, a quick form opens on top of the
camera (name, price, category, photo), then back to scanning. If not, the line stays as
"unknown" and the manager gets it in the unknown codes list.

## quick sale

Not a POS. It is "this left the shop".

- sell mode: each scan is -1 with undo.
- price is taken from the shop price at that moment and saved on the movement, for reports.
- optional: "sale to a customer" picks a customer, for later loyalty and attribution ideas.
- no receipts, no payments.

## adjust and damage

- plus or minus, quantity, **reason required** from a list (found, lost, damaged, expired,
  theft, own use, correction) plus an optional note and photo.
- shown in reports as shrinkage. adjustments per staff member are visible to managers with
  `reports.staff.view`, because this is where stock goes missing.

## stock counts

The yearly or monthly "count everything".

1. **start** a count: full shop or partial (one category, one shelf, a list). status `open`.
   several people can count the same count at the same time from their phones.
2. **count**: scan in count mode, each scan +1 on that line, or type a number. a line remembers
   who counted it and when.
3. when a line is counted, the server stores the **expected** quantity at that moment. so if
   something is sold while the count is running, the math still works: the difference is
   `counted - expected at the time of counting`, and sales after that are already in the ledger.
4. **submit** for review. status `review`. the reviewer sees each line: expected, counted,
   difference, value of the difference (if they can see cost).
5. **apply** (`stock.count.approve`): one `count` movement per line with a difference.
   for full counts, the question "what about products we did not count?" is asked: leave them, or
   set them to zero. never done silently.
6. recount a line before applying if a difference looks wrong.

## transfers between shops

1. **draft** at shop A: scan items, quantities.
2. **send**: `transfer_out` movements at A. the items now show as "on the way" at B
   (`in_transit_in`). B gets a push: "12 items on the way from A".
3. **receive** at B: scan or tick lines, enter what really arrived.
   `transfer_in` movements at B with the received quantities.
4. if fewer arrived than were sent, the transfer shows the difference as "lost in transit". no
   phantom stock anywhere: A sent 10, B got 9, one is gone and it shows in shrinkage.
5. cancel is only possible before send.

## low stock alerts

- reorder point per variant per shop (optional).
- when a movement takes on hand from above the reorder point to at or below it, the managers of
  that shop (with `stock.settings.manage` or `stock.view` plus the notification turned on) get
  one push. `low_alert_sent_at` stops repeats until stock goes back above the point.
- a daily digest option instead of instant pushes, for busy shops.

## back in stock

Ties stock to customers.

- a customer taps "notify me" on an out of stock product (app or web page). a `stock_alert` row,
  for one shop or any shop.
- **trigger:** when a `receive`, `transfer_in` or `return` takes on hand from 0 or less to more
  than 0. not on `adjust` or `count`, so a counting mistake does not send false alarms.
- all waiting alerts for that variant (for that shop or any shop) get a delivery queued, by push
  if they have the app, email otherwise, in the customer's language.
- each alert fires **once**, then it is `notified`. if stock flaps 0, 1, 0, 1 nobody gets spammed.
- the managers see "14 people are waiting for this" on the product, which is a great reason to
  order more. see [10](10-reports-and-analytics.md).

## negative stock

**decided:** allowed by default, shown in red, listed in a "negative stock" report to fix.
Reason: a sale scanned before the goods were received, or two offline phones. Blocking it would
stop a real sale. Orgs that want strict mode can turn it off, then the server refuses movements
that go below zero (only when online, offline ones are accepted and flagged).

## offline

Stock rooms and basements often have no signal. Phase 2, but the data model is ready from day one.

- the app keeps a local copy (drift, sqlite on the phone) of the catalog and barcodes for the
  shops you work in, plus stock levels.
- movements made offline go into a local **outbox** with their uuid v7 id already set.
- on reconnect the outbox is sent in order. the server treats the movement id as an idempotency
  key, so sending twice does nothing the second time.
- server time (`recorded_at`) is the order of truth. phone time (`occurred_at`) is kept for
  display, because phone clocks lie.
- if permissions changed while offline and the server refuses some movements, the app shows them
  in a "not synced" list with the reason, and the user can hand them to a manager.
- sync pulls changes since a cursor: products, variants, barcodes, stock levels, archived items.
- on logout or when access to an org is removed, the local copy for that org is wiped.

## prices and costs

- price is with vat, per variant, optional override per shop.
- price changes go to the audit log, so there is a price history.
- cost: the last cost entered on receive. stock value at cost uses that. no FIFO or weighted
  average in v1. good enough for small shops, and simple to explain.

## later

Suppliers and purchase orders, batches and expiry dates (food, cosmetics, pharmacy), serial
numbers (electronics), bundles and kits, weighing scale barcodes, reserved stock for click and
reserve. The model leaves room: movements have `ref_type`/`ref_id`, barcodes keep the raw code.
