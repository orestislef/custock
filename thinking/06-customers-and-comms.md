# 06. customers and comms (CRM)

How customers join, what they see, and how shops talk to them.

## the customer

**decided:**

- a customer belongs to **one organization**. same person at two businesses = two records that
  never meet, each with its own consents.
- a customer can exist **without an app account**: name plus email or phone from the join page is
  enough. if they later install the app and sign in with the same verified email, the records link
  (`customers.user_id`).
- one app account can follow many businesses. the app feed mixes them, each business only ever
  sees its own customer record.

## joining

The 30 second rule: from seeing the QR on the window to being subscribed, without installing anything.

```
QR on the window / receipt / instagram bio
  -> <our domain>/j/<code>          (small web page, not the app, loads fast on 4g)
  -> shop branding, "get news and offers from Lemoni Kifisia"
  -> name, email (or phone later), optional interests
  -> channel boxes, all unticked:  [ ] email news   [ ] push (needs the app)
  -> bot check (turnstile), rate limit per ip and per code
  -> "check your email" -> confirm link (double opt in)
  -> welcome page: "you're in. get the app for offers and back in stock alerts" + store links
```

- the page language follows the browser (el, en, ru) with a switch at the top.
- if the person already has the app, the same link opens the app (universal link / app link)
  straight on the join screen, already signed in, one tap.
- each join link has a **scope** (org, group or shop) and a **label** ("window poster",
  "receipt", "instagram bio"), so we know which one works. a link can add default tags.
- links can expire or be disabled and replaced, for when a poster is printed wrong or a code leaks.
- the join page shows exactly what they will get and from whom, and links the privacy notice of the
  business. no pre-ticked boxes, ever.
- **age**: a "I am 15 or older" box. greece sets 15 as the age of digital consent.

Staff can also add a customer at the counter (`customers.add`): the customer types their own email
on the staff phone, or scans the shop QR with their own phone. consent is recorded as `staff`, the
confirmation email still goes out.

## subscriptions: who follows what

A customer can follow the whole org, a group, or a shop. Rows can be `pending` (not confirmed yet),
`subscribed`, `unsubscribed`.

**Rule: the most specific row wins.**

| rows the customer has | follows Kifisia? |
|-----------------------|------------------|
| org: subscribed | yes |
| org: subscribed, shop Kifisia: unsubscribed | no |
| group North Athens: subscribed (Kifisia is in it) | yes |
| group: subscribed, shop Kifisia: unsubscribed | no |
| shop Kifisia: subscribed, org: unsubscribed | yes, for Kifisia only |

A new shop added to a group is followed automatically by everyone subscribed to the group, because
the rule is evaluated live, not copied.

## consent

Following a shop and agreeing to be contacted on a channel are two different things.

- per customer, per channel (email, push, sms), an **append only** consent ledger: granted or
  withdrawn, when, from where (join page, app, unsubscribe link, staff, import), which wording
  (`text_version`, per language), ip and user agent.
- `email_ok`, `push_ok`, `sms_ok` on the customer are just a cache of the latest row.
- **email** needs double opt in before anything marketing goes out.
- **push** needs the os permission plus the in app switch per business. we ask for the os
  permission only when they follow their first shop in the app, with a screen that says what they
  will get ("offers and back in stock alerts from shops you follow, max 2 a day"), never on launch.
- **sms** later, it costs money per message.
- **notify me** on a product is consent for that one message about that one product, nothing more.

### unsubscribing

- every email: a footer link and the one click `List-Unsubscribe` + `List-Unsubscribe-Post`
  headers. the link opens a page without login: "stop emails from Lemoni Kifisia" or "from all of
  Lemoni".
- in the app: switches per business and per channel in profile, and "unfollow" on the shop page.
- unsubscribing never needs a login and never asks "are you sure" more than once.

### privacy rights

- **see my data**: export as a file from the app profile or by email request.
- **delete me**: the customer record is erased (personal fields wiped, row kept so counts in
  reports stay right). from the app, or by the business with `customers.erase`.
- unconfirmed signups are deleted after 30 days.
- imports: the importer must confirm they have consent. imported contacts without proof get a
  "do you want to join?" email and stay `pending` until they confirm.

## what customers see

This is the merchant's choice, per business. Three switches in **settings > customer page**
(`org.settings.manage`), with a live preview of the customer screen next to them.

| setting | values | default |
|---------|--------|---------|
| **catalog** | off / subscribers only / public | subscribers only |
| **prices** | show / hide | show |
| **stock** | off / availability / exact number | off |

- **catalog off**: customers only get posts and offers. good for shops that do not want to list
  everything.
- **subscribers only**: the catalog is in the app and on the web for people who joined.
- **public**: anyone with the link sees it, including search engines (with a "do not index" option).
  good for "is it in stock near me" searches.
- **prices hidden**: for jewellery, made to order, "ask in the shop". offers can still show
  prices if the merchant wants.
- **stock**:
  - `off`: nothing about quantity.
  - `availability`: "in stock", "only a few left" (at or below `few_left_threshold`, default 3),
    "out of stock". per shop.
  - `exact`: "7 in stock at Kifisia".

Finer control:

- **per shop** override of the stock setting (a shop that is more of a warehouse, or a shop with
  messy counts, can say off).
- **per shop** "show to customers" (hide a warehouse location completely).
- **per product** "visible to customers" (packaging, supplies, internal stuff) and "never show
  stock of this one" (rare or high value items).

Things to be careful about, also in [15](15-edge-cases.md):

- numbers seen by customers are cached for a minute or two and say "stock changes during the day".
- negative stock shows as out of stock, never as a negative number.
- products with "track stock" off show nothing about availability.
- exact numbers tell competitors how much you sell. the settings screen says this plainly next to
  the switch.

## the customer app

One app, the same one staff use. If you only follow shops, you only see the customer side. If you
also work somewhere, a switch in profile flips between "work" and "my shops". See
[09](09-app-per-role.md) for screens.

| tab | what is there |
|-----|---------------|
| **home** | the feed: news, new arrivals, events from every shop you follow, newest first, filter by shop |
| **offers** | running offers only, ending soonest first, with the offer price and the "was" price |
| **catalog** | browse the businesses that allow it. categories, search, product pages |
| **shops** | shops you follow: hours, map, call, directions, unfollow. "scan a shop QR" to join a new one |
| **profile** | name, language, channels per business, notify me list, saved products, my data, delete account |

Tabs never disappear depending on the shops you follow. If no shop you follow shares its catalog,
the catalog tab says so and explains why ("Lemoni does not share its catalog in the app. you will
still get their offers."). Apple's rule: do not hide tab bar items, explain the empty state instead.

### product page for customers

- photos, name and description in the customer's language when the shop has a translation.
- price (if shown), offer badge with offer price and the was price.
- availability per shop, following the settings above.
- **notify me** when out of stock (for one shop or any shop).
- **save** (heart). explicit, so it is fine to use for "people who saved this" audiences.
- share link (opens the public page if the catalog is public, otherwise the join page).

### shelf QR

A QR on the shelf opens the product page on the web for anyone, with "notify me" and "join this
shop". The staff app reads the same QR as a stock look up. See [05](05-inventory.md).

## posts

One thing to write, many places it goes.

| kind | for |
|------|-----|
| `news` | anything: new opening hours, a story |
| `new_arrival` | new products, linked from the catalog |
| `offer` | prices for a period, linked products with offer prices |
| `back_in_stock` | written by a manager for a big restock (the automatic one per product is separate) |
| `event` | tasting, workshop, opening night |

### the composer

1. kind, title, text, photos.
2. **languages**: tabs EL / EN / RU. the org default language is required, others optional. each
   customer gets their language, or the default if that one is missing. the tab shows how many
   followers read each language ("RU: 46 people"), so the manager knows if a translation is worth it.
3. **products**: pick or scan products to link. for offers: an offer price per product (needs
   `offers.price.set`), a start and an end.
4. **audience**: shops and groups you can post to (only your scopes), plus optional filters: tags,
   interests, language, "saved one of these products", "joined in the last 30 days".
5. **channels**: feed always, push and email if your role allows.
6. **when**: now or scheduled (in the shop timezone).
7. **preview and the live count**, explained in words, not just a number:

```
  312 people will see this
    280 follow Kifisia, 32 follow all of Lemoni
  push to 190 of them
    41 turned push off, 81 do not have the app
    pushes between 22:00 and 09:00 wait until morning
  email to 150 of them
    12 have not confirmed their email yet
```

8. **publish** or, without `posts.publish`, **submit for approval**. the approver gets a push and
   sees the same preview.

### offers and prices

- an offer post carries offer prices per linked variant and a validity window. while it runs:
  the catalog and product pages show the offer price, and quick sale in the post's shops uses it
  automatically (saved on the movement, so reports know).
- **the "was" price follows the EU omnibus rule**: when showing a reduction, the reference price is
  the lowest price of the last 30 days. that is why `price_history` exists. the app computes it and
  shows a small "lowest price in the last 30 days" note. no fake "was" prices possible.
- an offer that ends drops off the feed and the offers tab by itself.

### sending

```
publish / schedule time reached
  -> job: resolve audience, snapshot into deliveries (one row per customer per channel)
  -> skip rows with a reason: no consent, push cap reached, email suppressed, no device
  -> quiet hours: push rows get send_after = 09:00 shop time
  -> worker sends push in batches (FCM v1), email in batches (rate limited)
  -> provider answers update each row: sent, failed, bounced
  -> dead push tokens removed, hard bounces suppressed platform wide
```

- **cancel** while sending stops the rows still queued. already sent pushes cannot be pulled back,
  the composer says this before publishing.
- **editing a sent post** updates the feed and the web page. it does not resend.
- **frequency cap**: max pushes per customer per business per day (default 2, `push_daily_cap`).
  extra ones go to the feed only.
- the feed is not a delivery. it is "posts sent to scopes I follow", so someone who joins today
  still sees the offer that started yesterday and runs till sunday.

## push notifications

Push is the strongest channel, so it must stay welcome. Every push the system sends:

| push | to | when |
|------|----|------|
| post / offer | customers in the audience with push on | publish or schedule |
| back in stock | customers waiting for that product | receive, transfer in or return takes stock above 0 |
| offer ending | customers who saved a product in the offer (opt in) | the evening before it ends |
| welcome | new follower with the app | after confirming |
| low stock | managers of the shop who turned it on | a movement drops stock to the reorder point |
| unknown codes | managers | daily digest if there are new ones |
| transfer on the way / arrived | staff of the receiving / sending shop | send / receive |
| count ready for review | members with `stock.count.approve` | count submitted |
| post waiting for approval | members with `posts.publish` | draft submitted |
| invite accepted | the one who invited | accepted |
| access changed | the member | silent data push, the app refreshes permissions |

- every push deep links to the exact screen (the post, the product, the transfer).
- title is the business or shop name, body is the message, image when the post has one.
- text is in the recipient's language, built on the server per recipient.
- grouped per business on the lock screen (thread id per org).
- staff notifications are per person, each one can be turned off in settings, with a "daily
  digest instead" option for the noisy ones.

## email

- transactional (confirm email, invites, password, exports ready): from my server, in the
  recipient's language.
- newsletters (post emails): simple responsive template per business with logo and color,
  "Lemoni Kifisia via Custock" as sender name, reply-to the shop's email. we do not send "from" the
  shop's own domain unless they set up DNS for it, otherwise DMARC fails and it lands in spam.
- volume and reputation details in [13](13-stack.md).

## CRM screens for staff

- **customers list**: search (name, email, phone, tag), filters (shop, tag, interest, channel
  state, language, joined date), counts on top. contacts masked without `customers.contact.view`.
- **customer detail**: who they follow, consents with history ("email granted 3 nov from the
  window poster, el wording v1"), tags, interests, notes, notify me list, saved products, what we
  sent them and what happened.
- **join links**: create, label, print a poster (A4 / A5 pdf with the QR, shop name, a line of
  text in up to three languages), stats per link.
- **import / export**: with the consent rules above. every export is in the audit log.
