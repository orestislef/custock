// a big made up business for speed checks: thousands of products, hundreds of thousands of
// movements, tens of thousands of customers. not for the demo, only for measuring.

import { DEFAULT_ROLES, contactKey, ean13, searchKey, uuidv7 } from '@custock/core';
import type { Db } from './open';

const DAY = 86_400_000;

export interface SynthOptions {
  products?: number;
  movements?: number;
  customers?: number;
  shops?: number;
  now?: number;
  passwordHash: string;
}

export interface SynthResult {
  orgId: string;
  ownerId: string;
  managerId: string;
  shops: string[];
  productIds: string[];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['ελαιόλαδο', 'μέλι', 'καφές', 'τσάι', 'σαπούνι', 'κούπα', 'τσάντα', 'αλάτι', 'λουκούμι', 'ταχίνι', 'φιστίκι', 'κερί', 'φέτα', 'ρίγανη', 'θυμάρι', 'σύκα', 'ελιές', 'κρασί', 'τυρί', 'ζυμαρικά'];
const ADJ = ['βιολογικό', 'παραδοσιακό', 'φρέσκο', 'χειροποίητο', 'κρητικό', 'μικρό', 'μεγάλο', 'ειδικό'];
const FIRST = ['Μαρία', 'Γιώργος', 'Ελένη', 'Νίκος', 'Κατερίνα', 'Δημήτρης', 'Σοφία', 'Κώστας', 'Анна', 'Иван', 'Ольга', 'Emma', 'James'];
const LAST = ['Παπαδάκη', 'Νικολάου', 'Κωνσταντίνου', 'Παππάς', 'Γεωργίου', 'Αλεξίου', 'Петрова', 'Смирнов', 'Clarke', 'Turner'];

export function seedBig(db: Db, opts: SynthOptions): SynthResult {
  const now = opts.now ?? Date.now();
  const r = rng(424242);
  const nProducts = opts.products ?? 2000;
  const nMovements = opts.movements ?? 200_000;
  const nCustomers = opts.customers ?? 20_000;
  const nShops = opts.shops ?? 5;
  const orgId = uuidv7(now - 400 * DAY);
  const prep = (sql: string) => db.prepare(sql);

  const result: SynthResult = { orgId, ownerId: '', managerId: '', shops: [], productIds: [] };

  db.transaction(() => {
    prep(`INSERT INTO organizations (id, name, slug, created_at, customer_stock, customer_catalog) VALUES (?, 'Megamarket', ?, ?, 'availability', 'subscribers')`).run(orgId, `mega-${orgId.slice(-6)}`, now - 400 * DAY);
    const insShop = prep('INSERT INTO shops (id, org_id, name, slug, created_at) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < nShops; i++) {
      const id = uuidv7(now - 399 * DAY);
      result.shops.push(id);
      insShop.run(id, orgId, `Shop ${i + 1}`, `shop-${i + 1}`, now - 399 * DAY);
    }
    const groupId = uuidv7(now);
    prep("INSERT INTO shop_groups (id, org_id, name, created_at) VALUES (?, ?, 'North', ?)").run(groupId, orgId, now);
    for (const s of result.shops.slice(0, 2)) prep('INSERT INTO shop_group_shops (org_id, group_id, shop_id, added_at) VALUES (?, ?, ?, ?)').run(orgId, groupId, s, now);

    // roles and two members: an owner and a manager of the first shop
    const roleIds: Record<string, string> = {};
    for (const t of DEFAULT_ROLES) {
      roleIds[t.key] = uuidv7(now);
      prep('INSERT INTO roles (id, org_id, template_key, name, rank, is_locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(roleIds[t.key], orgId, t.key, t.key, t.rank, t.locked ? 1 : 0, now, now);
      const insPerm = prep('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)');
      for (const p of t.permissions) insPerm.run(roleIds[t.key], p);
    }
    for (const [key, role, scopeType, scopeId] of [['owner', 'owner', 'org', orgId], ['manager', 'manager', 'shop', result.shops[0]!]] as const) {
      const uid = uuidv7(now);
      const mid = uuidv7(now);
      prep('INSERT INTO users (id, email, display_name, password_hash, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid, `${key}.${orgId.slice(-6)}@example.com`, key, opts.passwordHash, 'el', now, now);
      prep("INSERT INTO memberships (id, org_id, user_id, status, joined_at) VALUES (?, ?, ?, 'active', ?)").run(mid, orgId, uid, now);
      prep('INSERT INTO role_assignments (id, org_id, membership_id, role_id, scope_type, scope_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uuidv7(now), orgId, mid, roleIds[role], scopeType, scopeId, now);
      if (key === 'owner') result.ownerId = uid;
      else result.managerId = uid;
    }

    // products, one variant each, a barcode, levels and settings per shop
    const insProduct = prep('INSERT INTO products (id, org_id, name, search_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insVariant = prep('INSERT INTO product_variants (id, org_id, product_id, price_minor, cost_minor, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)');
    const insBarcode = prep("INSERT INTO barcodes (id, org_id, variant_id, code, code_norm, symbology, created_at) VALUES (?, ?, ?, ?, ?, 'ean13', ?)");
    const insSettings = prep('INSERT INTO shop_variant_settings (org_id, shop_id, variant_id, reorder_point, updated_at) VALUES (?, ?, ?, ?, ?)');
    const variants: { id: string; price: number; cost: number }[] = [];
    for (let i = 0; i < nProducts; i++) {
      const name = `${WORDS[i % WORDS.length]} ${ADJ[Math.floor(r() * ADJ.length)]} ${100 + (i % 900)}g`;
      const pid = uuidv7(now - 380 * DAY);
      const vid = uuidv7(now - 380 * DAY);
      const price = 200 + Math.floor(r() * 3000);
      const cost = Math.floor(price * 0.55);
      insProduct.run(pid, orgId, name, searchKey(name), now - 380 * DAY, now - 380 * DAY);
      insVariant.run(vid, orgId, pid, price, cost, now - 380 * DAY, now - 380 * DAY);
      const code = ean13(`529${String(100000000 + i).slice(-9)}`);
      insBarcode.run(uuidv7(now), orgId, vid, code, code.padStart(14, '0'), now);
      for (const s of result.shops) insSettings.run(orgId, s, vid, 5, now);
      variants.push({ id: vid, price, cost });
      result.productIds.push(pid);
    }

    // movements: an opening stock, then mostly sales and some receives over 90 days
    const level = new Map<string, number>();
    const insMove = prep(
      'INSERT INTO stock_movements (id, org_id, shop_id, variant_id, qty_delta, kind, reason, unit_price_minor, unit_cost_minor, created_by, occurred_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    let written = 0;
    for (const v of variants) {
      for (const s of result.shops) {
        const t = now - 90 * DAY;
        insMove.run(uuidv7(t), orgId, s, v.id, 40, 'initial', null, null, v.cost, result.ownerId, t, t);
        level.set(`${s}|${v.id}`, 40);
        written++;
      }
    }
    while (written < nMovements) {
      const v = variants[Math.floor(r() * variants.length)]!;
      const s = result.shops[Math.floor(r() * result.shops.length)]!;
      const t = now - Math.floor(r() * 90 * DAY);
      const roll = r();
      const kind = roll < 0.85 ? 'sale' : roll < 0.97 ? 'receive' : 'damage';
      const qty = kind === 'sale' ? -1 - Math.floor(r() * 2) : kind === 'receive' ? 10 + Math.floor(r() * 30) : -1;
      insMove.run(uuidv7(t), orgId, s, v.id, qty, kind, kind === 'damage' ? 'damaged' : null, kind === 'sale' ? v.price : null, kind === 'sale' ? null : v.cost, result.ownerId, t, t);
      const k = `${s}|${v.id}`;
      level.set(k, (level.get(k) ?? 0) + qty);
      written++;
    }
    const insLevel = prep('INSERT INTO stock_levels (org_id, shop_id, variant_id, on_hand, in_transit_in, last_movement_at) VALUES (?, ?, ?, ?, 0, ?)');
    for (const [k, onHand] of level) {
      const [s, v] = k.split('|');
      insLevel.run(orgId, s, v, onHand, now - DAY);
    }

    // customers, spread over the shops, the group and the whole business
    const insCustomer = prep(
      `INSERT INTO customers (id, org_id, name, email, email_verified_at, phone, locale, email_ok, push_ok, source, search_key, contact_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'join_link', ?, ?, ?, ?)`,
    );
    const insSub = prep("INSERT INTO customer_subscriptions (id, org_id, customer_id, scope_type, scope_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'subscribed', ?, ?)");
    const insAlert = prep("INSERT OR IGNORE INTO stock_alerts (id, org_id, customer_id, variant_id, shop_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'waiting', ?)");
    for (let i = 0; i < nCustomers; i++) {
      const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(r() * LAST.length)]} ${i}`;
      const email = `c${i}.${orgId.slice(-6)}@example.com`;
      const phone = `+3069${String(10000000 + i).slice(-8)}`;
      const created = now - Math.floor(r() * 365 * DAY);
      const cid = uuidv7(created);
      insCustomer.run(cid, orgId, name, email, created, phone, i % 5 === 0 ? 'ru' : 'el', i % 3 ? 1 : 0, i % 2, searchKey(name), contactKey(email, phone), created, created);
      const pick = i % 10;
      if (pick === 0) insSub.run(uuidv7(created), orgId, cid, 'org', orgId, created, created);
      else if (pick === 1) insSub.run(uuidv7(created), orgId, cid, 'group', groupId, created, created);
      else insSub.run(uuidv7(created), orgId, cid, 'shop', result.shops[pick % result.shops.length], created, created);
      if (i % 25 === 0) insAlert.run(uuidv7(created), orgId, cid, variants[i % variants.length]!.id, result.shops[0], created);
    }
  })();
  return result;
}
