# 15. edge cases

The things that break apps like this, and what we do. Grouped by area. Each line: the case, then
the plan.

## tenancy and access

| case | plan |
|------|------|
| a query forgets the `org_id` filter and leaks another business's data | repository layer builds the filter from the org context, raw sql outside it is not allowed, tests try cross org reads on every endpoint |
| manager tries to give a permission they do not have | ceiling rule, server refuses. the app shows it locked with the reason |
| two managers of one shop try to remove each other | rank rule, both refused. only someone above them can |
| someone edits their own roles | refused, no self service |
| the last owner tries to leave or delete their account | refused until ownership is transferred or the org is deleted |
| a role loses a permission while 7 people are using the app | next request is refused, silent push makes the apps refresh, the editor warned "changes access for 7 people" before saving |
| a member is removed while their app is open, with offline data on the phone | next sync gets 403, the app wipes that org's local data and shows "you no longer have access to Lemoni" |
| a shop moves out of a group | group managers lose that shop immediately. listed in the audit log |
| a shop is archived | its stock history, assignments and join links stay but are inactive. its join links show "this shop is closed" with links to other shops of the org |
| invite sent to an email that already has an account | the invite just adds the membership on accept |
| invite sent to the wrong email | revoke it, the link stops working. single use, 7 days |
| invited person signs up with a different email than the invite | refused, the invite is bound to that email. ask for a new invite |
| person is staff at org A and customer at org A | two separate things. their staff role gives them no special view of their own customer record |
| person works for two businesses | org switcher, each org fully separate, local data separate |
| platform admin needs to look at an org's data for support | only with support access turned on by the org for a limited time, every action audit logged, banner in the org |
| custom role created by someone who later loses permissions | the role keeps its permissions, the creator can no longer edit it |

## catalog and barcodes

| case | plan |
|------|------|
| same product scanned as UPC-A on one phone and EAN-13 on another | normalise to GTIN-14 before lookup |
| barcode with a bad check digit | keep it raw, warn "this code looks damaged", allow manual entry |
| a barcode already belongs to another product in the org | refused with "this code is on Thyme honey 450g", offer to open it |
| two different products really share a barcode (supplier reuses codes) | allow attaching a second meaning only with a pick list on scan ("which one?"). rare, flagged in the unknown codes list |
| a box barcode (ITF-14) means 12 pieces | `pack_qty` on the barcode, one scan = 12 |
| weighing scale labels with price or weight inside the code | not in v1. internal code prefix is configurable so we never clash. later: per org pattern to decode |
| product with no barcode at all | internal EAN-13 in the in store range, printed on labels |
| staff without `products.create` scans an unknown code | saved in unknown codes for the manager, the scan still counts in their list as "unknown" |
| product archived while someone is offline selling it | movement accepted, product flagged in a review list |
| product name with greek accents searched without accents, or in greeklish | `search_key` with diacritics stripped and transliteration, see [11](11-languages.md) |
| 10 000 products | paginated lists, FTS5 search, offline cache only for the user's shops |
| product sold by weight (olives, cheese) | quantities in grams internally, shown as kg with 3 decimals max |

## stock

| case | plan |
|------|------|
| two people scan the same product at the same time | ledger of deltas, both count, nothing lost |
| the same offline movement is uploaded twice | movement id from the device is the idempotency key, second time is a no op |
| phone clock is wrong | server time orders the ledger, phone time is only shown |
| sale scanned before the goods were received | negative stock allowed by default, shown red, in the negative stock report |
| org wants strict mode (no negative) | server refuses online movements that go below zero, offline ones are accepted and flagged |
| big mistake: 500 instead of 5 | confirm for more than 50 units, undo for 10 seconds, reversal later by a manager |
| something sold while a count is running | expected quantity is stamped per line at count time, so the difference stays right |
| a product counted twice in the same count | scans add to the line, manual edit replaces it, the line shows who counted |
| full count, some products not counted | asked on apply: leave them or set to zero. never silent |
| transfer sent 10, received 9 | received quantity is what arrives, the 1 is shown as lost in transit and lands in shrinkage |
| transfer received at the wrong shop | the receiving shop must be the target. if goods ended up elsewhere, cancel and redo with a correction note |
| stock flaps 0, 1, 0, 1 | back in stock alerts fire once per alert. low stock alerts once per dip |
| a count correction takes stock from 0 to 3 | no back in stock push (only receive, transfer in and return trigger it) |
| cached `stock_levels` drift from the ledger after a bug | nightly check rebuilds from the ledger and reports differences |

## customers and consent

| case | plan |
|------|------|
| same email joins from two QR codes of the same org | one customer, two subscriptions, consent rows for each join |
| same email at two different orgs | two customer records, each org sees only its own |
| subscribed to the group, unsubscribed from one shop | most specific wins, that shop does not reach them |
| bots spam the join page | turnstile, rate limit per ip and per code, double opt in, unconfirmed deleted after 30 days |
| someone signs up a friend's email | nothing is sent except the confirmation email. no confirmation, no marketing |
| a customer changes their email | new email must be confirmed, consent moves with it, the old one gets a notice |
| a customer asks to be deleted | erase: personal fields wiped, counts kept, notify me and favorites removed, logged |
| a customer imported from an old excel list | stays pending until they confirm a "do you want to join?" email |
| a minor signs up | the 15 or older box. if a shop sells to kids, the shop's own policy applies |
| unsubscribe link clicked by an email security scanner | the GET only shows a page with a button, the one click header uses POST as the RFC says |
| customer turned push off in the OS but on in the app | we cannot send, delivery skipped as `no_device`, the composer counts them under "no push" |
| customer has the app on two phones | both devices get the push, the cap counts per customer not per device |
| customer uninstalled the app | FCM answers unregistered, the token is removed |

## posts and push

| case | plan |
|------|------|
| scheduled post across a DST change | stored in UTC, scheduled in the shop's timezone, shown in local time |
| post goes to 5000 people and the server restarts mid send | deliveries are rows, the worker resumes from what is still queued |
| manager cancels a post while it is sending | queued rows stop, sent ones are sent. the composer warned before publishing |
| post edited after sending | feed and web page update, nothing is resent |
| linked product goes out of stock during an offer | the card shows "out of stock" (if the merchant shows stock) and "notify me" |
| linked product is archived | the card hides it. if no products left, the post still shows its text |
| a fake "was" price | not possible, the was price is computed from 30 days of price history |
| offer price lower than cost | warning to the author if they can see cost, otherwise to the approver |
| a business sends 6 pushes in a day | cap 2 per customer per day, the rest go to the feed only |
| push at 23:30 | held until 09:00 shop time |
| posts in 3 languages, customer reads russian, post only in greek | they get greek (the org default). the composer showed "RU: 46 people" so the manager knew |
| email bounces | hard bounce suppressed platform wide, soft bounces retried |
| a customer marks the newsletter as spam | complaint suppressed platform wide, the org sees it in stats |
| emails "from" the shop's own domain | not unless they set up DNS, otherwise DMARC fails. we send as "Lemoni Kifisia via Custock" |

## what customers see

| case | plan |
|------|------|
| exact stock shows 1, customer drives over, it was sold | short cache, "stock changes during the day" note, availability mode recommended over exact |
| negative stock with exact mode on | shown as out of stock |
| product without stock tracking | shows nothing about availability |
| competitor watches exact numbers | the settings screen says so next to the switch. per product "never show stock" |
| catalog public, prices hidden, offer has prices | the offer shows its prices only if the merchant ticked "show prices in offers" |
| a warehouse location | per shop "show to customers" off |

## languages

| case | plan |
|------|------|
| greek uppercase loses accents | no ALL CAPS styling anywhere |
| russian plurals (1 товар, 2 товара, 5 товаров) | ICU plurals with one, few, many, other |
| strings 30 percent longer in russian or greek | layouts wrap, no fixed width buttons, test with the longest |
| sqlite `lower()` does not fold greek or cyrillic | search key computed in our code |
| CSV opened in greek excel | UTF-8 with BOM and semicolon delimiter for el and ru |
| PDF labels with greek or russian product names | fonts embedded in the PDF |

## offline and sync

| case | plan |
|------|------|
| scanning in a basement with no signal | outbox on the phone, "not synced yet" badge with the count |
| permissions changed while offline | rejected movements listed with the reason, user hands them to a manager |
| phone lost with offline data | sessions list, "log out everywhere", the server refuses its token, local data is encrypted at rest by the OS |
| two phones offline count the same shelf | both counts land in the same count session, lines add up, the reviewer sees both counters |

## platform

| case | plan |
|------|------|
| server disk dies | litestream continuous backup to object storage, nightly snapshots, monthly restore test |
| object storage free tier runs out | images resized on device, thumbnails, orphan cleanup, storage interface so the provider can change |
| the shared sending reputation gets hurt by one org | per org send limits, complaints and bounces watched, an org with a bad rate gets paused |
| an org stops paying (if sold later) | read only mode, nothing deleted for 90 days, export available |
| the demo on github pages is mistaken for the real thing | banner "demo with made up data", no real login or data |
