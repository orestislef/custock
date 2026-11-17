# 10. design

How custock looks, moves and explains itself. Checked against Apple's Human Interface Guidelines
(the june 2026 versions), with our own point of view on top.

## the idea

Custock is two worlds meeting: **customers** (people, warm, human) and **stock** (goods, counts,
precise). The design keeps the platform's own navigation and controls, so it feels at home on an
iPhone and on Android, and puts its identity in three places only: one accent color, one display
typeface, and one signature moment.

What we avoid on purpose, because every generated app has them right now: warm cream backgrounds
with a serif and a terracotta accent, near black with one acid green, hairline broadsheet layouts,
decorative gradients, a giant number over a tiny label as a hero, 01 / 02 / 03 markers on things
that are not steps, emoji in the UI.

## color

### the accent: pomegranate

In Greece a pomegranate (ρόδι) is what you bring to a new home or a new shop, for luck and
abundance. The same fruit (гранат) is just as familiar to our Russian speaking customers. It is a
warm, human red that leans to magenta, it is not the usual SaaS blue or violet, and it is not
terracotta. It is the only brand color in the interface.

It is used for: primary buttons, the selected tab, links, the scan action, focus rings. Nothing
else. One color, one meaning (`color.md` best practices: "avoid using the same color to mean
different things").

### tokens

All contrast numbers are WCAG ratios computed from the hex values. Text up to 17 pt needs 4.5:1,
bigger or bold text 3:1 (`accessibility.md`, vision).

**light**

| token | hex | use | contrast |
|-------|-----|-----|----------|
| `shelf` | `#F3F3F0` | grouped background | |
| `surface` | `#FFFFFF` | cards, lists, sheets | |
| `ink` | `#16171B` | primary text | 17.9 on surface, 16.1 on shelf |
| `ink-2` | `#5E6068` | secondary text | 6.3 on surface, 5.6 on shelf |
| `line` | `#E3E3DE` | separators | |
| `accent` | `#B0234F` | pomegranate | 6.6 as text on surface, white on it 6.6 |

**dark**

| token | hex | use | contrast |
|-------|-----|-----|----------|
| `shelf` | `#0F0F12` | background | |
| `surface` | `#1A1A1F` | cards, lists | |
| `elevated` | `#232329` | sheets, popovers | |
| `ink` | `#F2F1EE` | primary text, a softened white | 15.4 on surface |
| `ink-2` | `#A3A3AD` | secondary text | 6.9 on surface, 7.7 on shelf |
| `line` | `#2E2E35` | separators | |
| `accent` | `#FF6B8E` | pomegranate, lifted for dark | 6.4 as text on surface. fills use `#C42A58` with white (5.5) |

### stock states

The normal state gets **no color**. Only exceptions are colored, and never by color alone: each
state has its own icon and word (`accessibility.md`: "convey information with more than color alone").

| state | light (text on tint) | dark (text on tint) | icon |
|-------|----------------------|---------------------|------|
| in stock | plain ink, no badge | plain ink | none |
| only a few left | `#7A4A00` on `#FFF1D6` (6.7) | `#F5C76B` on `#33270F` (9.2) | half filled circle |
| out of stock | `#55575E` on `#ECECE8` (6.1) | `#B4B4BC` on `#2A2A30` (6.9) | circle with a slash |
| negative (needs fixing) | `#A11B1B` on `#FDE7E7` (6.6) | `#FF7A70` on surface (6.8) | exclamation triangle |
| on the way | `#2F5BC8` on surface (6.1) | `#8AA8FF` on surface (7.5) | arrow into a box |

Success (received, sent, saved) uses `#1E7A44` / `#5BD08A` with a check. Errors use the negative
red with an icon and a sentence that says how to fix it.

Increase Contrast: every token gets a stronger variant (ink-2 moves toward ink, lines get darker,
tints get a 1 px border). Defined with the tokens, not later.

### charts

One categorical palette for every chart, starting with the accent and moving around the wheel,
checked for color blindness before we build: pomegranate `#B0234F`, ink blue `#2F5BC8`, honey
`#C98A1B`, olive `#5E7D3A`, sea `#1F8A8A`, plum `#7B4FA0`, slate `#6B7280`. Charts never rely on
color alone either: direct labels on lines, patterns or labels on bars.

### appearance

The app follows the system light or dark setting. **No in app appearance switch**
(`dark-mode.md`: "avoid offering an app-specific appearance setting"). The demo has one only
because it is a demo.

## type

| role | face | why |
|------|------|-----|
| controls, body, lists, navigation | the system font (SF Pro on iOS, Roboto on Android) | best legibility at small sizes, supports Dynamic Type, Greek and Cyrillic built in |
| display moments: big titles on home, product names on the product page, big stock numbers, onboarding, empty states | **Commissioner** | made by a Greek type designer, covers Latin, Greek and Cyrillic properly, variable weight, a little character without shouting |
| quantities and money | system font with tabular figures | numbers line up in lists and do not jump while they roll |

Rules (`typography.md`):

- body 17 pt, nothing under 11 pt. no light or thin weights for small text.
- everything scales with the system text size, up to the accessibility sizes. layouts stack instead
  of truncating at large sizes.
- the custom face only for display, never for body copy (`branding.md`: custom font for headlines,
  system font for body).
- no ALL CAPS styling: in Greek, uppercase drops the accents, and automatic uppercasing gets it
  wrong. see [11](11-languages.md).
- the font files ship inside the app, never fetched at runtime.

## layout and navigation

- **tab bar** at the bottom for top level sections, a few tabs, single word labels, filled icons.
  tabs navigate, they never act (`tab-bars.md`: "use a tab bar to support navigation, not to
  provide actions"). On iOS the native tab bar floats on liquid glass. On Android the material
  navigation bar.
- **scan** is the most used action for staff, so it sits as a prominent button in the tab bar's
  accessory position on iOS (search like trailing slot) and as a floating action on Android. it is
  an action, so it is styled as one, not as a tab.
- tabs are **stable for a role**. a role either has a section or not. inside a section, things you
  cannot do are explained, not silently missing (see explanatory UI).
- **sheets** for short tasks (adjust stock, invite someone, pick audience): grabber, medium and
  large detents, swipe down to close, always a cancel.
- controls 44 x 44 pt minimum, important actions in the lower half of the screen for one handed
  use, swipe actions on list rows (sell one, add one, call customer).
- glass and blur only on floating bars and sheets over content, never on content itself.
- tablet and web: the tab bar becomes a sidebar, lists become tables, detail opens beside the list.

## the signature: the tally

Shop people count stock with hand tally counters, the little metal clickers. That is our one
memorable element.

- **every stock number rolls** like a mechanical counter when it changes: digits turn, they do not
  just swap. short (about 250 ms), tabular figures so nothing shifts.
- **every scan clicks**: a short light haptic and a soft click sound, like a tally counter.
  sound follows the silent switch and can be turned off. haptic can be turned off.
- the scan button carries a tiny counter of items scanned in the current session.

Everything around it stays quiet. That is the point: the boldness is spent in one place
(apple-design craft lens: one signature element, everything around it quiet).

## motion

The rule from `motion.md`: purposeful, brief, cancellable, rare on frequent interactions.

| moment | what moves | why |
|--------|-----------|-----|
| navigation | system push and pop, system sheets | familiar, free, and follows accessibility settings |
| scan | the scanned item slides from the viewfinder into the list, number rolls | shows where it went |
| stock change anywhere | tally roll on the number | the signature |
| undo | the row slides back, number rolls back | shows the undo happened |
| **back in stock** | on receive, the "14 waiting" pill turns into "14 told" and small dots fly out | the one orchestrated moment. it is where stock meets customers, the whole idea of the product |
| post published | the audience count fills a ring as deliveries go out | progress you can believe |
| loading | skeleton rows in the real layout, never a spinner on an empty screen | `loading.md`: "show something as soon as possible" |

Reduce Motion on: rolls become fades, flying dots become a fade of the label, no parallax, no
zoom. Nothing important is ever carried by motion alone (`accessibility.md`, cognitive).

## explanatory UI

The user asked for an app that explains itself. Apple's version of that is: teach through use,
small tips near the thing, empty states that invite the next action (`onboarding.md`: "teach
through interactivity", "context-specific tips instead of a single onboarding flow").

- **first run** is doing, not reading. a new org scans its first product in the first minute. if
  there is no product at hand, a sample barcode is on screen to try the scanner on.
- **tips** appear next to the thing they explain, once, with a close button. examples: "swipe left
  on a row to sell one", "long press a number to see its history", "this QR is for customers, print
  it for your window".
- **empty states** say what goes here and give one button: "no customers yet. print your window QR,
  people join in 30 seconds." [print QR].
- **why not?** every locked thing explains itself in one line: "price is set by your admin",
  "you can give roles below manager", "costs are hidden for your role, ask Eleni". with who to ask
  when we know.
- **numbers explain themselves**: the post audience breakdown, the "14 people waiting" pill, the
  "lowest price in the last 30 days" note under offers, "stock changes during the day" for customers.
- **settings explain consequences**: next to "show exact stock to customers": "competitors can see
  this too".
- a **help** entry in profile replays tips and links to short how-to pages. never forced again
  after the first time.

## writing

- labels say what happens: "Receive 24 items", not "Submit". an action keeps its name: "Publish"
  ends in "Published".
- errors say what went wrong and what to do, no apology, no codes: "No signal. Your scans are saved
  and will sync when you are back online."
- the business's name in customer facing text, never ours. customers follow "Lemoni Kifisia", not
  "a Custock shop".
- names come from the shop world, not from the database: "stock count", not "inventory
  reconciliation session". "people waiting", not "stock alert subscriptions".

## push presentation

- title: the shop or business name. body: one sentence. image when the post has one.
- grouped per business on the lock screen.
- every push opens the exact thing it talks about.
- details on which pushes exist and when in [06](06-customers-and-comms.md#push-notifications).

## app icon

The mark is two shapes overlapping: a C for customer and an S for stock, the overlap in a deeper
pomegranate. A clean blend. Filled shapes, no text, light, dark and tinted variants built from the
same layers (`app-icons.md`). To be drawn.

## what is still open

- the exact Commissioner settings (weight, the flair axis) need trying on real screens.
- the chart palette needs a color blindness check before it is final.
- the icon needs drawing.
