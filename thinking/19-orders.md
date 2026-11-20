# 19. orders and price requests

Customers order from the shop's app: "10 packs of pelmeni for Saturday". Many shops agree a price
per order (a big order, made to order, prices not shown), so an order can also be a request for a
price: the shop answers with the price, the customer says yes or no. Everything by push and email,
with a history of who did what.

No online payment and no delivery in this version: the customer pays and picks up at the shop. A
note on the order covers the rest ("deliver to...", "cut in slices").

## settings

Set from above, like everything else ([03](03-permissions.md)):

| level | setting | values |
|---|---|---|
| super admin | feature switch `orders` per business | on (default) / off |
| business | orders from customers | **off** (default) / **ask for a price** / **order at shown prices** |
| shop | orders here | business setting / off |
| policies | `orders.maxLines` (30), `orders.maxQty` per line (999 pieces or 999 kg), `orders.openPerCustomer` (5), `orders.quoteDays` how long a price holds (3), `orders.takeStock` when picked up (on) | platform > business |

- **ask for a price**: every order is a request. The customer sees no total, only what they ask for.
- **order at shown prices**: when the business shows prices and every line has one, the order goes
  in with those prices and the shop only confirms it. A line without a price, or prices hidden,
  makes it a request for a price again. When the shop changes a price or a quantity, the customer
  has to say yes to the new total.

## the life of an order

```
                 customer sends
                       |
                  [requested] ---- shop declines ----> [declined]
                   |       \
     shop sends a price     shop confirms (priced, nothing changed)
                   |         \
               [quoted] ----- customer says no ----> [rejected]
                   |     \--- price runs out -----> [expired]
       customer says yes
                   |
              [confirmed] <-----------------------------/
                   |
           shop: ready to pick up
                   |
                [ready]
                   |
           shop: picked up  ------> stock goes down (sale, ref order)
                   |
              [completed]

the customer can cancel while requested or quoted. the shop can cancel from requested up to ready,
always with a reason. cancelled, declined, rejected, expired and completed are final.
```

- One number per business for people: **#1001, #1002**, so "order 1042" means something on the
  phone. The id stays a uuid.
- Every step is a row in `order_events` (who, when, what, the old and new total). Both sides see
  the history; the customer sees it in plain words without staff names.
- Every step is one conditional update (`WHERE status = @expected`), so two people tapping at once
  never both win. A second tap on the same thing answers with the order as it is now.

## prices

- Lines keep the quantity in base units (pieces, grams, ml) like the ledger, and a unit price with
  VAT in cents per piece or per kg/l. Line total = unit price times quantity, rounded once per line.
- The shop can change a unit price, a quantity (only 8 left) or add a note per line. Lines can not
  be added by the shop in this version (the customer orders again or writes a note).
- The price the customer saw when sending is checked again on the server. When it changed in the
  meantime the order is refused with `prices_changed` and the fresh prices, so nobody is surprised.
- A quote holds for `orders.quoteDays` (the shop can pick another date). After that it expires and
  the customer is told.

## who does what

| permission | level | who by default |
|---|---|---|
| `orders.view` | shop | owner, admin, manager, staff, viewer |
| `orders.quote` (send a price, confirm, decline, cancel) | shop | owner, admin, manager |
| `orders.fulfil` (ready, picked up) | shop | owner, admin, manager, staff |

Hidden when not allowed ([hide, don't explain](09-app-per-role.md)): no Orders in the menu
without `orders.view`, no buttons without the right permission.

## customers

- **Add to order** on a product (quantity stepper, a pack or kg where the product is sold by
  weight). The order lives on the phone until it is sent, one per business.
- **Your order**: lines, the shop to pick up from (only shops that take orders), a note, a day it is
  needed (optional), then **Send order** (prices known) or **Ask for a price**.
- Sending needs the customer signed in and following the business (the join flow when not).
- **You > Orders**: every order with its state; an order shows its lines, the total when known, the
  history, and **Accept** / **No thanks** on a price, **Cancel** while it is still open.
- Order messages are about something the customer asked for, so like notify me they go out without
  a marketing yes: by push when the app is on a device, by email when the address is confirmed.

## the shop

- **Orders** in the menu with the count of new ones; a line on Home under "Needs you".
- A list with New, Waiting for the customer, To prepare, Ready, Done and All, per shop like the
  rest.
- An order: customer (name, contact as their role allows), lines with photo, stock in that shop and
  editable price and quantity while quoting, total with VAT, notes, the history, and the actions
  the person may take for its state.
- **Picked up** takes the stock off as sales in that shop (setting `orders.takeStock`), one movement
  per line with `ref_type = 'order'`, so reports and the ledger see it like any sale. Nothing is
  reserved before that in this version.
- **On orders**: what confirmed and ready orders promise is shown, never taken off. The product's
  stock per shop gets a pill "5 on orders" that lists the orders holding them (#1042, #1045), the
  stock list shows the same pill, and an order being priced shows "in stock 12 · 5 already on
  orders" per line. Only for people who may see orders there.

## messages

| when | to | push | email |
|---|---|---|---|
| sent | the shop: people with `orders.quote` there who turned on the "New orders" alert | yes | no |
| sent | the customer | no | "we got your order" |
| price sent | customer | yes | yes, with the lines and total and a button to answer |
| confirmed | customer | yes | yes |
| customer accepts / says no / cancels | the person who quoted, else people with `orders.quote` | yes | no |
| ready | customer | yes | yes |
| declined or cancelled by the shop | customer | yes | yes, with the reason |
| price expired | customer, and the person who quoted | yes | customer only |

All in the reader's language, emails in the shop's look like the others, push opening the order.

## data

```
orders        id, org_id, shop_id, number, customer_id, status, priced (0/1), note, wanted_on,
              currency, total_minor (null while unknown), quote_valid_until, quoted_by,
              created_at, updated_at, closed_at, cancel_reason
order_lines   order_id, org_id, line_no, variant_id, product_name, qty, uom, unit_price_minor
              (null while unknown), line_total_minor, note
order_events  id, org_id, order_id, at, actor_type (customer/staff/system), actor_id, kind,
              data (json: old and new total, reason, changed lines)
order_counters org_id, next_number
```

Names are copied onto the line so an order still reads right after a product is renamed or
archived.

## edge cases

- product archived or hidden after it was added to the phone's order: sending says which line, the
  customer removes it.
- shop stops taking orders, or the business turns orders off: open orders still finish, new ones are
  refused (`orders_off`).
- customer erased: their orders stay for the shop's books without name and contact.
- too many open orders, too many lines, too big a quantity: refused with the limit, the app says it.
- a quote answered after it expired: refused (`quote_expired`), the order shows as expired.
