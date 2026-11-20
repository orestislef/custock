# thinking

Everything about how Custock should work, before any code. Read in order, each file builds on the
one before. The clickable demo is at [orestislef.github.io/custock/demo](https://orestislef.github.io/custock/demo/).

| # | file | what is in it |
|---|------|---------------|
| 01 | [vision](01-vision.md) | what custock is, who it is for, goals and non goals |
| 02 | [tenancy and roles](02-tenancy-and-roles.md) | organizations, shop groups, shops, scopes, how delegation works |
| 03 | [permissions](03-permissions.md) | every permission key, default roles, the role matrix |
| 04 | [data model](04-data-model.md) | entities, relations, diagram, conventions. draft sql in [db/schema.sql](db/schema.sql) |
| 05 | [inventory](05-inventory.md) | catalog, stock ledger, scanning, counts, transfers, alerts |
| 06 | [customers and comms](06-customers-and-comms.md) | join flow, consent, what customers see, posts, offers, push, email |
| 07 | [auth](07-auth.md) | login, invites, tokens, devices, account switching |
| 08 | [platform choice](08-platform-choice.md) | flutter or typescript, and why typescript |
| 09 | [app per role](09-app-per-role.md) | tabs, screens, what each role sees and can do |
| 10 | [design](10-design.md) | color, type, motion, the tally, explanatory ui |
| 11 | [languages](11-languages.md) | english, greek, russian. translations, formats, search |
| 12 | [reports and analytics](12-reports-and-analytics.md) | dashboards, reports, exports, app analytics |
| 13 | [stack](13-stack.md) | packages, server, database, storage, push, mail, manual builds |
| 14 | [api sketch](14-api-sketch.md) | endpoints, errors, sync, conventions |
| 15 | [edge cases](15-edge-cases.md) | the stuff that breaks things, and what we do about it |
| 16 | [ideas](16-ideas.md) | good to have later |
| 17 | [roadmap](17-roadmap.md) | phases, what the first usable version is |
| 18 | [open questions](18-open-questions.md) | things i still need to decide, and what we assume until then |
| 19 | [orders](19-orders.md) | customers order or ask for a price, the shop answers, pick up and pay at the shop |

## how to read these

Things written as **decided** are the plan unless changed on review. Things written as
**option** are choices still open, the leaning is written next to them. Anything that needs
an answer from me ends up in [18-open-questions](18-open-questions.md).

Nothing here is final. These files change as the review goes, and the git history keeps the
older versions.
