# 09. app per role

What each person sees and can do. Permissions are in [03](03-permissions.md), the look in
[10](10-design.md).

## one app, two sides

**decided:** one app in the stores, called Custock.

- if you are a member of a business: the **work** side.
- if you follow shops: the **my shops** side.
- both: a switch at the top of profile. the app remembers the last side.
- a member of several businesses picks the business from the title area. the last one is remembered.

The web app (Next.js) is the same thing in a wide layout, mainly for owners and admins doing bulk
work, and for the public customer pages.

## the context bar

On the work side the title area always shows **where you are**: business, and shop.

```
  Lemoni  ·  Kifisia  v
```

- tap to switch shop. only shops where you have something are listed.
- "all shops" appears when your role covers more than one shop. lists then show a shop column and
  numbers add up.
- one shop org: no switcher at all, just the name.

## tabs per role

Tabs are fixed per role. Scan is an action, not a tab (see [10](10-design.md#layout-and-navigation)).

| role | tabs | scan action |
|------|------|-------------|
| owner, admin | Home, Stock, Customers, Posts, More | yes |
| manager | Home, Stock, Customers, Posts, More | yes |
| staff | Today, Stock, Customers, More | yes, opens straight in their most used mode |
| viewer | Home, Stock, Customers, Reports | no |
| customer | Home, Offers, Catalog, Shops, Profile | QR scan lives in Shops ("join a shop") |

**More** holds: Reports, Team, Shops and groups, Join links, Settings, Audit log, Help, Profile.
Each item exists only with the permission behind it. Custom roles get tabs computed from their
permissions with the same rules (no stock permissions = no Stock tab).

## owner and admin

**Home**
- greeting with the business, today's date in their language.
- cards across all shops (or the selected one): stock value (money only with
  `reports.financial.view`), low stock count, people waiting for products, new followers this week,
  posts scheduled, counts waiting for approval, transfers on the way.
- "needs you" list: approvals (posts, counts), unknown codes, negative stock.
- compare shops: small table, one row per shop.

**Stock**: product list with search and filters (low, out, negative, category, shop), product
detail, receive, counts, transfers, unknown codes, labels.

**Customers**: list, detail, tags, import and export, join links.

**Posts**: list (drafts, waiting approval, scheduled, sent), composer, stats per post.

**More**: reports, team and roles, shops and groups, settings (business, customer page, policies,
notifications), audit log, support access.

## manager

Same tabs as admin, everything filtered to their shops. Differences by default:

- no costs, no money in reports, no business settings, no roles editor, no import and export.
- team: sees and invites staff for their shops. the invite sheet shows only roles below manager,
  the others visible but locked with "you can give roles below manager".
- posts: can publish to their shops' followers unless the business turned on approval, then the
  button says "Submit for approval".
- prices: base price locked with "set by admin", shop price editable.

## staff

Built for speed, one hand, gloves on in a cold stock room.

**Today**
- big buttons for their modes: Sell, Receive, Count (only the ones they have).
- "on the way to your shop" transfers to receive.
- open counts they are part of.
- the last 10 things they did, each with undo while it is still allowed.

**Stock**: search and look up only. quantities in their shop, other shops if they can see them.
no costs, no history unless given.

**Customers**: add a customer at the counter, see names and tags, masked contacts.

**More**: profile, help, notification settings.

## viewer (accountant, partner)

Everything read only. Home, Stock, Customers (masked), Reports with money. No scan, no actions.
Every list has export only if the role has `customers.export` or the report allows it.

## customer

**Home** (feed): posts from followed shops, newest first, chips to filter by shop. each card:
shop name, photo, title, short text, linked products with prices (if the shop shows them),
"offer ends sunday".

**Offers**: running offers only, ending soonest first, offer price and the "was" price with
"lowest price in the last 30 days".

**Catalog**: businesses that share their catalog. categories, search (accent insensitive, greeklish
works), product pages with availability as the merchant allows, notify me, save.

**Shops**: followed shops with hours, call, directions. "join a shop" opens the QR scanner.
unfollow per shop.

**Profile**: name, language, channels per business, notify me list, saved products, my data,
delete account, and the switch to work side if they are also staff somewhere.

## key screens

### scan (staff, compact width)

```
 +--------------------------------+
 |  Lemoni · Kifisia        x     |
 |  +--------------------------+  |
 |  |                          |  |
 |  |      camera view         |  |
 |  |   -----scan line-----    |  |
 |  |                          |  |
 |  +--------------------------+  |
 |  torch    type code    search  |
 |                                |
 |  Receiving · 3 lines · 31 pcs  |
 |  Olive oil 500ml     [-] 24 [+]|
 |  Thyme honey 450g    [-]  6 [+]|
 |  Sea salt 250g       [-]  1 [+]|
 |                                |
 |  ( Look up | Sell | Receive | Count )   <- only your modes
 |  [      Receive 31 items      ]|
 +--------------------------------+
```

### product (manager)

```
 +--------------------------------+
 |  <  Stock                 ...  |
 |  [ photo        photo   photo ]|
 |  Thyme honey 450g              |   <- Commissioner
 |  Honey · 5201234567893         |
 |                                |
 |  Kifisia        0  out  14 waiting   |
 |  Marousi        7              |   <- tally numbers
 |  Glyfada        2  few left    |
 |                                |
 |  Price  12,90 €  (lock) set by admin |
 |  Kifisia price  12,50 €   edit |
 |                                |
 |  History                    >  |
 |  Barcodes (2)               >  |
 |  [ Receive ]  [ Transfer in ]  |
 +--------------------------------+
```

### composer audience (manager)

```
 +--------------------------------+
 |  Audience                      |
 |  (x) Kifisia   ( ) Marousi (locked: not your shop)
 |  Tags: regulars                |
 |                                |
 |  312 people will see this      |
 |  280 follow Kifisia, 32 follow all of Lemoni |
 |  Push to 190. 41 turned push off, 81 no app  |
 |  Pushes after 22:00 wait until 09:00         |
 |  Email: not in your role (ask Eleni)         |
 |                                |
 |  [   Submit for approval   ]   |
 +--------------------------------+
```

## screen inventory with permissions

| screen | needs | actions inside and what they need |
|--------|-------|-----------------------------------|
| home dashboard | any work role | cards hide per permission |
| product list | `products.view` | new product: `products.create`. import: `products.import` |
| product detail | `products.view` | edit: `products.edit`. price: `products.price.edit`. shop price: `prices.shop.edit`. cost shown: `products.cost.view`. archive: `products.archive` |
| stock per shop | `stock.view` | history: `stock.history.view`. reorder point: `stock.settings.manage` |
| scan | any of the scan mode permissions | each mode needs its own permission |
| receive | `stock.receive` | cost per line: `products.cost.edit` |
| sell | `stock.sell` | |
| adjust | `stock.adjust` | |
| counts | `stock.count` | apply: `stock.count.approve` |
| transfers | `stock.transfer.send` or `.receive` | |
| unknown codes | `products.create` or `products.edit` | |
| labels | `products.view` | |
| customers list | `customers.view` | add: `customers.add`. export: `customers.export`. import: `customers.import` |
| customer detail | `customers.view` | contact: `customers.contact.view`. tags, notes: `customers.edit`. erase: `customers.erase` |
| join links | `joinlinks.manage` | |
| posts | `posts.view` | write: `posts.create`. publish: `posts.publish`. push/email: `posts.channel.*`. offer prices: `offers.price.set` |
| reports | `reports.view` | money: `reports.financial.view`. staff: `reports.staff.view` |
| team | `members.view` | invite: `members.invite`. change: `members.manage` |
| roles | `roles.manage` | |
| shops and groups | `shops.create`, `groups.manage`, `shop.settings.manage` | |
| business settings | `org.settings.manage` | customer page settings live here |
| audit log | `org.audit.view` | |

## first run

- **new business owner**: create business (name, country, language, currency are guessed from the
  phone), first shop, then straight to "scan your first product". invite team, print the window
  QR and customer page settings come as tips later, not as a wall of steps.
- **invited member**: open the invite link, sign up with the email it was sent to, land on their
  role's home with one tip about their main action.
- **customer**: from a QR, the join web page. in the app, the first followed shop's feed.
