# 03. permissions

Every permission key, at what level it works, and what the default roles get.

## levels

| level | meaning |
|-------|---------|
| **org** | only counts when the role is assigned at `org` scope. business wide things |
| **shop** | checked per shop. a role at a group or the org covers every shop under it |
| **any** | counts if you hold it at any scope. used for the shared catalog |

## the catalog of permissions

### organization (level org)

| key | allows |
|-----|--------|
| `org.settings.manage` | name, logo, colors, currency, timezone, default language, policies (negative stock, post approval) |
| `org.billing.manage` | plan and invoices (later, if custock is sold) |
| `org.audit.view` | the audit log of the whole org |
| `org.support_access.manage` | let the platform admin in for support, for a limited time |
| `shops.create` | add a shop |
| `shops.archive` | close a shop. its history stays |
| `groups.manage` | create groups, put shops in them |
| `roles.manage` | create and edit custom roles (ceiling and rank rules still apply) |
| `categories.manage` | the category tree of the catalog |
| `products.price.edit` | base price of products, for all shops |
| `customers.import` | import customers from a file |
| `customers.erase` | erase a customer on a GDPR request |

`org.delete` is not a permission. only owners can delete an organization, and it can never be put in a custom role.

### team (level shop)

| key | allows |
|-----|--------|
| `members.view` | see who works in the shop and their roles |
| `members.invite` | invite people, with roles that pass the delegation rules |
| `members.manage` | change roles, suspend, remove (only people ranked below you) |
| `shop.settings.manage` | shop name, address, hours, contact, timezone |

### catalog (level any)

| key | allows |
|-----|--------|
| `products.view` | see products, variants, barcodes, photos, prices |
| `products.create` | add products, including from an unknown scanned barcode |
| `products.edit` | edit name, description, photos, variants, barcodes |
| `products.archive` | archive a product. stock history stays |
| `products.import` | bulk add products from a file |
| `products.cost.view` | see cost prices and margins. hidden otherwise, not just greyed |
| `products.cost.edit` | set cost when receiving or editing |

### shop prices (level shop)

| key | allows |
|-----|--------|
| `prices.shop.edit` | override the price in this shop, hide a product in this shop |

### stock (level shop)

| key | allows |
|-----|--------|
| `stock.view` | see quantities in the shop |
| `stock.history.view` | see the movement ledger, who did what and when |
| `stock.receive` | add stock that arrived |
| `stock.sell` | quick sale, minus stock |
| `stock.return` | customer return, plus stock |
| `stock.adjust` | manual plus or minus with a reason (found, lost, damaged, expired, own use) |
| `stock.count` | do stock counts |
| `stock.count.approve` | review a count and apply the differences |
| `stock.transfer.send` | send stock to another shop |
| `stock.transfer.receive` | confirm stock that arrived from another shop |
| `stock.settings.manage` | reorder points, low stock alerts |

### customers (level shop)

For a shop scoped member, "customers" means customers whose subscriptions reach their shops
(see [02](02-tenancy-and-roles.md)).

| key | allows |
|-----|--------|
| `customers.view` | list, names, tags, subscriptions. email and phone shown masked |
| `customers.contact.view` | full email and phone |
| `customers.add` | add a customer at the counter, with their consent recorded |
| `customers.edit` | tags, notes, interests |
| `customers.export` | export to a file. audit logged every time |

### comms (level shop)

| key | allows |
|-----|--------|
| `posts.view` | see posts and their stats |
| `posts.create` | write drafts, submit for approval |
| `posts.publish` | send or schedule, approve posts of others |
| `posts.channel.push` | include push in a post |
| `posts.channel.email` | include email in a post |
| `posts.delete` | delete posts (sent pushes and emails cannot be taken back, the feed item goes) |
| `offers.price.set` | set offer prices on products linked to an offer post, for the post's shops |
| `joinlinks.manage` | create, print and disable QR codes and join links |

### reports (level shop)

| key | allows |
|-----|--------|
| `reports.view` | stock and customer reports and dashboards |
| `reports.financial.view` | money in reports: stock value, sales value, margins |
| `reports.staff.view` | activity per staff member |

## default roles

When an organization is created, the default roles are **copied into it**. After that each org can
edit its own admin, manager, staff and viewer roles. The owner role is locked.

`x` means the role has it.

| permission | owner | admin | manager | staff | viewer |
|------------|:-----:|:-----:|:-------:|:-----:|:------:|
| org.settings.manage | x | x | | | |
| org.billing.manage | x | | | | |
| org.audit.view | x | x | | | |
| org.support_access.manage | x | | | | |
| shops.create | x | x | | | |
| shops.archive | x | x | | | |
| groups.manage | x | x | | | |
| roles.manage | x | x | | | |
| categories.manage | x | x | | | |
| products.price.edit | x | x | | | |
| customers.import | x | x | | | |
| customers.erase | x | x | | | |
| members.view | x | x | x | | |
| members.invite | x | x | x | | |
| members.manage | x | x | x | | |
| shop.settings.manage | x | x | x | | |
| products.view | x | x | x | x | x |
| products.create | x | x | x | | |
| products.edit | x | x | x | | |
| products.archive | x | x | | | |
| products.import | x | x | | | |
| products.cost.view | x | x | | | x |
| products.cost.edit | x | x | | | |
| prices.shop.edit | x | x | x | | |
| stock.view | x | x | x | x | x |
| stock.history.view | x | x | x | | x |
| stock.receive | x | x | x | x | |
| stock.sell | x | x | x | x | |
| stock.return | x | x | x | x | |
| stock.adjust | x | x | x | | |
| stock.count | x | x | x | x | |
| stock.count.approve | x | x | x | | |
| stock.transfer.send | x | x | x | | |
| stock.transfer.receive | x | x | x | x | |
| stock.settings.manage | x | x | x | | |
| customers.view | x | x | x | x | x |
| customers.contact.view | x | x | x | | |
| customers.add | x | x | x | x | |
| customers.edit | x | x | x | | |
| customers.export | x | x | | | |
| posts.view | x | x | x | x | x |
| posts.create | x | x | x | | |
| posts.publish | x | x | x | | |
| posts.channel.push | x | x | x | | |
| posts.channel.email | x | x | x | | |
| posts.delete | x | x | | | |
| offers.price.set | x | x | x | | |
| joinlinks.manage | x | x | x | | |
| reports.view | x | x | x | | x |
| reports.financial.view | x | x | | | x |
| reports.staff.view | x | x | x | | |

Notes on the defaults:

- staff cannot create products by default. when they scan an unknown barcode it goes to an
  "unknown codes" list for the manager (see [05](05-inventory.md)). an org can give staff
  `products.create` if it trusts them.
- managers do not see cost and money by default. many owners do not want that. one tick to change.
- the org setting **"posts need approval"** simply takes `posts.publish` away from managers, so
  their posts wait for an admin. same mechanism, no special case.

## how the app knows

- one file, `permissions.json`, is the single source of truth: key, level, group, and the
  translation keys for its name and description. both server and app generate their constants
  from it, so a typo is a compile error, not a silent hole.
- after login and on every app resume the app asks `GET /v1/me/context` and gets, per org:
  the org level permissions, the permissions per shop, the rank per shop, and a `perms_version`.
- in the app: `can('stock.adjust', shopId)` and a `PermissionGate` widget that renders nothing
  when the answer is no. routes have guards too, so a deep link cannot open a screen you cannot use.
- any change to a member's roles bumps their `perms_version`. the server sends a silent push
  (`perms_changed`) and also answers any request made with an old version with a header that
  tells the app to refresh. so a demoted manager loses the buttons within seconds, and the server
  refuses the actions right away regardless.

## hide or show read only

| situation | what the app does |
|-----------|-------------------|
| no permission for a whole area (no `reports.view`) | tab or menu item does not exist |
| can see but not change (`products.view` without `products.edit`) | screen shows, edit buttons do not |
| can change some fields but not others (edit product, no `products.price.edit`) | price shown as read only with a small lock and "set by admin" |
| sensitive data (no `products.cost.view`, no `customers.contact.view`) | not shown at all, or masked: `ma***@gmail.com`, `+30 69** *** 123` |
| action exists but blocked right now (count waiting for approval) | button shown disabled with the reason |

Rule of thumb: never show a button that will fail because of permissions.

## the roles editor

- a list of permission groups with switches, in the user's language.
- switches for permissions you do not have are shown but locked, with "you do not have this".
- the rank slider stops below your own rank.
- before saving an edit to a role in use: "this changes access for 7 people" with the list.
