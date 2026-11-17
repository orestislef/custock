# 08. platform choice

What we write custock in. I know Flutter, so Flutter was the starting point. This file is the
honest comparison and the pick.

## what the product actually needs

Before picking tools, the list of things that are hard here:

1. **a phone app that feels native and polished.** smooth transitions, real platform tab bars and
   sheets, haptics, the new iOS look (liquid glass) without faking it.
2. **continuous barcode scanning** that is fast and does not drain the battery.
3. **offline** stock work with a local database and an outbox.
4. **push notifications** that deep link everywhere.
5. **web pages that open in a second from a QR code**: join page, shelf product page, public
   catalog, manage subscription. no app install. these must be real web pages, small, server
   rendered, indexable.
6. **an admin dashboard on the web**: bulk product editing, reports with charts, team and roles.
   wide screens, keyboard, tables.
7. **three languages everywhere**: app, web pages, emails, push texts, all from one source.
8. **one set of rules everywhere**: permissions, validation, money and quantity math, search
   normalisation. the app, the web and the server must agree, or we get holes.
9. **a small team** (me plus a few people) that can grow, and no ci/cd.

## the options

| | Flutter everywhere | Flutter app + React web | TypeScript everywhere (Expo + Next.js) | native Swift + Kotlin + web |
|---|---|---|---|---|
| native look on iOS | drawn by flutter, imitates cupertino. liquid glass only via packages | same | **real native tab bars, sheets, menus**. liquid glass comes from the system | best |
| animations | excellent (impeller) | excellent on phone | excellent (reanimated 4, skia) | excellent |
| scanning | mobile_scanner, good | same | vision-camera code scanner, very good | best |
| offline db | drift, very good | same | expo-sqlite + drizzle, good | good |
| public web pages | flutter web is heavy (canvas, slow first load, no SEO). needs a second stack anyway | React | **Next.js, same language** | needs a web stack |
| admin dashboard | flutter web works but does not feel like the web | React | **React, same language** | web stack |
| shared code with server | only if the server is dart | via codegen | **direct imports**: permissions, zod schemas, i18n, money math | via codegen |
| translations | ARB in app, something else on web and server | two formats | **one JSON source for app, web, server** | three formats |
| my current skill | high | high for app, learning React | learning React Native and React | low |
| hiring / team help | smaller pool | mixed | **largest pool** | two specialists |
| codebases | 1 (+ web pages anyway) | 2 languages | 1 language, 3 apps sharing packages | 3 |

## the pick

**decided (pending review): TypeScript everywhere.**

- **phone app:** Expo (React Native, new architecture). expo-router with native tabs, Reanimated 4,
  gesture handler, react-native-vision-camera for scanning, expo-haptics, expo-sqlite + Drizzle for
  offline, FCM for push, expo-secure-store, i18next.
- **web:** Next.js. customer pages (join, product, catalog, offers, unsubscribe) server rendered and
  tiny, plus the admin dashboard in the same app.
- **server:** Node + Hono, Drizzle ORM on SQLite, zod. runs on my server next to the login, FCM and
  mail services.
- **one pnpm monorepo** with shared packages: `core` (permissions, schemas, money, quantities,
  search normalisation), `i18n` (all strings in en, el, ru), `tokens` (colors, type, spacing for web
  and phone).

Why, in one line each:

- the web part is not optional. the QR join page and the admin dashboard are half the product,
  and they need real web tech. once React is in the project for the web, using React Native for
  the phone means **one language, one way of thinking, shared code**.
- **native components** make the "feels like Apple made it" goal reachable without faking iOS. the
  tab bar, sheets, context menus and the iOS 26 glass come from the system, and android gets its own
  material look for free.
- **one source of truth** for permissions and translations, imported directly by app, web and
  server. no codegen between languages, no drift.
- a bigger pool of people who can help.

What it costs:

- learning React Native and the React way. my Flutter experience helps with the concepts (widgets
  vs components, state, navigation), not the syntax.
- React Native upgrades need care. Expo smooths most of it.
- native modules (camera) need a development build, not Expo Go. fine.
- iOS builds need a mac in any stack.

## when I would pick Flutter instead

- if the team that builds this is Flutter only and nobody wants to touch React.
- if the web part shrinks to just the join page (then a small server rendered page is enough and
  the admin lives in the app).

In that case: Flutter app (riverpod, go_router, drift, mobile_scanner, firebase_messaging,
gen-l10n with ARB) + a tiny server rendered join/product site + the admin in Flutter web or React.
The thinking in every other file still holds. Only [13-stack](13-stack.md) and the package names
change.

## no ci/cd

Same rule in any stack: no github actions, no pipelines. local scripts for lint, tests, the
missing translations check and builds. deploys by hand over ssh. see [13](13-stack.md).
