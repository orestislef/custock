// made up "Lemoni" data, the same world as the demo. everything is fictional, emails are on
// example.com, every dev password is "custock".

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROLES, contactKey, ean13, gtinCheckDigit, makeInternalEan13, normalize, searchKey, toGtin14, transliterate, uuidv7, followsShop, type Topology } from '@custock/core';
import type { Db } from './open';
import { hashPassword } from './password';

const DAY = 86_400_000;

// the Lemoni categories: key, greek (the org default), english, russian
export const CATEGORY_NAMES: [string, string, string, string][] = [
  ['pantry', 'Κελάρι', 'Pantry', 'Кладовая'],
  ['coffee', 'Καφές και τσάι', 'Coffee and tea', 'Кофе и чай'],
  ['sweets', 'Γλυκά και ξηροί καρποί', 'Sweets and nuts', 'Сладости и орехи'],
  ['home', 'Σπίτι', 'Home', 'Для дома'],
  ['care', 'Περιποίηση', 'Body care', 'Уход'],
  ['cheese', 'Τυριά', 'Cheese', 'Сыры'],
];

export interface SeedResult {
  orgId: string;
  shops: Record<'kifisia' | 'marousi' | 'glyfada', string>;
  groupId: string;
  users: Record<string, string>; // key -> user id
  customers: number;
  movements: number;
  products: Record<string, string>; // image key -> product id
  variants: Record<string, string>; // image key (or key:option) -> variant id
  posts: Record<'news' | 'arrival' | 'offer' | 'event' | 'draft', string>;
  joinLinks: Record<string, string>; // code -> id
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

function poisson(r: () => number, lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > l);
  return k - 1;
}

function loadImages(): Record<string, string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, '..', '..', '..', 'demo', 'assets', 'js', 'images.js');
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8');
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/"([\w-]+)":\s*"([^"]+)"/g)) out[m[1]!] = m[2]!;
  return out;
}

type Row = Record<string, string | number | null | undefined>;

export function seed(db: Db, opts: { now?: number; passwordHash?: string } = {}): SeedResult {
  const now = opts.now ?? Date.now();
  const r = rng(20261117);
  const images = loadImages();
  const pw = opts.passwordHash ?? hashPassword('custock');
  let movementCount = 0;

  const stmts = new Map<string, ReturnType<Db['prepare']>>();
  const ins = (table: string, row: Row) => {
    const keys = Object.keys(row).filter((k) => row[k] !== undefined);
    const sig = `${table}:${keys.join(',')}`;
    let st = stmts.get(sig);
    if (!st) {
      st = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => '@' + k).join(',')})`);
      stmts.set(sig, st);
    }
    st.run(Object.fromEntries(keys.map((k) => [k, row[k] ?? null])));
  };
  const id = (t = now) => uuidv7(t);
  const daysAgo = (d: number, hour = 12) => {
    const t = new Date(now - d * DAY);
    t.setUTCHours(hour - 2, Math.floor(r() * 60), Math.floor(r() * 60), 0);
    return Math.min(t.getTime(), now - 60_000);
  };

  const result = {} as SeedResult;

  db.transaction(() => {
    // ------------------------------------------------------------ files
    const fileIds: Record<string, string> = {};
    // two image keys can point at the same url, storage keys are unique, so one file row per url
    const fileByUrl = new Map<string, string>();

    // ------------------------------------------------------------ org
    const orgId = id(now - 62 * DAY);
    result.orgId = orgId;
    ins('organizations', {
      id: orgId, name: 'Lemoni', slug: 'lemoni', country: 'GR', currency: 'EUR', timezone: 'Europe/Athens',
      default_locale: 'el', brand_color: '#B0234F', allow_negative_stock: 1, posts_need_approval: 1,
      push_daily_cap: 2, quiet_hours: '22:00-09:00', customer_catalog: 'subscribers', customer_prices: 1,
      customer_stock: 'availability', few_left_threshold: 3, created_at: now - 62 * DAY,
    });
    const insertFile = (key: string, purpose: string) => {
      if (fileIds[key]) return fileIds[key]!;
      const url = images[key];
      if (!url) return null;
      const known = fileByUrl.get(url);
      if (known) return (fileIds[key] = known);
      const fid = id(now - 61 * DAY);
      fileIds[key] = fid;
      fileByUrl.set(url, fid);
      ins('files', {
        id: fid, org_id: orgId, storage_key: images[key]!, purpose, is_public: 1, mime: 'image/jpeg', bytes: 0,
        width: purpose === 'product' ? 500 : 960, height: null, created_at: now - 61 * DAY,
      });
      return fid;
    };

    const shopDefs = [
      { key: 'kifisia', name: 'Kifisia', city: 'Κηφισιά', address: 'Κασσαβέτη 12', phone: '+302108011223', img: 's-kifisia', lat: 38.0742, lng: 23.8115 },
      { key: 'marousi', name: 'Marousi', city: 'Μαρούσι', address: 'Βασ. Σοφίας 45', phone: '+302106142290', img: 's-marousi', lat: 38.0499, lng: 23.8046 },
      { key: 'glyfada', name: 'Glyfada', city: 'Γλυφάδα', address: 'Μεταξά 7', phone: '+302108945512', img: 's-glyfada', lat: 37.8659, lng: 23.7538 },
    ] as const;
    const shops = {} as SeedResult['shops'];
    for (const s of shopDefs) {
      const sid = id(now - 61 * DAY);
      shops[s.key] = sid;
      const img = insertFile(s.img, 'shop');
      ins('shops', {
        id: sid, org_id: orgId, name: s.name, slug: s.key, address: s.address, city: s.city, phone: s.phone,
        email: `${s.key}@lemoni.example.com`, timezone: null, lat: s.lat, lng: s.lng,
        opening_hours: JSON.stringify({ mon_fri: '09:00-21:00', sat: '09:00-18:00', sun: null }),
        image_file_id: img, customer_visible: 1, customer_stock: null, created_at: now - 61 * DAY,
      });
    }
    result.shops = shops;
    const groupId = id(now - 61 * DAY);
    result.groupId = groupId;
    ins('shop_groups', { id: groupId, org_id: orgId, name: 'North Athens', created_at: now - 61 * DAY });
    for (const s of [shops.kifisia, shops.marousi]) ins('shop_group_shops', { org_id: orgId, group_id: groupId, shop_id: s, added_at: now - 61 * DAY });
    const topology: Topology = { orgId, shops: [shops.kifisia, shops.marousi, shops.glyfada], groups: { [groupId]: [shops.kifisia, shops.marousi] } };

    // ------------------------------------------------------------ roles
    const roleIds: Record<string, string> = {};
    for (const t of DEFAULT_ROLES) {
      const rid = id(now - 62 * DAY);
      roleIds[t.key] = rid;
      ins('roles', {
        id: rid, org_id: orgId, template_key: t.key, name: t.key[0]!.toUpperCase() + t.key.slice(1), rank: t.rank,
        is_locked: t.locked ? 1 : 0, created_at: now - 62 * DAY, updated_at: now - 62 * DAY,
      });
      for (const p of t.permissions) ins('role_permissions', { role_id: rid, permission: p });
    }

    // ------------------------------------------------------------ members
    const people = [
      { key: 'eleni', name: 'Eleni Papadopoulou', role: 'owner', scope: ['org', orgId] },
      { key: 'nikos', name: 'Nikos Georgiou', role: 'admin', scope: ['org', orgId] },
      { key: 'maria', name: 'Maria Ioannou', role: 'manager', scope: ['shop', shops.kifisia] },
      { key: 'giorgos', name: 'Giorgos Antoniou', role: 'manager', scope: ['shop', shops.glyfada] },
      { key: 'dimitris', name: 'Dimitris Kostas', role: 'staff', scope: ['shop', shops.kifisia] },
      { key: 'katerina', name: 'Katerina Vlachou', role: 'staff', scope: ['shop', shops.marousi] },
      { key: 'sofia', name: 'Sofia Alexiou', role: 'viewer', scope: ['org', orgId] },
    ] as const;
    const users: Record<string, string> = {};
    for (const p of people) {
      const uid = id(now - 61 * DAY);
      users[p.key] = uid;
      ins('users', {
        id: uid, email: `${p.key}@example.com`, display_name: p.name, password_hash: pw, email_verified_at: now - 61 * DAY,
        locale: 'el', created_at: now - 61 * DAY, updated_at: now - 61 * DAY,
      });
      const mid = id(now - 61 * DAY);
      ins('memberships', { id: mid, org_id: orgId, user_id: uid, status: 'active', perms_version: 1, joined_at: now - 61 * DAY });
      ins('role_assignments', {
        id: id(now - 61 * DAY), org_id: orgId, membership_id: mid, role_id: roleIds[p.role]!, scope_type: p.scope[0],
        scope_id: p.scope[1], granted_by: p.key === 'eleni' ? null : users.eleni ?? null, created_at: now - 61 * DAY,
      });
    }
    // the customer app user
    const annaUser = id(now - 30 * DAY);
    users.anna = annaUser;
    ins('users', {
      id: annaUser, email: 'anna@example.com', display_name: 'Anna Petrova', password_hash: pw, email_verified_at: now - 30 * DAY,
      locale: 'ru', created_at: now - 30 * DAY, updated_at: now - 30 * DAY,
    });
    ins('devices', { id: id(now - 30 * DAY), user_id: annaUser, platform: 'ios', fcm_token: 'dev-token-anna', app_version: '0.1.0', locale: 'ru', last_seen_at: now - DAY });
    result.users = users;

    // ------------------------------------------------------------ categories
    const cats: Record<string, string> = {};
    const catDefs: [string, string, string, string][] = CATEGORY_NAMES;
    catDefs.forEach(([k, name, en, ru], i) => {
      cats[k] = id(now - 61 * DAY);
      ins('categories', { id: cats[k], org_id: orgId, parent_id: null, name, sort: i });
      ins('category_translations', { category_id: cats[k], locale: 'en', name: en });
      ins('category_translations', { category_id: cats[k], locale: 'ru', name: ru });
    });

    // ------------------------------------------------------------ products
    interface ProductDef {
      key: string; cat: string; el: string; en: string; ru: string; desc: [string, string, string];
      price: number; cost: number; vat: number; uom?: 'piece' | 'kg'; pop: number;
      variants?: { label: Record<string, string>; price: number; cost: number; pop: number; tag: string }[];
    }
    const productDefs: ProductDef[] = [
      { key: 'p-olive-oil', cat: 'pantry', el: 'Εξαιρετικό παρθένο ελαιόλαδο 500ml', en: 'Extra virgin olive oil 500 ml', ru: 'Оливковое масло extra virgin 500 мл',
        desc: ['Κορωνέικη από τη Λακωνία, νέα σοδειά.', 'Koroneiki from Laconia, new harvest.', 'Сорт коронейки из Лаконии, новый урожай.'], price: 1290, cost: 720, vat: 1300, pop: 1.6 },
      { key: 'p-thyme-honey', cat: 'pantry', el: 'Θυμαρίσιο μέλι 450g', en: 'Thyme honey 450 g', ru: 'Тимьяновый мёд 450 г',
        desc: ['Από τα Κύθηρα, ακατέργαστο.', 'From Kythira, raw.', 'С острова Китира, необработанный.'], price: 1290, cost: 690, vat: 1300, pop: 1.1 },
      { key: 'p-greek-coffee', cat: 'coffee', el: 'Ελληνικός καφές 194g', en: 'Greek coffee 194 g', ru: 'Греческий кофе 194 г',
        desc: ['Φρεσκοαλεσμένος, μέτριο καβούρδισμα.', 'Freshly ground, medium roast.', 'Свежемолотый, средняя обжарка.'], price: 390, cost: 210, vat: 1300, pop: 2.4 },
      { key: 'p-mastiha', cat: 'pantry', el: 'Μαστίχα Χίου 10g', en: 'Chios mastic 10 g', ru: 'Мастика с Хиоса 10 г',
        desc: ['Δάκρυ μαστίχας ΠΟΠ.', 'PDO mastic tears.', 'Слёзы мастики, PDO.'], price: 790, cost: 420, vat: 1300, pop: 0.6 },
      { key: 'p-olive-soap', cat: 'care', el: 'Σαπούνι ελαιολάδου', en: 'Olive oil soap', ru: 'Мыло на оливковом масле',
        desc: ['Χειροποίητο, χωρίς άρωμα.', 'Handmade, unscented.', 'Ручная работа, без отдушек.'], price: 450, cost: 180, vat: 2400, pop: 0.9 },
      { key: 'p-ceramic-cup', cat: 'home', el: 'Κεραμική κούπα', en: 'Ceramic cup', ru: 'Керамическая чашка',
        desc: ['Φτιαγμένη στο χέρι στη Σίφνο.', 'Handmade on Sifnos.', 'Сделана вручную на Сифносе.'], price: 1400, cost: 600, vat: 2400, pop: 0.3,
        variants: [
          { label: { el: 'Μικρή 120ml', en: 'Small 120 ml', ru: 'Маленькая 120 мл' }, price: 1400, cost: 600, pop: 0.35, tag: 'small' },
          { label: { el: 'Μεγάλη 300ml', en: 'Large 300 ml', ru: 'Большая 300 мл' }, price: 1800, cost: 780, pop: 0.3, tag: 'large' },
        ] },
      { key: 'p-linen-tote', cat: 'home', el: 'Λινή τσάντα', en: 'Linen tote', ru: 'Льняная сумка',
        desc: ['Ελληνικό λινό, μεγάλη.', 'Greek linen, large.', 'Греческий лён, большая.'], price: 2200, cost: 900, vat: 2400, pop: 0.2,
        variants: [
          { label: { el: 'Φυσικό', en: 'Natural', ru: 'Натуральный' }, price: 2200, cost: 900, pop: 0.25, tag: 'natural' },
          { label: { el: 'Μαύρο', en: 'Black', ru: 'Чёрный' }, price: 2200, cost: 900, pop: 0.2, tag: 'black' },
          { label: { el: 'Ελιά', en: 'Olive', ru: 'Оливковый' }, price: 2200, cost: 900, pop: 0.15, tag: 'olive' },
        ] },
      { key: 'p-sea-salt', cat: 'pantry', el: 'Θαλασσινό αλάτι 250g', en: 'Sea salt 250 g', ru: 'Морская соль 250 г',
        desc: ['Από τη Μεσολόγγι, χειροσυλλεγμένο.', 'From Messolonghi, hand harvested.', 'Из Месолонги, собрана вручную.'], price: 350, cost: 140, vat: 1300, pop: 0.8 },
      { key: 'p-mountain-tea', cat: 'coffee', el: 'Τσάι του βουνού', en: 'Greek mountain tea', ru: 'Греческий горный чай',
        desc: ['Σιδερίτης από τον Όλυμπο.', 'Sideritis from Olympus.', 'Сидеритис с Олимпа.'], price: 450, cost: 200, vat: 1300, pop: 0.9 },
      { key: 'p-loukoumi', cat: 'sweets', el: 'Λουκούμι τριαντάφυλλο', en: 'Rose loukoumi', ru: 'Лукум с розой',
        desc: ['Σύρου, κουτί 400g.', 'From Syros, 400 g box.', 'С Сироса, коробка 400 г.'], price: 590, cost: 280, vat: 1300, pop: 1.0 },
      { key: 'p-tahini', cat: 'pantry', el: 'Ταχίνι 300g', en: 'Tahini 300 g', ru: 'Тахини 300 г',
        desc: ['Ολικής άλεσης.', 'Wholegrain.', 'Из цельного кунжута.'], price: 490, cost: 230, vat: 1300, pop: 0.6 },
      { key: 'p-pistachio', cat: 'sweets', el: 'Φιστίκι Αιγίνης 200g', en: 'Aegina pistachios 200 g', ru: 'Фисташки с Эгины 200 г',
        desc: ['Καβουρδισμένα, ελαφρώς αλατισμένα.', 'Roasted, lightly salted.', 'Обжаренные, слегка солёные.'], price: 990, cost: 560, vat: 1300, pop: 0.7 },
      { key: 'p-candle', cat: 'home', el: 'Κερί σόγιας', en: 'Soy candle', ru: 'Соевая свеча',
        desc: ['Άρωμα συκιάς, 40 ώρες.', 'Fig scent, 40 hours.', 'Аромат инжира, 40 часов.'], price: 1600, cost: 600, vat: 2400, pop: 0.3 },
      { key: 'p-feta', cat: 'cheese', el: 'Φέτα ΠΟΠ', en: 'Feta PDO', ru: 'Фета PDO',
        desc: ['Από την Ήπειρο, στο κιλό.', 'From Epirus, by the kilo.', 'Из Эпира, на вес.'], price: 1290, cost: 800, vat: 1300, uom: 'kg', pop: 650 },
    ];

    const products: Record<string, string> = {};
    const variants: Record<string, string> = {};
    interface VariantInfo { id: string; productKey: string; price: number; cost: number; pop: number; uom: 'piece' | 'kg' }
    const variantList: VariantInfo[] = [];
    let barcodeSeq = 1;
    productDefs.forEach((p, pi) => {
      const pid = id(now - 60 * DAY);
      products[p.key] = pid;
      ins('products', {
        id: pid, org_id: orgId, category_id: cats[p.cat]!, name: p.el, description: p.desc[0], brand: null,
        uom: p.uom ?? 'piece', tax_rate_bp: p.vat, track_stock: 1, customer_visible: 1, customer_stock_hidden: 0,
        search_key: searchKey(p.el, p.en, p.ru), created_by: users.eleni, created_at: now - 60 * DAY, updated_at: now - 60 * DAY,
      });
      ins('product_translations', { product_id: pid, locale: 'en', name: p.en, description: p.desc[1] });
      ins('product_translations', { product_id: pid, locale: 'ru', name: p.ru, description: p.desc[2] });
      const img = insertFile(p.key, 'product');
      if (img) ins('product_images', { id: id(now - 60 * DAY), org_id: orgId, product_id: pid, variant_id: null, file_id: img, sort: 0 });

      const vdefs = p.variants ?? [{ label: null as unknown as Record<string, string>, price: p.price, cost: p.cost, pop: p.pop, tag: '' }];
      vdefs.forEach((v, vi) => {
        const vid = id(now - 60 * DAY);
        const vkey = v.tag ? `${p.key}:${v.tag}` : p.key;
        variants[vkey] = vid;
        if (vi === 0) variants[p.key] = variants[p.key] ?? vid;
        ins('product_variants', {
          id: vid, org_id: orgId, product_id: pid, sku: `LEM-${String(pi + 1).padStart(3, '0')}${v.tag ? '-' + v.tag.toUpperCase() : ''}`,
          options: v.label ? JSON.stringify({ el: v.label.el, en: v.label.en, ru: v.label.ru }) : null,
          price_minor: v.price, cost_minor: v.cost, is_default: vi === 0 ? 1 : 0, sort: vi, created_at: now - 60 * DAY, updated_at: now - 60 * DAY,
        });
        const code = p.uom === 'kg' ? makeInternalEan13(barcodeSeq++) : ean13(`520${String(4417000 + pi * 10 + vi).padStart(9, '0')}`);
        ins('barcodes', {
          id: id(now - 60 * DAY), org_id: orgId, variant_id: vid, code, code_norm: toGtin14(code),
          symbology: p.uom === 'kg' ? 'internal' : 'ean13', pack_qty: 1, created_by: users.eleni, created_at: now - 60 * DAY,
        });
        variantList.push({ id: vid, productKey: p.key, price: v.price, cost: v.cost, pop: v.pop, uom: p.uom ?? 'piece' });
      });
    });
    // a box barcode for greek coffee: one scan = 12 packs
    const itf14 = '1520441702000' + gtinCheckDigit('1520441702000');
    ins('barcodes', {
      id: id(now - 60 * DAY), org_id: orgId, variant_id: variants['p-greek-coffee']!, code: itf14,
      code_norm: itf14, symbology: 'itf14', pack_qty: 12, created_by: users.eleni, created_at: now - 60 * DAY,
    });
    result.products = products;
    result.variants = variants;

    // ------------------------------------------------------------ prices
    const OFFER_FROM = now - 2 * DAY;
    const OFFER_UNTIL = now + 5 * DAY;
    const OIL_CUT = now - 20 * DAY;
    for (const v of variantList) {
      if (v.productKey === 'p-olive-oil') {
        ins('price_history', { id: id(now - 60 * DAY), org_id: orgId, variant_id: v.id, shop_id: null, price_minor: 1390, source: 'base', valid_from: now - 60 * DAY, valid_to: OIL_CUT, changed_by: users.eleni });
        ins('price_history', { id: id(OIL_CUT), org_id: orgId, variant_id: v.id, shop_id: null, price_minor: 1290, source: 'base', valid_from: OIL_CUT, valid_to: null, changed_by: users.nikos });
      } else {
        ins('price_history', { id: id(now - 60 * DAY), org_id: orgId, variant_id: v.id, shop_id: null, price_minor: v.price, source: 'base', valid_from: now - 60 * DAY, valid_to: null, changed_by: users.eleni });
      }
    }
    // kifisia sells soap a little cheaper
    ins('shop_variant_settings', { org_id: orgId, shop_id: shops.kifisia, variant_id: variants['p-olive-soap']!, price_override_minor: 420, is_listed: 1, reorder_point: 6, reorder_qty: 24, updated_at: now - 30 * DAY });
    ins('price_history', { id: id(now - 30 * DAY), org_id: orgId, variant_id: variants['p-olive-soap']!, shop_id: shops.kifisia, price_minor: 420, source: 'shop_override', valid_from: now - 30 * DAY, valid_to: null, changed_by: users.maria });

    const offerPrices: Record<string, number> = { 'p-olive-oil': 1090, 'p-tahini': 390 };
    const priceAt = (v: VariantInfo, shopId: string, t: number): number => {
      if (v.productKey in offerPrices && t >= OFFER_FROM && (shopId === shops.kifisia || shopId === shops.marousi)) return offerPrices[v.productKey]!;
      if (v.productKey === 'p-olive-oil') return t < OIL_CUT ? 1390 : 1290;
      if (v.productKey === 'p-olive-soap' && shopId === shops.kifisia && t >= now - 30 * DAY) return 420;
      return v.price;
    };

    // ------------------------------------------------------------ stock movements
    const shopFactor: Record<string, number> = { [shops.kifisia]: 1.2, [shops.marousi]: 1.0, [shops.glyfada]: 0.8 };
    const staffFor: Record<string, string[]> = {
      [shops.kifisia]: [users.maria!, users.dimitris!],
      [shops.marousi]: [users.katerina!, users.nikos!],
      [shops.glyfada]: [users.giorgos!, users.nikos!],
    };
    const levels = new Map<string, { onHand: number; last: number }>();
    const move = (shopId: string, v: VariantInfo, qty: number, kind: string, t: number, extra: Row = {}) => {
      if (qty === 0) return;
      const who = staffFor[shopId]![Math.floor(r() * 2)]!;
      ins('stock_movements', {
        id: uuidv7(t), org_id: orgId, shop_id: shopId, variant_id: v.id, qty_delta: qty, kind, created_by: who,
        occurred_at: t, recorded_at: t + 500, ...extra,
      });
      movementCount++;
      const k = `${shopId}|${v.id}`;
      const l = levels.get(k) ?? { onHand: 0, last: 0 };
      l.onHand += qty;
      l.last = Math.max(l.last, t);
      levels.set(k, l);
    };
    const targets: Record<string, number> = {
      [`${shops.kifisia}|${variants['p-thyme-honey']}`]: 0,
      [`${shops.kifisia}|${variants['p-mastiha']}`]: 2,
      [`${shops.marousi}|${variants['p-sea-salt']}`]: 0,
      [`${shops.glyfada}|${variants['p-loukoumi']}`]: -1,
      [`${shops.glyfada}|${variants['p-linen-tote:black']}`]: 1,
    };
    const reasons = ['damaged', 'expired', 'damaged', 'lost'];

    for (const shopId of topology.shops) {
      for (const v of variantList) {
        const f = shopFactor[shopId]!;
        const unit = v.uom === 'kg' ? 1 : 1;
        const daily = v.pop * f;
        const startQty = v.uom === 'kg' ? Math.round(daily * 14) : Math.round(daily * 14) + 6;
        const key = `${shopId}|${v.id}`;
        const target = targets[key];
        move(shopId, v, startQty, 'initial', daysAgo(60, 8), { unit_cost_minor: v.cost });
        let nextReceive = 46 - Math.floor(r() * 6);
        const batchFor = new Map<number, string>();
        for (let d = 59; d >= 0; d--) {
          const l = levels.get(key)!;
          // receives roughly every 12 days, none for the products we want empty at the end
          const holdBack = target !== undefined && d < 14;
          if (d === nextReceive && !holdBack) {
            const qty = v.uom === 'kg' ? Math.round(daily * 12 / 500) * 500 + 2000 : Math.round(daily * 12) + 4;
            let batch = batchFor.get(d);
            if (!batch) { batch = uuidv7(daysAgo(d, 9)); batchFor.set(d, batch); }
            move(shopId, v, qty, 'receive', daysAgo(d, 9), { unit_cost_minor: v.cost, batch_id: batch, note: 'Τιμολόγιο προμηθευτή' });
            nextReceive = d - (10 + Math.floor(r() * 5));
          }
          // sales of the day as one movement, never below zero here
          let sold: number;
          if (v.uom === 'kg') sold = Math.round((daily * (0.6 + r() * 0.8)) / 50) * 50;
          else sold = poisson(r, daily);
          sold = Math.min(sold, Math.max(0, l.onHand));
          const t = daysAgo(d, 11 + Math.floor(r() * 8));
          if (sold > 0 && t < now) move(shopId, v, -sold * unit, 'sale', t, { unit_price_minor: priceAt(v, shopId, t) });
          // the odd broken jar
          if (r() < 0.012 && l.onHand > 2 && v.uom === 'piece') {
            move(shopId, v, -1, 'damage', daysAgo(d, 19), { reason: reasons[Math.floor(r() * reasons.length)]!, unit_cost_minor: v.cost });
          }
          if (r() < 0.004 && v.uom === 'piece') move(shopId, v, 1, 'adjust', daysAgo(d, 20), { reason: 'found' });
        }
        // land on the story numbers
        if (target !== undefined) {
          const l = levels.get(key)!;
          const diff = target - l.onHand;
          if (diff < 0) move(shopId, v, diff, 'sale', daysAgo(1, 17), { unit_price_minor: priceAt(v, shopId, now - DAY) });
          if (diff > 0) move(shopId, v, diff, 'adjust', daysAgo(1, 18), { reason: 'correction' });
        }
      }
    }
    // a sale scanned before the delivery was received, the classic negative
    // (already handled by the target above for loukoumi in glyfada)

    // reorder points and cached levels
    for (const shopId of topology.shops) {
      for (const v of variantList) {
        const key = `${shopId}|${v.id}`;
        const l = levels.get(key)!;
        const reorder = v.uom === 'kg' ? 2000 : Math.max(3, Math.round(v.pop * shopFactor[shopId]! * 5));
        if (!(shopId === shops.kifisia && v.id === variants['p-olive-soap'])) {
          ins('shop_variant_settings', { org_id: orgId, shop_id: shopId, variant_id: v.id, price_override_minor: null, is_listed: 1, reorder_point: reorder, reorder_qty: reorder * 3, updated_at: now - 60 * DAY });
        }
        ins('stock_levels', {
          org_id: orgId, shop_id: shopId, variant_id: v.id, on_hand: l.onHand, in_transit_in: 0,
          low_alert_sent_at: l.onHand <= reorder ? l.last : null, last_movement_at: l.last,
        });
      }
    }

    // ------------------------------------------------------------ join links
    const linkDefs = [
      { code: 'kif7q2', label: 'Αφίσα βιτρίνας', scope: ['shop', shops.kifisia] },
      { code: 'ig4m8x', label: 'Instagram bio', scope: ['org', orgId] },
      { code: 'mr3c5t', label: 'Απόδειξη', scope: ['shop', shops.marousi] },
      { code: 'gl8w2p', label: 'Αφίσα βιτρίνας', scope: ['shop', shops.glyfada] },
      { code: 'nt5f1y', label: 'Φυλλάδιο', scope: ['group', groupId] },
      { code: 'old000', label: 'Παλιά αφίσα', scope: ['shop', shops.kifisia], disabled: true },
    ] as const;
    const joinLinks: Record<string, string> = {};
    for (const l of linkDefs) {
      const lid = id(now - 55 * DAY);
      joinLinks[l.code] = lid;
      ins('join_links', {
        id: lid, org_id: orgId, code: l.code, scope_type: l.scope[0], scope_id: l.scope[1], label: l.label,
        default_tags: null, created_by: users.eleni, created_at: now - 55 * DAY,
        disabled_at: 'disabled' in l && l.disabled ? now - 20 * DAY : null,
      });
      for (let d = 29; d >= 0; d--) {
        if ('disabled' in l && l.disabled && d < 20) continue;
        const day = new Date(now - d * DAY).toISOString().slice(0, 10);
        const opens = 2 + Math.floor(r() * (l.code === 'kif7q2' ? 16 : 9));
        const signups = Math.floor(opens * (0.15 + r() * 0.25));
        const confirmed = Math.floor(signups * (0.6 + r() * 0.3));
        ins('join_link_stats_daily', { org_id: orgId, join_link_id: lid, day, opens, signups, confirmed });
      }
    }
    result.joinLinks = joinLinks;

    // ------------------------------------------------------------ customers
    const names: { name: string; locale: 'el' | 'ru' | 'en'; phone?: string }[] = [
      { name: 'Анна Петрова', locale: 'ru' },
      { name: 'Μαρία Παπαδάκη', locale: 'el' }, { name: 'Γιώργος Νικολάου', locale: 'el' }, { name: 'Ελένη Κωνσταντίνου', locale: 'el' },
      { name: 'Δημήτρης Παππάς', locale: 'el' }, { name: 'Κατερίνα Γεωργίου', locale: 'el' }, { name: 'Νίκος Αλεξίου', locale: 'el' },
      { name: 'Σοφία Μιχαηλίδου', locale: 'el' }, { name: 'Κώστας Βασιλείου', locale: 'el' }, { name: 'Αθηνά Οικονόμου', locale: 'el' },
      { name: 'Иван Смирнов', locale: 'ru' }, { name: 'Γιάννης Μαυρίδης', locale: 'el' }, { name: 'Χριστίνα Λαμπράκη', locale: 'el' },
      { name: 'Παναγιώτης Σταύρου', locale: 'el' }, { name: 'Ольга Кузнецова', locale: 'ru' }, { name: 'Δέσποινα Καραγιάννη', locale: 'el' },
      { name: 'Στέλιος Ζαχαρίου', locale: 'el' }, { name: 'Emma Clarke', locale: 'en' }, { name: 'Ιωάννα Πετρίδου', locale: 'el' },
      { name: 'Дмитрий Попов', locale: 'ru' }, { name: 'Μιχάλης Δημητρίου', locale: 'el' }, { name: 'Βασιλική Αντωνίου', locale: 'el' },
      { name: 'Елена Соколова', locale: 'ru' }, { name: 'Θοδωρής Κυριακίδης', locale: 'el' }, { name: 'James Turner', locale: 'en' },
      { name: 'Ευαγγελία Ραφαηλίδου', locale: 'el' }, { name: 'Сергей Лебедев', locale: 'ru' }, { name: 'Άρης Τσιμπούκης', locale: 'el' },
      { name: 'Φωτεινή Ξανθοπούλου', locale: 'el' }, { name: 'Наталья Козлова', locale: 'ru' }, { name: 'Λευτέρης Μαρκόπουλος', locale: 'el' },
      { name: 'Sophie Martin', locale: 'en' }, { name: 'Αγγελική Σαββίδου', locale: 'el' }, { name: 'Алексей Новиков', locale: 'ru' },
      { name: 'Πέτρος Χατζής', locale: 'el' }, { name: 'Ειρήνη Μπαλτά', locale: 'el' }, { name: 'Мария Морозова', locale: 'ru' },
      { name: 'Lucas Brown', locale: 'en' }, { name: 'Τάσος Ρήγας', locale: 'el' }, { name: 'Татьяна Волкова', locale: 'ru' },
    ];
    const tagsPool = ['τακτικοί', 'vip', 'καφεόφιλοι', 'χονδρική'];
    const customerIds: string[] = [];
    const subsByCustomer = new Map<string, { scopeType: 'org' | 'group' | 'shop'; scopeId: string; status: 'subscribed' | 'unsubscribed' | 'pending' }[]>();
    names.forEach((c, i) => {
      const created = now - Math.floor((58 - i * 1.4) * DAY) - Math.floor(r() * DAY * 0.5);
      const cid = id(created);
      customerIds.push(cid);
      const latin = transliterate(normalize(c.name)).replace(/[^a-z ]/g, '').trim().replace(/ +/g, '.');
      const email = i === 0 ? 'anna@example.com' : `${latin}@example.com`;
      const pending = i >= 38;
      const emailOk = !pending && i % 3 !== 2;
      const isApp = i === 0 || i % 2 === 0;
      const pushOk = isApp && !pending && i % 5 !== 4;
      const sub: { scopeType: 'org' | 'group' | 'shop'; scopeId: string; status: 'subscribed' | 'unsubscribed' | 'pending' }[] = [];
      let link: string;
      switch (i % 5) {
        case 0: sub.push({ scopeType: 'org', scopeId: orgId, status: 'subscribed' }); link = 'ig4m8x'; break;
        case 1: sub.push({ scopeType: 'group', scopeId: groupId, status: 'subscribed' }); link = 'nt5f1y'; break;
        case 2: sub.push({ scopeType: 'shop', scopeId: shops.kifisia, status: 'subscribed' }); link = 'kif7q2'; break;
        case 3: sub.push({ scopeType: 'shop', scopeId: shops.marousi, status: 'subscribed' }); link = 'mr3c5t'; break;
        default: sub.push({ scopeType: 'shop', scopeId: shops.glyfada, status: 'subscribed' }); link = 'gl8w2p';
      }
      if (i === 0) sub.push({ scopeType: 'shop', scopeId: shops.kifisia, status: 'subscribed' });
      if (i === 6) sub.push({ scopeType: 'shop', scopeId: shops.kifisia, status: 'unsubscribed' });
      if (i % 7 === 3 && i % 5 !== 4) sub.push({ scopeType: 'shop', scopeId: shops.glyfada, status: 'subscribed' });
      if (pending) for (const s of sub) s.status = 'pending';
      subsByCustomer.set(cid, sub);
      const phone = c.locale === 'ru' && i % 2 === 1 ? `+79${String(161234567 + i * 7919).slice(0, 9)}` : `+3069${String(40000000 + i * 104729).slice(0, 8)}`;
      let userId: string | null = null;
      if (i === 0) userId = annaUser;
      else if (isApp && !pending) {
        userId = id(created);
        ins('users', { id: userId, email, display_name: c.name, password_hash: null, email_verified_at: created, locale: c.locale, created_at: created, updated_at: created });
        ins('devices', { id: id(created), user_id: userId, platform: i % 4 === 0 ? 'android' : 'ios', fcm_token: `dev-token-${i}`, app_version: '0.1.0', locale: c.locale, last_seen_at: now - (i % 9) * DAY });
      }
      ins('customers', {
        id: cid, org_id: orgId, user_id: userId, name: c.name, email, email_verified_at: pending ? null : created + 600_000,
        phone, phone_verified_at: null, locale: c.locale, birthday: i % 9 === 0 ? `0${1 + (i % 9)}-1${i % 9}` : null,
        email_ok: emailOk ? 1 : 0, push_ok: pushOk ? 1 : 0, sms_ok: 0, source: i === 0 ? 'app' : 'join_link',
        join_link_id: joinLinks[link] ?? null, search_key: searchKey(c.name), contact_key: contactKey(email, phone), created_at: created, updated_at: created,
      });
      for (const s of sub) {
        ins('customer_subscriptions', {
          id: id(created), org_id: orgId, customer_id: cid, scope_type: s.scopeType, scope_id: s.scopeId, status: s.status,
          source: 'join_link', join_link_id: joinLinks[link] ?? null, created_at: created, updated_at: created,
        });
      }
      const text = `${c.locale}-2026-11`;
      if (!pending) {
        ins('consents', { id: id(created), org_id: orgId, customer_id: cid, channel: 'email', granted: emailOk ? 1 : 0, text_version: text, source: 'join_page', ip: '192.0.2.10', user_agent: 'Mozilla/5.0', created_at: created });
        if (emailOk) ins('consents', { id: id(created + 600_000), org_id: orgId, customer_id: cid, channel: 'email', granted: 1, text_version: text, source: 'double_opt_in', ip: '192.0.2.10', user_agent: 'Mozilla/5.0', created_at: created + 600_000 });
        if (isApp) ins('consents', { id: id(created + DAY), org_id: orgId, customer_id: cid, channel: 'push', granted: pushOk ? 1 : 0, text_version: text, source: 'app', ip: null, user_agent: null, created_at: created + DAY });
      }
      if (i % 4 === 0) ins('customer_tags', { org_id: orgId, customer_id: cid, tag: tagsPool[0]!, created_at: created });
      if (i % 6 === 0) ins('customer_tags', { org_id: orgId, customer_id: cid, tag: tagsPool[1]!, created_at: created });
      if (i % 5 === 1) ins('customer_tags', { org_id: orgId, customer_id: cid, tag: tagsPool[2]!, created_at: created });
      if (i === 13 || i === 27) ins('customer_tags', { org_id: orgId, customer_id: cid, tag: tagsPool[3]!, created_at: created });
      const catKeys = Object.keys(cats);
      ins('customer_interests', { org_id: orgId, customer_id: cid, category_id: cats[catKeys[i % catKeys.length]!]! });
      if (i % 3 === 0) ins('customer_interests', { org_id: orgId, customer_id: cid, category_id: cats[catKeys[(i + 2) % catKeys.length]!]! });
      if (i % 4 === 1 || i === 0) ins('customer_favorites', { org_id: orgId, customer_id: cid, product_id: products['p-olive-oil']!, created_at: created + DAY });
      if (i % 6 === 2 || i === 0) ins('customer_favorites', { org_id: orgId, customer_id: cid, product_id: products['p-ceramic-cup']!, created_at: created + DAY });
    });
    ins('customer_notes', { id: id(now - 10 * DAY), org_id: orgId, customer_id: customerIds[2]!, body: 'Προτιμά το μέλι σε μεγάλο βάζο. Να τον ενημερώσουμε αν φέρουμε.', author_id: users.maria, created_at: now - 10 * DAY });
    ins('customer_notes', { id: id(now - 4 * DAY), org_id: orgId, customer_id: customerIds[0]!, body: 'Ρωτάει για θυμαρίσιο μέλι κάθε εβδομάδα.', author_id: users.dimitris, created_at: now - 4 * DAY });
    result.customers = customerIds.length;

    // 14 people waiting for thyme honey in kifisia, 3 for sea salt in marousi
    const followers = (shopId: string) => customerIds.filter((c) => followsShop(subsByCustomer.get(c)!, topology, shopId));
    const honeyWaiters = [customerIds[0]!, ...followers(shops.kifisia).filter((c) => c !== customerIds[0])].slice(0, 14);
    honeyWaiters.forEach((cid, i) => ins('stock_alerts', { id: id(now - (12 - i * 0.7) * DAY), org_id: orgId, customer_id: cid, variant_id: variants['p-thyme-honey']!, shop_id: shops.kifisia, status: 'waiting', created_at: now - Math.floor((12 - i * 0.7) * DAY) }));
    followers(shops.marousi).slice(0, 3).forEach((cid) => ins('stock_alerts', { id: id(now - 3 * DAY), org_id: orgId, customer_id: cid, variant_id: variants['p-sea-salt']!, shop_id: shops.marousi, status: 'waiting', created_at: now - 3 * DAY }));
    // one that was already told
    ins('stock_alerts', { id: id(now - 30 * DAY), org_id: orgId, customer_id: customerIds[5]!, variant_id: variants['p-mastiha']!, shop_id: null, status: 'notified', created_at: now - 30 * DAY, notified_at: now - 22 * DAY });

    // ------------------------------------------------------------ posts
    const postDefs = [
      { key: 'news', kind: 'news', status: 'sent', author: 'nikos', sent: now - 20 * DAY, scope: [['org', orgId]], channels: ['feed', 'push'], cover: 'hero-shop',
        t: { el: ['Ανοίγουμε νωρίτερα τα Σάββατα', 'Από αυτό το Σάββατο σας περιμένουμε από τις 08:30 σε όλα τα καταστήματα.'], en: ['We open earlier on Saturdays', 'From this Saturday we open at 08:30 in every shop.'], ru: ['По субботам открываемся раньше', 'С этой субботы ждём вас с 08:30 во всех магазинах.'] } },
      { key: 'arrival', kind: 'new_arrival', status: 'sent', author: 'eleni', sent: now - 6 * DAY, scope: [['org', orgId]], channels: ['feed', 'push', 'email'], cover: 'post-harvest', products: ['p-olive-oil'],
        t: { el: ['Ήρθε το νέο ελαιόλαδο', 'Νέα σοδειά από τη Λακωνία, πράσινο και πικάντικο. Δοκιμάστε το στο κατάστημα.'], en: ['New harvest olive oil is in', 'Fresh from Laconia, green and peppery. Come and taste it in the shop.'], ru: ['Новый урожай оливкового масла уже здесь', 'Свежее масло из Лаконии, зелёное и пикантное. Приходите попробовать.'] } },
      { key: 'offer', kind: 'offer', status: 'sent', author: 'nikos', sent: OFFER_FROM, scope: [['group', groupId]], channels: ['feed', 'push'], cover: 'post-offer', products: ['p-olive-oil', 'p-tahini'], validFrom: OFFER_FROM, validUntil: OFFER_UNTIL,
        t: { el: ['Εβδομάδα ελαιολάδου', 'Ελαιόλαδο και ταχίνι σε καλύτερη τιμή ως την Κυριακή, στην Κηφισιά και στο Μαρούσι.'], en: ['Olive oil week', 'Olive oil and tahini for less until Sunday, in Kifisia and Marousi.'], ru: ['Неделя оливкового масла', 'Оливковое масло и тахини дешевле до воскресенья, в Кифисии и Марусях.'] } },
      { key: 'event', kind: 'event', status: 'scheduled', author: 'maria', approvedBy: 'nikos', scheduled: now + DAY, scope: [['shop', shops.kifisia]], channels: ['feed', 'push', 'email'], cover: 'post-event', products: ['p-thyme-honey'],
        t: { el: ['Γευσιγνωσία μελιού το Σάββατο', 'Ελάτε στην Κηφισιά το Σάββατο στις 12:00 να δοκιμάσετε τρία μέλια από τα Κύθηρα.'], en: ['Honey tasting on Saturday', 'Come to Kifisia on Saturday at 12:00 and taste three honeys from Kythira.'], ru: ['Дегустация мёда в субботу', 'Приходите в Кифисию в субботу в 12:00 и попробуйте три вида мёда с Китиры.'] } },
      { key: 'draft', kind: 'new_arrival', status: 'pending_approval', author: 'maria', scope: [['shop', shops.kifisia]], channels: ['feed', 'push'], cover: 'post-new-arrivals', products: ['p-ceramic-cup:small', 'p-ceramic-cup:large'],
        t: { el: ['Νέες κεραμικές κούπες', 'Οι κούπες από τη Σίφνο ήρθαν σε δύο μεγέθη.'], en: ['New ceramic cups', 'The cups from Sifnos are here in two sizes.'] } },
    ] as const;
    const postIds = {} as SeedResult['posts'];
    for (const p of postDefs) {
      const created = ('sent' in p ? p.sent : now - DAY) - 3600_000;
      const pid = id(created);
      postIds[p.key] = pid;
      const cover = insertFile(p.cover, 'post');
      const audience = { scopes: p.scope.map(([scopeType, scopeId]) => ({ scopeType, scopeId })), tags: [], interests: [], locales: [], savedAnyLinked: false, joinedWithinDays: null };
      ins('posts', {
        id: pid, org_id: orgId, kind: p.kind, status: p.status, default_locale: 'el', channels: JSON.stringify(p.channels),
        audience: JSON.stringify(audience), cover_file_id: cover, scheduled_at: 'scheduled' in p ? p.scheduled : null,
        valid_from: 'validFrom' in p ? p.validFrom : null, valid_until: 'validUntil' in p ? p.validUntil : null,
        author_id: users[p.author]!, approved_by: 'approvedBy' in p ? users[p.approvedBy]! : p.status === 'sent' ? users[p.author]! : null,
        sent_at: 'sent' in p ? p.sent : null, recipients_count: null, created_at: created, updated_at: created,
      });
      for (const [locale, [title, body]] of Object.entries(p.t)) ins('post_translations', { post_id: pid, locale, title, body });
      if ('products' in p) {
        p.products.forEach((pk, i) => {
          const offer = p.kind === 'offer' ? offerPrices[pk] ?? null : null;
          ins('post_products', { post_id: pid, variant_id: variants[pk]!, offer_price_minor: offer, sort: i });
          if (offer) ins('price_history', { id: id(OFFER_FROM), org_id: orgId, variant_id: variants[pk]!, shop_id: null, price_minor: offer, source: 'offer', post_id: pid, valid_from: OFFER_FROM, valid_to: OFFER_UNTIL, changed_by: users.nikos });
        });
      }
      if (p.status === 'sent') {
        for (const [scopeType, scopeId] of p.scope) ins('post_scopes', { post_id: pid, org_id: orgId, scope_type: scopeType, scope_id: scopeId });
        // deliveries to everyone following a shop in scope
        const scopeShops = new Set(p.scope.flatMap(([st, sid]) => (st === 'org' ? topology.shops : st === 'group' ? topology.groups[sid]! : [sid])));
        let recipients = 0;
        customerIds.forEach((cid, i) => {
          const subs = subsByCustomer.get(cid)!;
          if (![...scopeShops].some((s) => followsShop(subs, topology, s))) return;
          recipients++;
          const isApp = i === 0 || i % 2 === 0;
          const pushOk = isApp && i % 5 !== 4;
          const emailOk = i % 3 !== 2;
          const sentAt = 'sent' in p ? p.sent : now;
          if (p.channels.includes('push' as never)) {
            const status = !pushOk ? 'skipped' : i % 11 === 7 ? 'failed' : i % 3 === 0 ? 'opened' : 'sent';
            ins('deliveries', { id: id(sentAt), org_id: orgId, post_id: pid, customer_id: cid, channel: 'push', status, skip_reason: status === 'skipped' ? (isApp ? 'no_consent' : 'no_device') : null, error: status === 'failed' ? 'UNREGISTERED' : null, created_at: sentAt, updated_at: sentAt + 60_000 });
          }
          if (p.channels.includes('email' as never)) {
            const status = !emailOk ? 'skipped' : i % 13 === 5 ? 'bounced' : i % 2 === 0 ? 'opened' : 'sent';
            ins('deliveries', { id: id(sentAt), org_id: orgId, post_id: pid, customer_id: cid, channel: 'email', status, skip_reason: status === 'skipped' ? 'no_consent' : null, created_at: sentAt, updated_at: sentAt + 120_000 });
          }
        });
        db.prepare('UPDATE posts SET recipients_count = ? WHERE id = ?').run(recipients, pid);
      }
    }
    result.posts = postIds;

    // ------------------------------------------------------------ unknown codes, views, audit
    ins('unknown_scans', { id: id(now - 3 * DAY), org_id: orgId, shop_id: shops.kifisia, code: '5209999000017', code_norm: '05209999000017', symbology: 'ean13', scanned_by: users.dimitris, scanned_at: now - 3 * DAY, times: 3 });
    ins('unknown_scans', { id: id(now - DAY), org_id: orgId, shop_id: shops.kifisia, code: 'SUP-44-A', code_norm: 'SUP-44-A', symbology: 'code128', scanned_by: users.dimitris, scanned_at: now - DAY, times: 1 });
    for (const [key, pid] of Object.entries(products)) {
      for (let d = 13; d >= 0; d--) {
        const day = new Date(now - d * DAY).toISOString().slice(0, 10);
        const base = key === 'p-thyme-honey' ? 14 : key === 'p-olive-oil' ? 18 : 4;
        ins('product_view_stats_daily', { org_id: orgId, product_id: pid, day, views: base + Math.floor(r() * base), notify_me_taps: key === 'p-thyme-honey' ? Math.floor(r() * 3) : 0, favorites_added: r() < 0.2 ? 1 : 0 });
      }
    }
    ins('audit_log', { id: id(now - 20 * DAY), org_id: orgId, actor_id: users.eleni, actor_kind: 'member', action: 'org.settings_changed', entity_type: 'organization', entity_id: orgId, before_json: '{"posts_need_approval":0}', after_json: '{"posts_need_approval":1}', created_at: now - 20 * DAY });
    ins('audit_log', { id: id(OIL_CUT), org_id: orgId, actor_id: users.nikos, actor_kind: 'member', action: 'product.price_changed', entity_type: 'product_variant', entity_id: variants['p-olive-oil']!, before_json: '{"price_minor":1390}', after_json: '{"price_minor":1290}', created_at: OIL_CUT });

    // ------------------------------------------------------------ daily rollups from the ledger
    const rollup = db.prepare(`
      SELECT shop_id, kind, qty_delta, unit_price_minor, unit_cost_minor, variant_id, recorded_at FROM stock_movements WHERE org_id = ?`).all(orgId) as
      { shop_id: string; kind: string; qty_delta: number; unit_price_minor: number | null; unit_cost_minor: number | null; variant_id: string; recorded_at: number }[];
    const costOf = new Map(variantList.map((v) => [v.id, v]));
    const daily = new Map<string, Row & { sales_qty: number; sales_value_minor: number; received_qty: number; received_cost_minor: number; shrink_qty: number; shrink_cost_minor: number; returns_qty: number }>();
    for (const m of rollup) {
      const day = new Date(m.recorded_at + 2 * 3600_000).toISOString().slice(0, 10);
      const k = `${m.shop_id}|${day}`;
      const d = daily.get(k) ?? { org_id: orgId, shop_id: m.shop_id, day, sales_qty: 0, sales_value_minor: 0, received_qty: 0, received_cost_minor: 0, shrink_qty: 0, shrink_cost_minor: 0, returns_qty: 0 };
      const v = costOf.get(m.variant_id)!;
      const units = v.uom === 'kg' ? m.qty_delta / 1000 : m.qty_delta;
      if (m.kind === 'sale') { d.sales_qty += -m.qty_delta; d.sales_value_minor += Math.round(-units * (m.unit_price_minor ?? v.price)); }
      if (m.kind === 'receive') { d.received_qty += m.qty_delta; d.received_cost_minor += Math.round(units * (m.unit_cost_minor ?? v.cost)); }
      if (m.kind === 'damage' || ((m.kind === 'adjust' || m.kind === 'count') && m.qty_delta < 0)) { d.shrink_qty += -m.qty_delta; d.shrink_cost_minor += Math.round(-units * v.cost); }
      daily.set(k, d);
    }
    for (const d of daily.values()) ins('daily_shop_stats', d);
  })();

  result.movements = movementCount;
  return result;
}
