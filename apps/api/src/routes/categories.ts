// categories of a business: create, rename and delete. names in the business language live in
// categories.name, the other languages in category_translations. a deleted category is archived
// and its products are left without one, nothing else changes.

import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { uuidv7, type Category, normalize } from '@custock/core';
import type { AppEnv } from '../types';
import { audit } from '../lib/audit';
import { categoryNameSql, need, nowOf, orgOf, readerLocale } from '../lib/context';
import { ApiProblem, notFound } from '../lib/problem';
import type { Tenant } from '../lib/tenant';

const Name = z.string().trim().min(1).max(80);
const Translations = z.object({ en: Name.nullable().optional(), el: Name.nullable().optional(), ru: Name.nullable().optional() }).partial();

const CategoryInput = z.object({ name: Name, translations: Translations.optional() });
const CategoryPatch = z.object({ name: Name.optional(), translations: Translations.optional() });

type Row = { id: string; parent_id: string | null; name: string };

function view(c: Context<AppEnv>, t: Tenant, id: string): Category & { names: Record<string, string> } {
  const row = t.get<Row>(
    `SELECT c.id, c.parent_id, ${categoryNameSql('c')} AS name FROM categories c WHERE c.org_id = @org AND c.id = @id AND c.archived_at IS NULL`,
    { id, loc: readerLocale(c, orgOf(c).org.default_locale) },
  );
  if (!row) throw notFound('category');
  const base = t.get<{ name: string }>('SELECT name FROM categories WHERE org_id = @org AND id = @id', { id })!;
  const names: Record<string, string> = { [orgOf(c).org.default_locale]: base.name };
  for (const tr of t.all<{ locale: string; name: string }>(
    'SELECT tr.locale, tr.name FROM category_translations tr JOIN categories c ON c.id = tr.category_id WHERE c.org_id = @org AND tr.category_id = @id',
    { id },
  )) names[tr.locale] = tr.name;
  return { id: row.id, parentId: row.parent_id, name: row.name, names };
}

// the same name twice in one business is confusing in every picker. compared after the shared
// search normalisation (case, greek accents and final sigma, yo), which sqlite lower() cannot do
function taken(t: Tenant, name: string, except?: string): boolean {
  const want = normalize(name);
  const rows = t.all<{ name: string }>(
    `SELECT c.name FROM categories c WHERE c.org_id = @org AND c.archived_at IS NULL AND (@except IS NULL OR c.id <> @except)
     UNION ALL
     SELECT tr.name FROM category_translations tr JOIN categories c ON c.id = tr.category_id
      WHERE c.org_id = @org AND c.archived_at IS NULL AND (@except IS NULL OR c.id <> @except)`,
    { except: except ?? null },
  );
  return rows.some((r) => normalize(r.name) === want);
}

function writeTranslations(t: Tenant, id: string, defaultLocale: string, translations: z.infer<typeof Translations> | undefined) {
  if (!translations) return;
  for (const locale of ['en', 'el', 'ru'] as const) {
    if (!(locale in translations) || locale === defaultLocale) continue;
    const name = translations[locale];
    if (name) {
      // the translations table has no org column: the category must be this business's
      t.run(
        `INSERT INTO category_translations (category_id, locale, name)
           SELECT c.id, @l, @n FROM categories c WHERE c.org_id = @org AND c.id = @id
           ON CONFLICT (category_id, locale) DO UPDATE SET name = excluded.name`,
        { id, l: locale, n: name },
      );
    } else {
      t.run('DELETE FROM category_translations WHERE locale = @l AND category_id IN (SELECT id FROM categories WHERE org_id = @org AND id = @id)', { id, l: locale });
    }
  }
}

export function categoryRoutes(app: Hono<AppEnv>) {
  app.post('/v1/orgs/:org/categories', async (c) => {
    need(c, 'categories.manage');
    const input = CategoryInput.parse(await c.req.json());
    const { t, org } = orgOf(c);
    if (taken(t, input.name)) throw new ApiProblem(409, 'conflict', 'a category with this name exists');
    const now = nowOf(c);
    const id = uuidv7(now);
    const sort = (t.get<{ n: number }>('SELECT coalesce(max(sort), 0) + 1 AS n FROM categories WHERE org_id = @org')?.n ?? 1);
    t.run('INSERT INTO categories (id, org_id, parent_id, name, sort) VALUES (@id, @org, NULL, @n, @s)', { id, n: input.name, s: sort });
    writeTranslations(t, id, org.default_locale, input.translations);
    const after = view(c, t, id);
    audit(t, { id: c.get('user').id }, 'category.created', { type: 'category', id }, null, { name: after.names }, now);
    return c.json(after, 201);
  });

  app.patch('/v1/orgs/:org/categories/:id', async (c) => {
    need(c, 'categories.manage');
    const patch = CategoryPatch.parse(await c.req.json());
    const { t, org } = orgOf(c);
    const before = view(c, t, c.req.param('id'));
    if (patch.name !== undefined) {
      if (taken(t, patch.name, before.id)) throw new ApiProblem(409, 'conflict', 'a category with this name exists');
      t.run('UPDATE categories SET name = @n WHERE org_id = @org AND id = @id', { n: patch.name, id: before.id });
    }
    writeTranslations(t, before.id, org.default_locale, patch.translations);
    const after = view(c, t, before.id);
    audit(t, { id: c.get('user').id }, 'category.updated', { type: 'category', id: before.id }, { name: before.names }, { name: after.names }, nowOf(c));
    return c.json(after);
  });

  app.delete('/v1/orgs/:org/categories/:id', (c) => {
    need(c, 'categories.manage');
    const { t } = orgOf(c);
    const before = view(c, t, c.req.param('id'));
    const now = nowOf(c);
    const moved = t.run('UPDATE products SET category_id = NULL, updated_at = @now WHERE org_id = @org AND category_id = @id', { id: before.id, now }).changes;
    t.run('UPDATE categories SET parent_id = NULL WHERE org_id = @org AND parent_id = @id', { id: before.id });
    t.run('DELETE FROM customer_interests WHERE org_id = @org AND category_id = @id', { id: before.id });
    t.run('UPDATE categories SET archived_at = @now WHERE org_id = @org AND id = @id', { id: before.id, now });
    audit(t, { id: c.get('user').id }, 'category.deleted', { type: 'category', id: before.id }, { name: before.names, products: moved }, null, now);
    return c.body(null, 204);
  });
}
