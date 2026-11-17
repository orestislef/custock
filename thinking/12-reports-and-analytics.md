# 12. reports and analytics

Two different things that people mix up:

| | business reports | app analytics |
|-|------------------|---------------|
| for | owners, admins, managers, viewers | me, to make the app better |
| about | their stock, their customers, their posts | how the app is used, where it breaks |
| data | our own database, their data | crashes and a handful of anonymous funnel events |
| shown | in the app and the web admin | only to me |

Business reports are a feature people pay for. App analytics are kept small and private.

## business reports

Every report answers one question. If it does not help someone decide something, it does not ship.

### stock

| report | answers | how |
|--------|---------|-----|
| on hand and value | what do we have, what is it worth | sum of `stock_levels` per shop and category. value at cost (needs `products.cost.view` + `reports.financial.view`) and at retail |
| low stock | what do I order today | on hand at or below the reorder point |
| out of stock | what are we missing | on hand 0, tracked, listed in the shop |
| negative stock | what needs fixing | on hand below 0. usually a sale scanned before receiving |
| dead stock | what is sitting there | on hand > 0 and no sale in 30, 60 or 90 days. with value, so the owner sees the money stuck on the shelf |
| top sellers | what moves | sold quantity and value per variant for the period |
| sell-through | did what we bought sell | sold / (on hand at start + received) for the period |
| days of cover | how long until it runs out | on hand / average daily sales of the last 28 days |
| shrinkage | where does stock disappear | damage + negative adjust + negative count differences + transfer losses, by reason, by shop, in quantity and value at cost |
| count accuracy | how good are our counts | per count: lines exactly right, and total absolute difference vs total counted |
| transfer losses | what gets lost between shops | sent minus received per transfer and per route |
| reorder suggestions | how much to order | variants at or below the reorder point. suggested amount is `reorder_qty` if set, otherwise 14 days of average sales minus on hand |

### customers

| report | answers | how |
|--------|---------|-----|
| subscribers over time | are we growing | subscribed customers per org, group and shop, per day |
| join links | which QR poster works | opens, signups, confirmed per join link, and the conversion from open to confirmed |
| channel reach | how many can we actually reach | share of customers with push on, verified email with consent, both, none |
| unsubscribes | are we annoying people | per day, per channel, and how many came right after a post |
| languages | who are we talking to | split by `en`, `el`, `ru`. tells the owner if writing posts in Russian is worth it |
| interests | what people care about | customers per interest category |

### comms

| report | answers | how |
|--------|---------|-----|
| per post | did it reach people | audience size, delivered, failed (with reasons), skipped (no consent, cap reached, quiet hours, suppressed) |
| opens | did they look | push opens from the app. email opens by pixel, **marked approximate**: Apple Mail privacy protection loads images for everyone, so email opens are inflated and only good for comparing posts with each other |
| clicks | did they act | links in emails go through `/r/<delivery>/<link>`, which counts the click and redirects. push taps count as clicks |
| product interest after a post | did it make people look at the products | views of the linked products in the 48 hours after sending, vs the 7 days before |

### where CRM meets IMS

These are the reports only Custock can do, because it has both sides. They go on the owner's
home screen, not buried in a menu.

| report | answers | how |
|--------|---------|-----|
| **most wanted while out of stock** | what should I order right now | waiting `stock_alerts` per variant, with how long people have been waiting. "23 people want Thyme honey 450g" |
| **back in stock conversion** | does telling people work | after alerts went out, sales of that variant in that shop in the next 7 days vs its usual 7 days (average of the previous 28 days while in stock). marked **approximate**, because a sale is not linked to the person who was told |
| **interest vs stock** | do we stock what our customers care about | per category: customers interested vs units and variants in stock. "180 people follow Coffee, 4 coffee products in stock" |
| **viewed a lot, sold little** | what is wrong with this product | top viewed products (customer catalog) with low sales. usually price, photo or availability |
| **most favorited** | what do people love | hearts per product, and how many of those are out of stock now |
| **offer effect** | did the offer sell | sales of the linked variants during `valid_from` to `valid_until` vs the same length of time before |

### staff

| report | answers | needs |
|--------|---------|-------|
| activity per person | who does what | movements, counts, receipts, posts per member |
| adjustments per person | where does shrink come from | negative adjustments and damage per member, with reasons and value. the honest shrink signal, shown carefully: numbers, no accusations |

Needs `reports.staff.view`. Staff never see each other's numbers.

## who sees what

| permission | adds |
|------------|------|
| `reports.view` | quantities, counts, customer numbers, post stats, for the shops where you hold it |
| `reports.financial.view` | money: stock value, sales value, cost, margins, value of shrink. without it these columns **do not exist** on screen. not zero, not blurred, gone |
| `reports.staff.view` | per person breakdowns |
| `products.cost.view` | needed on top of financial for anything at cost |

- a report never mixes in shops you cannot see. if you hold `reports.view` in 2 of 3 shops, "all
  shops" says "your 2 shops" and the totals are only theirs.
- CSV and PDF exports follow the same rules. an export cannot contain a column the screen hides.

## dashboards per role

The home screen is the dashboard. It shows what needs doing, then what happened.

| role | home shows |
|------|------------|
| owner, admin | all shops side by side: sales today and this week (if financial), stock value, low stock count, most wanted while out of stock, new customers this week, last post reach. tap a shop to drill in |
| manager | my shop today: low stock list, people waiting for products, transfers to receive, unknown codes to fix, new customers, scheduled posts |
| staff | no reports. tasks: open counts, transfers to receive, the unknown codes they scanned. a small "today: 34 scans" for a sense of progress |
| viewer | reports, read only. the accountant view: stock value, sales, shrink, exports |

Every number on a dashboard can be tapped and opens the report behind it, already filtered.

## periods and time

- presets: today, yesterday, last 7 days, last 28 days, this month, last month, this year, custom.
- **a day is a day in the shop's timezone.** a chain with shops in Athens and Cyprus uses each
  shop's own days. daylight saving days have 23 or 25 hours, that is fine because we bucket by
  local date, not by 24 hour blocks.
- compare to the previous period, always shown as a small "+12% vs last week".
- which day does a movement belong to? `occurred_at` (phone time) if it is within 48 hours of
  `recorded_at` (server time), otherwise `recorded_at`. a sale scanned offline on Tuesday and
  synced Wednesday morning still counts on Tuesday. a phone with a clock set to 2019 does not
  move sales into 2019.

## how it stays fast on sqlite

- dashboards and period reports read the **rollup tables** from the schema:
  `daily_shop_stats`, `daily_variant_stats`, `join_link_stats_daily`, `product_view_stats_daily`.
- rollups are updated as things happen (in the same transaction as the movement, or by a job a
  few seconds later).
- a nightly job recomputes the last 3 days from the ledger, to catch offline movements that
  arrived late. a movement older than that triggers a recompute of its own day.
- the raw ledger is only read for drill downs on short ranges (one product, one day).
- for heavy one off analysis I can open a copy of the sqlite file in DuckDB on my machine. no
  data warehouse.

## exports

- CSV (UTF-8 with BOM, `;` for el and ru) and PDF (fonts embedded), see [11](11-languages.md).
- PDF reports include the charts, the filters used, the period, the shop timezone and who
  exported it.
- exports with customer data need `customers.export` and land in the audit log. report exports
  with only totals are logged too, it is cheap.
- export files are private in storage, downloaded through short lived links, and deleted after 7 days.

## weekly summary email

- every Monday at 08:00 in the org timezone, to owners, admins and managers who did not turn it off.
- in each person's own language, with only what they are allowed to see.
- the content: how the week went vs the week before, top 5 sellers, what is low, the most wanted
  while out of stock, new customers, the best post. a button to open the full report.
- skipped if nothing happened. nobody wants "0 sales, 0 customers" in their inbox.

## charts

- one validated categorical palette from [10](10-design.md), checked for color blindness and for
  contrast in light and dark.
- a thing keeps its color everywhere: shop Kifisia is the same color in every chart.
- never color alone. lines get labels at the end, bars get values, series get a legend you can tap.
- numbers in tabular figures so columns line up.
- empty charts say why and what to do: "no sales scanned this week. sales show up here when staff
  use Sell mode."
- reduced motion: charts appear without drawing animations.

## app analytics (for me)

**decided:** privacy first. the shops trust us with their customers, the customers trust the shops.

- **crashes:** crash reporting in the app. Firebase Crashlytics is the easy option because the
  Firebase SDK is already in the app for FCM. no personal data in crash reports, user id hashed.
- **a few funnel events of my own:** org created, first shop set up, first product, first scan,
  first customer joined, first post sent. stored in a small `app_events` table on my server (to add
  to the schema), per org, no device fingerprinting. this tells me where new shops get stuck.
- **no third party analytics or tracking SDKs** on anything customers touch (the customer app,
  join pages, product pages). no ad pixels, ever.
- join pages count opens per join link without cookies, so no cookie banner is needed.
- product views are counted per product per day (`product_view_stats_daily`). never stored per
  person. favorites and notify me are different: those are things the customer chose to do.
- server logs keep IPs for 14 days for security, then drop them.
