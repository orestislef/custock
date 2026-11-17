# @custock/db

Migrations, seed data and database helpers for SQLite.

- `migrations/0001_init.sql` is `thinking/db/schema.sql` plus a few additions: `users.password_hash`
  and `email_verified_at`, `shops.image_file_id`, the `shop` file purpose, and the tables for the dev
  login provider (`sessions`, `otp_codes`), double opt in (`join_confirmations`) and `dev_outbox`.
- `openDb(path)` turns on WAL, foreign keys, a 5 second busy timeout and `synchronous = NORMAL`.
- `migrate(db)` runs every `.sql` file once, in order, and records it in `schema_migrations`.
  Forward only. A new change is a new file.
- `seed(db)` builds the made up Lemoni business: 3 shops, a group, 14 products (17 variants) with
  greek, english and russian names, 60 days of stock movements, 40 customers, posts, join links and
  the team. Photos come from `demo/assets/js/images.js`.
- `orm(db)` gives a drizzle instance over `src/schema.ts` for typed queries.

```
pnpm --filter @custock/db reset    # recreate apps/api/data/custock.db
pnpm --filter @custock/db test
```

Every dev password is `custock`. The stock ledger is append only: triggers refuse `UPDATE` and
`DELETE` on `stock_movements`.
