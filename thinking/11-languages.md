# 11. languages

English, Greek and Russian from the first screen. Not a later "we'll translate it" job.

**decided:**

- three languages at launch: `en`, `el`, `ru`.
- no hardcoded text anywhere. not in the app, not in the web, not in emails, not in push.
- every person (user, customer, invite) carries their own `locale`. the server always speaks to
  someone in their language, not in the shop's language.
- English for the UI follows European conventions: day before month, 24 hour clock, euro.

## which language you get

| where | order |
|-------|-------|
| app | your choice in the app, then the phone language if it is one of the three, then the org default, then `en` |
| join page and other web pages | `?lang=` in the link, then the browser `Accept-Language`, then the org default, then `en`. a switcher on every page |
| emails, push, SMS | the recipient's `locale`. then the org default, then `en` |
| invites | the language the inviter picked for the invitee (default: the org language) |

A Russian speaking customer of a Greek shop gets Russian. The Greek manager still sees Greek.

## one source of messages

**decided (changed when building):** one set of message files in the i18next JSON format,
used by the app, the web and the server. Plurals use key suffixes resolved with `Intl.PluralRules`,
which gives the same result as ICU plurals without a parser on the phone.

```
packages/i18n/src/locales/
  en/  el/  ru/
    common.json   shared words: roles, permissions, stock states, units, error codes
    server.json   push, email and join page texts built on the server
    web.json      the next.js app
    mobile.json   the phone app
```

- one namespace per app, so the web and the phone app never edit the same file.
- keys are grouped by feature: `stock.adjust.title`, `posts.audience.summary`, `email.invite.subject`.
- `pnpm check` lists keys that exist in English but are missing in Greek or Russian.
- if we ever go to Flutter (see [08](08-platform-choice.md)), a small script turns these files into ARB.

### plurals

English and Greek have two plural forms. Russian has four.

```json
"items_one": "{{count}} product",   "items_other": "{{count}} products"
"items_one": "{{count}} προϊόν",    "items_other": "{{count}} προϊόντα"
"items_one": "{{count}} товар",     "items_few": "{{count}} товара",
"items_many": "{{count}} товаров",  "items_other": "{{count}} товара"
```

| count | en | el | ru |
|-------|----|----|----|
| 1 | 1 product | 1 προϊόν | 1 товар |
| 3 | 3 products | 3 προϊόντα | 3 товара |
| 5 | 5 products | 5 προϊόντα | 5 товаров |
| 21 | 21 products | 21 προϊόντα | 21 товар |
| 1,5 | | | 1,5 товара |

Russian 21 is "one", 22 is "few", 25 is "many". Nobody gets that right with `if (n == 1)`.

### rules for writing strings

- **no string concatenation.** never `"Sold " + qty + " " + name`. always one message with
  placeholders, so each language can put the words in its own order.
- **avoid gendered sentences about people.** Russian past tense changes with gender ("Мария
  добавила", "Иван добавил") and we do not collect gender. write activity lines as
  "Мария: приёмка, 12 шт." or "Добавлено: Мария". Greek participles have the same problem.
- **units are words too.** pieces: `pcs`, `τεμ.`, `шт.`. kilos: `kg`, `κιλά`, `кг`.
- **sentence case for buttons and titles.** no ALL CAPS (see the Greek section).
- every key in `en.json` has a short description of where it shows and what the placeholders are.

## formatting

All through `Intl`, never by hand. Hermes (the React Native engine) has `Intl` built in. if a
piece like `PluralRules` is missing on some Android version, the FormatJS polyfills fill the gap.

| thing | en | el | ru |
|-------|----|----|----|
| money 1234.5 EUR | €1,234.50 | 1.234,50 € | 1 234,50 € |
| decimal | 0.25 kg | 0,25 κιλά | 0,25 кг |
| date | 17 Nov 2026 | 17 Νοε 2026 | 17 нояб. 2026 г. |
| time | 14:05 | 14:05 | 14:05 |
| relative | 2 hours ago | πριν από 2 ώρες | 2 часа назад |

- Greek and Russian use a decimal comma. Russian groups thousands with a non breaking space.
- money is always the **org currency**, formatted in the **viewer's** language.
- dates and "today" are always in the **shop timezone**, not the phone's. a report for a Cyprus
  shop looked at from Athens still uses Cyprus days.
- number input accepts both `0,25` and `0.25` for people who type the "wrong" one.

## fonts

**decided:**

- **body and controls:** the system font. SF Pro on iOS, Roboto on Android, the system UI stack on
  web. all three cover Latin, Greek and Cyrillic well and follow the user's text size setting.
- **display moments** (big titles, the stock numbers, the brand): **Commissioner**, a variable
  sans by Greek type designer Kostas Bartsokas, with Latin, Greek and Cyrillic in one family.
  see [10](10-design.md).
- fonts are **bundled** in the app and **self hosted** on the web. never fetched from Google Fonts
  at runtime: it breaks offline use, and loading Google Fonts from Google's servers sends the
  visitor's IP to Google, which a German court already found to be a GDPR problem.
- before picking any other font: check it has all three scripts, including Greek accents
  (ά, ΐ, ΰ) and Russian ё.

### Greek and capitals

Greek capitals drop the accents: "Καφές" in capitals is "ΚΑΦΕΣ", not "ΚΑΦΈΣ". JavaScript
`toUpperCase()` keeps the accent, which looks wrong to every Greek reader. CSS
`text-transform: uppercase` gets it right only when the element has `lang="el"`, and native text
on phones is not reliable either.

**decided:** no ALL CAPS styling anywhere. labels, buttons, tabs and badges use sentence case.
if a design ever needs capitals, the text is written in capitals in the message file itself.

### longer text

Greek and Russian are often 15 to 30 percent longer than English. "Stock" is "Απόθεμα" and
"Остатки". "Receive" is "Παραλαβή" and "Приёмка".

- no fixed width buttons or labels. everything wraps or grows.
- tab labels are single short words, checked in all three languages.
- a **pseudo language** for testing: every English string made 30 percent longer with accented
  letters (`[Ŝţöçķ ŕéçéîṽéð ·····]`). anything that truncates or shows plain English is a bug.
- none of the three is right to left, but layouts use start and end instead of left and right
  from day one. adding Arabic or Hebrew later should not mean a rewrite.

## search across three alphabets

This is where most apps fail Greek users.

### the sqlite gotcha

SQLite `lower()`, `upper()` and `LIKE` only fold case for ASCII. `LIKE '%καφ%'` will not match
"Καφές", and `lower('ΚΑΦΈΣ')` returns it unchanged. So we never ask sqlite to understand Greek or
Russian.

### search_key

**decided:** products and customers have a `search_key` column, computed in our code (one shared
function in `packages/core`) every time the name changes:

1. Unicode NFD, then remove combining marks. this strips Greek tonos and dialytika (ά to α,
   ϊ to ι, ΐ to ι), Latin accents, and turns Russian ё into е (й becomes и too, fine for search).
2. lowercase.
3. Greek final sigma ς becomes σ.
4. remove punctuation, collapse spaces.
5. append a **Latin transliteration**:
   - Greek to "greeklish" in a canonical form: θ to th, χ to ch, ψ to ps, ξ to ks, β to v,
     and vowels that sound the same merged (η, ι, υ, ει, οι to i; ω to o; αι to e; ου to u).
   - Russian to Latin: ж zh, х kh, ц ts, ч ch, ш sh, щ shch, ы y, ю yu, я ya.

The search box runs the same function on what the user typed, including turning common
greeklish habits into the canonical form (`8` to th, `3` to ks, `w` to o, `x` to ch, `y` to i,
and `h` to i when it stands alone for η, not inside th or ch). Greek capitals that look like
Latin ones (Α, Β, Ε, Η, Ι, Κ, Μ, Ν, Ο, Ρ, Τ, Χ) are treated as the same letter, because people
switch keyboards in the middle of a word.

| typed | finds |
|-------|-------|
| `καφε` | Καφές Ελληνικός |
| `kafes` | Καφές Ελληνικός |
| `8ymari` | Θυμαρίσιο μέλι |
| `мед` | Мёд тимьяновый |
| `moloko` | Молоко |
| `MAΣTIXA` (Greek and Latin letters mixed, a classic) | Μαστίχα Χίου |

The key goes into an FTS5 index (trigram tokenizer for "contains" search), so sqlite only ever
matches plain lowercase ASCII and plain Greek and Cyrillic letters we already cleaned.

### sorting

- lists sorted in the app with `Intl.Collator` in the viewer's language.
- the server sorts by `search_key` when it has to paginate, so pages stay stable.

## user content

| content | how |
|---------|-----|
| posts | **decided:** a post has a default language and optional translations. the composer has EN, EL, RU tabs. the default one is required. each customer gets their language, or the default if it is missing. see [06](06-customers-and-comms.md) |
| product names | phase 1: one name in the org default language. phase 2: `product_translations`, shown to customers in their language when present |
| categories, tags | org language only. they are short and owners name them how they like |
| customer names | any alphabet, stored as typed. never forced into Latin |
| shop names, addresses | as typed |

## server side texts

Everything the server sends has messages in all three languages, from the same JSON:

- verification codes, magic links, password reset, email change
- invites
- double opt in, welcome, unsubscribe confirmation
- back in stock alerts, low stock alerts for managers
- weekly summary email
- push titles and bodies
- join pages, product pages, unsubscribe and preference pages
- CSV headers and PDF report titles

Email templates are written once and filled per language. the subject line is a message key too.

## consent texts

- the consent wording on the join page is a **legal text**, written per language and versioned:
  `el-2026-11`, `ru-2026-11`, `en-2026-11`.
- the consent row stores which version the person saw (see [04](04-data-model.md)).
- changing the wording means a new version. old consents still point to what people actually agreed to.
- privacy policy, terms and consent texts are translated by a person, not by a machine, and
  checked by someone who reads the language natively.

## files

- **CSV export:** UTF-8 **with BOM**, otherwise Excel shows Greek and Cyrillic as garbage.
  delimiter `;` for `el` and `ru` users (their Excel uses the comma for decimals and expects
  semicolons), `,` for `en`. two flavours: "for Excel" (localised numbers and dates) and "raw"
  (dot decimals, ISO dates) for importing elsewhere.
- **CSV import:** detect BOM, detect delimiter, accept both decimal styles, show a preview before importing.
- **PDF:** the default PDF fonts have no Greek or Cyrillic, letters come out as empty boxes.
  every PDF (labels, reports, QR posters) embeds a subset of our fonts.

## phone numbers

- input with a country picker, default from the org country (+30). pinned at the top: +30,
  +357, +7, +380, +359, +40, +44, +49.
- validated and formatted with libphonenumber, stored as E.164.
- shown formatted for the viewer, masked without `customers.contact.view`.

## translation workflow

**decided:**

1. new text starts in the English file of its namespace.
2. a first Greek and Russian draft may be machine made, marked `needs_review`.
3. a native speaker reviews every Greek and Russian string before a release. reviewed keys are
   marked as such. nothing ships with `needs_review` on screens customers see.
4. a local script, `pnpm check`, run by hand before every build: missing keys and extra keys per
   language. placeholder and `needs_review` checks get added to the same script.
   no CI, no pipeline, just a script.
5. screenshots of key screens in all three languages for the reviewer. the demo helps here.

Open question: who reviews Greek (me?) and who reviews Russian. see [18](18-open-questions.md).
