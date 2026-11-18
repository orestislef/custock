// a local database with a big, busy business for trying the web app at size: the Lemoni sample,
// plus 2,000 products, 200,000 movements, 20,000 customers, 600 posts and 5,000 audit rows, a super
// admin and 300 more small businesses. never for a server.
// run: pnpm --filter @custock/api big-db <file>   (logins: owner.<id>@example.com / custock)

import { rmSync } from 'node:fs';
import { hashPassword, migrate, openDb, seed, seedBig } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createBusiness } from '../src/services/bootstrap';

const file = process.argv[2];
if (!file) throw new Error('usage: big-db <file>');
for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });

const db = openDb(file);
migrate(db);
const pw = hashPassword('custock');
seed(db, { passwordHash: pw });
const now = Date.now();
const big = seedBig(db, { passwordHash: pw, now });

db.transaction(() => {
  const insPost = db.prepare(`INSERT INTO posts (id, org_id, kind, status, default_locale, channels, audience, author_id, sent_at, recipients_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'el', '["feed","push"]', ?, ?, ?, ?, ?, ?)`);
  const insTr = db.prepare('INSERT INTO post_translations (post_id, locale, title, body) VALUES (?, ?, ?, ?)');
  const kinds = ['news', 'offer', 'new_arrival', 'event'];
  const audience = JSON.stringify({ scopes: [{ scopeType: 'org', scopeId: big.orgId }] });
  for (let i = 0; i < 600; i++) {
    const at = now - i * 3_600_000;
    const id = uuidv7(at);
    const status = i % 9 === 0 ? 'draft' : i % 13 === 0 ? 'scheduled' : 'sent';
    insPost.run(id, big.orgId, kinds[i % kinds.length], status, audience, big.ownerId, status === 'sent' ? at : null, status === 'sent' ? 1200 + i : null, at, at);
    insTr.run(id, 'el', `Ανακοίνωση νούμερο ${i}: πολύ μεγάλος τίτλος για να δούμε πώς κόβεται σε κάρτες και λίστες`, `Κείμενο ${i}. `.repeat(40));
  }
  const insAudit = db.prepare(`INSERT INTO audit_log (id, org_id, actor_id, actor_kind, action, entity_type, entity_id, after_json, created_at)
    VALUES (?, ?, ?, 'member', ?, 'product', ?, '{}', ?)`);
  const actions = ['product.updated', 'product.price_changed', 'role.assigned', 'post.published', 'customer.added'];
  for (let i = 0; i < 5000; i++) {
    const at = now - i * 600_000;
    insAudit.run(uuidv7(at), big.orgId, big.ownerId, actions[i % actions.length], big.productIds[i % big.productIds.length], at);
  }
})();

for (let i = 0; i < 300; i++) {
  createBusiness(db, { name: `Small shop ${i}`, slug: `small-${i}`, ownerEmail: `owner${i}@small.example.com`, ownerName: `Owner ${i}`, passwordHash: pw, shopName: 'Main', webUrl: 'http://localhost:3000' });
}
db.prepare("INSERT INTO users (id, email, display_name, password_hash, email_verified_at, locale, created_at, updated_at, platform_role) VALUES (@id, 'super@big.example.com', 'Super', @pw, @n, 'en', @n, @n, 'superadmin')")
  .run({ id: uuidv7(now), pw, n: now });
db.pragma('optimize');
db.close();
console.log(JSON.stringify({ file, orgId: big.orgId, owner: `owner.${big.orgId.slice(-6)}@example.com`, manager: `manager.${big.orgId.slice(-6)}@example.com`, superadmin: 'super@big.example.com' }));
