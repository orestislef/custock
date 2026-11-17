# 16. ideas

Good to have later. None of this is in the first version. Each one says what it is, why it is
worth it, and roughly when. Phases match [17-roadmap](17-roadmap.md).

## closing the loop between posts and sales

| idea | what and why | phase |
|------|--------------|-------|
| **coupons with QR redemption** | an offer post carries a coupon. the customer shows a QR from the app, staff scans it, it is redeemed once per customer. this is the first real attribution: we know this sale came from that post | 5 |
| **loyalty stamps or points** | a customer QR card in the app. staff scans it at the counter, a stamp or points are added. "10th coffee free" is something every small shop understands | 5 |
| **apple wallet and google wallet card** | the loyalty card as a wallet pass, so customers without the app still carry it. the pass can update with points | 5+ |
| **birthday offers** | customers can give a birthday (month and day only). a small offer goes out that week, in their language | 5 |
| **automations** | welcome message right after joining, a "we miss you" after 60 days without a visit (needs loyalty or coupon scans to know). set once, runs alone | 5+ |
| **price drop alerts** | like notify me, but for price. "tell me when this is cheaper". uses `price_history` | 5 |
| **events with RSVP** | tasting night, new collection launch. customers tap "I am coming", the shop sees a count | 5+ |
| **reviews after a visit** | a short "how was it" a day after a coupon or loyalty scan. private feedback to the shop, not public stars | later |

## stock and buying

| idea | what and why | phase |
|------|--------------|-------|
| **suppliers and purchase orders** | supplier list, products per supplier, a purchase order that turns into a receipt when goods arrive. less typing on receive | 5+ |
| **reorder suggestions** | below reorder point plus average daily sales and supplier lead time gives "order 24 of these". uses the rollups we already have | 5 |
| **batches and expiry (FEFO)** | for food, cosmetics, pharmacy. scan the GS1 code, keep batch and expiry, sell first what expires first, alert before expiry | later |
| **serial numbers** | for electronics. one serial per unit, traceable from receive to sale | later |
| **bundles and kits** | a gift box made of three products. selling the box takes stock from each part | later |
| **weighing scale barcodes** | read price or weight from in-store `2x` barcodes printed by deli scales | later |
| **click and reserve** | a customer reserves an item for pickup. stock shows a reserved quantity so nobody sells it in the meantime | later |
| **prefill unknown barcodes** | when an unknown EAN is scanned, look it up in Open Food Facts (food, free, ODbL licence) and similar public GTIN sources, prefill name, brand and photo. saves minutes per product on day one | 4 |
| **CSV import from excel** | most shops have their stock in a spreadsheet already. map columns once, import products and quantities | 4 |

## selling and reach

| idea | what and why | phase |
|------|--------------|-------|
| **POS integrations** | read sales from the shop's register so stock goes down without scanning twice. fiscal receipts and myDATA stay with the POS, always | later |
| **public catalog page** | a shop page on the web with products and "in stock near you" per shop, when the merchant allows it. good for search engines too | 5 |
| **viber business messages and SMS** | viber is big in greece and with russian speaking customers. both cost money per message, so later and per org opt in | later |
| **multi-currency** | one org with shops in different currencies. not needed while everything is EUR | later |
| **white label per org** | a bigger customer gets the customer app under their own name and icon. same code, a brand pack at build time | later |

## in the shop

| idea | what and why | phase |
|------|--------------|-------|
| **bluetooth label printers** | print price labels straight from the phone instead of an a4 pdf. zebra and brother are the usual ones | 5 |
| **shop tablet kiosk mode** | one shared tablet at the counter, staff switch with a short PIN instead of full login. logged per person | 5 |
| **home screen quick actions** | long press the app icon: scan, receive, count. one tap less for the most common jobs | 4 |
| **widgets and live activities** | "low stock today" widget for managers, a live activity showing stock count progress while a count is open | 5+ |
