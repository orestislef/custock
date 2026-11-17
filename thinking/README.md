# thinking

Everything about how Custock should work, before any code. Read in order, each file builds on the one before.

| # | file | what is in it |
|---|------|---------------|
| 01 | [vision](01-vision.md) | what custock is, who it is for, goals and non goals |
| 02 | [tenancy and roles](02-tenancy-and-roles.md) | organizations, shop groups, shops, scopes, how delegation works |
| 03 | [permissions](03-permissions.md) | every permission key, default roles, the role matrix |
| 04 | [data model](04-data-model.md) | entities, relations, diagram, conventions. Draft sql in [db/schema.sql](db/schema.sql) |
| 05 | [inventory](05-inventory.md) | catalog, stock ledger, scanning, counts, transfers, alerts |
| 06 | [customers and comms](06-customers-and-comms.md) | join flow, subscriptions, consent, posts, push, email |
| 07 | [auth](07-auth.md) | login, invites, tokens, devices, account switching |
| 08 | [app per role](08-app-per-role.md) | navigation, screens, what each role sees and can do |
| 09 | [languages](09-languages.md) | english, greek, russian. translations, formats, search |
| 10 | [reports and analytics](10-reports-and-analytics.md) | dashboards, reports, exports, app analytics |
| 11 | [stack](11-stack.md) | flutter packages, server, database, storage, push, mail, builds |
| 12 | [api sketch](12-api-sketch.md) | endpoints, errors, sync, conventions |
| 13 | [edge cases](13-edge-cases.md) | the stuff that breaks things, and what we do about it |
| 14 | [ideas](14-ideas.md) | good to have later |
| 15 | [roadmap](15-roadmap.md) | phases, what the first usable version is |
| 16 | [open questions](16-open-questions.md) | things i still need to decide, and what we assume until then |

## how to read these

Things written as **decided** are the plan unless changed on review. Things written as
**option** are choices still open, the leaning is written next to them. Anything that needs
an answer from me ends up in [16-open-questions](16-open-questions.md).

Nothing here is final. These files change as the review goes, and the git history keeps the
older versions.
