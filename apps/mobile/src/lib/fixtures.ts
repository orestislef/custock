// an in memory implementation of CustockApi with the Lemoni demo business.
// used when no API url is configured, so the app runs on its own (and in screenshots).
// it follows the same rules as the server: permissions, masking, back in stock, approvals.

import {
  DEFAULT_ROLES, buildOrgAccess, can, canManageMember, ean13, followsShop, grantableRoles, maskEmail, maskPhone,
  matches, normalizeBarcode, searchKey, uuidv7,
  type AccessAssignment, type Audience, type AudiencePreview, type Category, type Customer, type CustomerDetail,
  type CustockApi, type DashboardCards, type FeedItem, type JoinLink, type Locale, type MeContext, type Member,
  type Movement, type MovementBatchResult, type MovementInput, type OrgAccess, type OrgSettings, type Post,
  type PostInput, type Product, type PublicProduct, type Role, type ScopeType, type Shop, type StockLevel,
  type Subscription, type Topology, type Variant, type StockCount, type StockCountLine, type StockAlertItem,
} from '@custock/core';

const DAY = 86_400_000;
const now = () => Date.now();
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

class FixtureError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

const IMG = (file: string, w = 500) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${file}/${w}px-${file.split('/').pop()}`;

const IMAGES: Record<string, string> = {
  oil: IMG('f/fa/Extra_Virgin_Cretan_Olive_Oil.JPG'),
  honey: IMG('3/34/Dipper_stick_and_honey_in_a_jar.jpg'),
  coffee: IMG('d/d1/Cafe_grec_i_licor_de_roses1.jpg'),
  mastiha: IMG('3/36/A_jar_of_Chios_Mastic-7631.jpg'),
  soap: IMG('4/4c/Bars_of_pure_Marseille_and_Aleppo_soap%2C_2024.jpg'),
  cup: IMG('6/62/Freshly_brewed_cup_of_espresso_in_sunlight_on_kitchen_counter.jpg'),
  tote: IMG('c/c1/Canvas_two-tone_tote_Navy_and_Natural7_%289038437258%29.jpg'),
  salt: IMG('b/b8/Sea_Salt_-_Macro_%2851840172425%29.jpg'),
  tea: IMG('d/dc/Sideritis_scardica_IMG_4653.jpg'),
  loukoumi: IMG('f/fc/Rahat_cu_aroma_de_fructe.jpg'),
  tahini: IMG('3/39/Tahina.JPG'),
  pistachio: IMG('0/04/Pistachio.jpg'),
  candle: IMG('0/09/Candle_orange.jpg'),
  feta: IMG('5/59/Greek_feta.jpg'),
  shopKif: IMG('a/a9/Daisy_Fresh_Delicatessen_%28interior_view%29%2C_Settle_-_geograph.org.uk_-_3115170.jpg', 960),
  shopMar: IMG('d/d4/Moody%27s_Delicatessen_in_Waltham.jpg', 960),
  shopGly: IMG('9/95/Santorin_%28GR%29%2C_Akrotiri%2C_Supermarkt_--_2017_--_2877-83.jpg', 960),
  postArrivals: IMG('8/89/Spice_House%2C_Milwaukee%2C_store_shelves.jpg', 960),
  postOffer: IMG('4/45/Citrus_and_olive_stall_in_the_souk_of_Meknes_%28423901962%29.jpg', 960),
  postEvent: IMG('5/58/Mindful_wine_tasting_-_February_2023_-_Sarah_Stierch_02.jpg', 960),
  postHarvest: IMG('e/ed/Olive-Harvest-Sitia-Lasithi-Crete-Greece.jpg', 960),
};

// ------------------------------------------------------------------ org, shops, people

const ORG = 'org_lemoni';
const KIF = 'shop_kifisia';
const MAR = 'shop_marousi';
const GLY = 'shop_glyfada';
const NORTH = 'group_north';

const topology: Topology = { orgId: ORG, shops: [KIF, MAR, GLY], groups: { [NORTH]: [KIF, MAR] } };

let settings: OrgSettings = {
  id: ORG, name: 'Lemoni', slug: 'lemoni', country: 'GR', currency: 'EUR', timezone: 'Europe/Athens', defaultLocale: 'el',
  brandColor: '#B0234F', logoUrl: null, allowNegativeStock: true, postsNeedApproval: false, pushDailyCap: 2,
  quietHours: '22:00-09:00', customerCatalog: 'subscribers', customerPrices: true, customerStock: 'availability', fewLeftThreshold: 3,
};

const shops: Shop[] = [
  { id: KIF, orgId: ORG, name: 'Lemoni Kifisia', slug: 'kifisia', city: 'Κηφισιά', address: 'Κασσαβέτη 12', phone: '+302108011111', timezone: null, imageUrl: IMAGES.shopKif!, customerVisible: true, customerStock: null, groupIds: [NORTH] },
  { id: MAR, orgId: ORG, name: 'Lemoni Marousi', slug: 'marousi', city: 'Μαρούσι', address: 'Ερμού 4', phone: '+302108022222', timezone: null, imageUrl: IMAGES.shopMar!, customerVisible: true, customerStock: null, groupIds: [NORTH] },
  { id: GLY, orgId: ORG, name: 'Lemoni Glyfada', slug: 'glyfada', city: 'Γλυφάδα', address: 'Μεταξά 30', phone: '+302108033333', timezone: null, imageUrl: IMAGES.shopGly!, customerVisible: true, customerStock: null, groupIds: [] },
];
const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? id;

const roleNames: Record<string, Record<Locale, string>> = {
  owner: { en: 'Owner', el: 'Ιδιοκτήτης', ru: 'Владелец' },
  admin: { en: 'Admin', el: 'Διαχειριστής', ru: 'Администратор' },
  manager: { en: 'Manager', el: 'Υπεύθυνος καταστήματος', ru: 'Управляющий' },
  staff: { en: 'Staff', el: 'Προσωπικό', ru: 'Сотрудник' },
  viewer: { en: 'Viewer', el: 'Μόνο προβολή', ru: 'Только просмотр' },
};

const roles = DEFAULT_ROLES.map((r) => ({ id: `role_${r.key}`, templateKey: r.key, name: roleNames[r.key]!.en, rank: r.rank, locked: r.locked, permissions: [...r.permissions] }));
const roleById = (id: string) => roles.find((r) => r.id === id)!;

interface FxUser { id: string; email: string; name: string; locale: Locale; password?: string; assignments: { id: string; roleId: string; scopeType: ScopeType; scopeId: string }[] }

const users: FxUser[] = [
  { id: 'u_eleni', email: 'eleni@example.com', name: 'Eleni Papadopoulou', locale: 'el', password: 'custock', assignments: [{ id: 'ra1', roleId: 'role_owner', scopeType: 'org', scopeId: ORG }] },
  { id: 'u_nikos', email: 'nikos@example.com', name: 'Nikos Georgiou', locale: 'el', password: 'custock', assignments: [{ id: 'ra2', roleId: 'role_admin', scopeType: 'org', scopeId: ORG }] },
  { id: 'u_maria', email: 'maria@example.com', name: 'Maria Ioannou', locale: 'el', password: 'custock', assignments: [{ id: 'ra3', roleId: 'role_manager', scopeType: 'shop', scopeId: KIF }] },
  { id: 'u_dimitris', email: 'dimitris@example.com', name: 'Dimitris Kostas', locale: 'el', password: 'custock', assignments: [{ id: 'ra4', roleId: 'role_staff', scopeType: 'shop', scopeId: KIF }] },
  { id: 'u_sofia', email: 'sofia@example.com', name: 'Sofia Alexiou', locale: 'en', password: 'custock', assignments: [{ id: 'ra5', roleId: 'role_viewer', scopeType: 'org', scopeId: ORG }] },
  { id: 'u_anna', email: 'anna@example.com', name: 'Anna Petrova', locale: 'ru', assignments: [] },
];

function accessAssignments(u: FxUser): AccessAssignment[] {
  return u.assignments.map((a) => {
    const r = roleById(a.roleId);
    return { id: a.id, roleId: a.roleId, scopeType: a.scopeType, scopeId: a.scopeId, rank: r.rank, permissions: r.permissions };
  });
}

function orgAccess(u: FxUser): OrgAccess | null {
  if (!u.assignments.length) return null;
  return buildOrgAccess({
    org: { id: ORG, name: settings.name, slug: settings.slug, currency: settings.currency, timezone: settings.timezone, defaultLocale: settings.defaultLocale },
    roleNames: u.assignments.map((a) => roleById(a.roleId).name),
    permsVersion: 1,
    assignments: accessAssignments(u),
    topology,
    shopNames: Object.fromEntries(shops.map((s) => [s.id, s.name])),
  });
}

// ------------------------------------------------------------------ catalog

const categories: Category[] = [
  { id: 'cat_pantry', parentId: null, name: 'Κελάρι' },
  { id: 'cat_sweet', parentId: null, name: 'Γλυκά' },
  { id: 'cat_drinks', parentId: null, name: 'Ροφήματα' },
  { id: 'cat_home', parentId: null, name: 'Σπίτι' },
  { id: 'cat_deli', parentId: null, name: 'Αλλαντικά και τυριά' },
];

interface Seed { key: string; cat: string; el: string; en: string; ru: string; price: number; cost: number; uom?: 'piece' | 'kg'; variants?: { label: Record<string, string>; price: number; cost: number }[] }

const SEEDS: Seed[] = [
  { key: 'oil', cat: 'cat_pantry', el: 'Εξαιρετικό παρθένο ελαιόλαδο 500ml', en: 'Extra virgin olive oil 500ml', ru: 'Оливковое масло extra virgin 500 мл', price: 1290, cost: 720 },
  { key: 'honey', cat: 'cat_pantry', el: 'Θυμαρίσιο μέλι 450g', en: 'Thyme honey 450g', ru: 'Тимьяновый мёд 450 г', price: 1290, cost: 690 },
  { key: 'coffee', cat: 'cat_drinks', el: 'Ελληνικός καφές 194g', en: 'Greek coffee 194g', ru: 'Греческий кофе 194 г', price: 450, cost: 260 },
  { key: 'mastiha', cat: 'cat_sweet', el: 'Μαστίχα Χίου 10g', en: 'Chios mastiha 10g', ru: 'Мастика Хиоса 10 г', price: 690, cost: 380 },
  { key: 'soap', cat: 'cat_home', el: 'Σαπούνι ελαιολάδου', en: 'Olive oil soap', ru: 'Мыло на оливковом масле', price: 390, cost: 150 },
  { key: 'cup', cat: 'cat_home', el: 'Κεραμική κούπα', en: 'Ceramic cup', ru: 'Керамическая чашка', price: 1450, cost: 600, variants: [{ label: { size: 'S' }, price: 1450, cost: 600 }, { label: { size: 'L' }, price: 1850, cost: 780 }] },
  { key: 'tote', cat: 'cat_home', el: 'Λινή τσάντα', en: 'Linen tote', ru: 'Льняная сумка', price: 2400, cost: 1100, variants: [{ label: { color: 'natural' }, price: 2400, cost: 1100 }, { label: { color: 'black' }, price: 2400, cost: 1100 }] },
  { key: 'salt', cat: 'cat_pantry', el: 'Θαλασσινό αλάτι 250g', en: 'Sea salt 250g', ru: 'Морская соль 250 г', price: 350, cost: 120 },
  { key: 'tea', cat: 'cat_drinks', el: 'Τσάι του βουνού', en: 'Mountain tea', ru: 'Горный чай', price: 380, cost: 160 },
  { key: 'loukoumi', cat: 'cat_sweet', el: 'Λουκούμι τριαντάφυλλο', en: 'Rose loukoumi', ru: 'Лукум с розой', price: 560, cost: 260 },
  { key: 'tahini', cat: 'cat_pantry', el: 'Ταχίνι ολικής 300g', en: 'Wholegrain tahini 300g', ru: 'Тахини 300 г', price: 420, cost: 210 },
  { key: 'pistachio', cat: 'cat_sweet', el: 'Φιστίκια Αιγίνης 200g', en: 'Aegina pistachios 200g', ru: 'Фисташки Эгины 200 г', price: 890, cost: 520 },
  { key: 'candle', cat: 'cat_home', el: 'Κερί σόγιας', en: 'Soy candle', ru: 'Соевая свеча', price: 1600, cost: 640 },
  { key: 'feta', cat: 'cat_deli', el: 'Φέτα ΠΟΠ', en: 'Feta PDO', ru: 'Фета', price: 1290, cost: 780, uom: 'kg' },
];

interface FxVariant extends Variant { costMinor: number | null }
interface FxProduct extends Omit<Product, 'variants'> { variants: FxVariant[]; key: string; searchKey: string }

const products: FxProduct[] = SEEDS.map((s, i) => {
  const id = `prod_${s.key}`;
  const vs = (s.variants ?? [{ label: null as unknown as Record<string, string>, price: s.price, cost: s.cost }]).map((v, j) => {
    const code = ean13(`520123${String(i * 10 + j).padStart(6, '0')}`);
    return {
      id: `var_${s.key}_${j}`, productId: id, sku: `LEM-${s.key.toUpperCase()}${s.variants ? `-${j + 1}` : ''}`,
      options: s.variants ? v.label : null, priceMinor: v.price, costMinor: v.cost, isDefault: j === 0,
      barcodes: [{ id: `bc_${s.key}_${j}`, code, codeNorm: normalizeBarcode(code).codeNorm, symbology: 'ean13', packQty: 1 }],
    };
  });
  return {
    id, key: s.key, orgId: ORG, categoryId: s.cat, categoryName: categories.find((c) => c.id === s.cat)!.name,
    name: s.el, description: null, brand: null, uom: s.uom ?? 'piece', taxRateBp: s.key === 'soap' || s.key === 'cup' || s.key === 'tote' || s.key === 'candle' ? 2400 : 1300,
    trackStock: true, customerVisible: true, customerStockHidden: false,
    images: [{ id: `img_${s.key}`, url: IMAGES[s.key]!, width: 500, height: 500 }],
    variants: vs,
    translations: { en: { name: s.en, description: null }, ru: { name: s.ru, description: null }, el: { name: s.el, description: null } },
    archivedAt: null,
    searchKey: searchKey(s.el, s.en, s.ru),
  };
});

const variantIndex = new Map<string, { p: FxProduct; v: FxVariant }>();
for (const p of products) for (const v of p.variants) variantIndex.set(v.id, { p, v });

// on hand per shop and variant
const START: Record<string, [number, number, number]> = {
  oil: [24, 18, 9], honey: [0, 7, 2], coffee: [36, 40, 22], mastiha: [3, 12, 6], soap: [15, 8, -1], cup: [6, 4, 5],
  tote: [5, 2, 1], salt: [30, 25, 18], tea: [12, 2, 9], loukoumi: [20, 14, 0], tahini: [9, 11, 7], pistachio: [2, 9, 4],
  candle: [7, 3, 6], feta: [4200, 3100, 0],
};
const levels = new Map<string, StockLevel>();
const lk = (shopId: string, variantId: string) => `${shopId}|${variantId}`;
for (const p of products) {
  for (const v of p.variants) {
    const start = START[p.key]!;
    [KIF, MAR, GLY].forEach((shopId, i) => {
      const onHand = v.isDefault ? start[i]! : Math.max(0, Math.round(start[i]! / 2));
      levels.set(lk(shopId, v.id), { shopId, variantId: v.id, onHand, inTransitIn: 0, reorderPoint: p.uom === 'kg' ? 1000 : 3, lastMovementAt: now() - (i + 1) * 3_600_000, waiting: 0 });
    });
  }
}

const shopPrices = new Map<string, number>([[lk(KIF, 'var_honey_0'), 1250]]);

// ------------------------------------------------------------------ customers

interface FxCustomer { id: string; name: string; email: string; phone: string | null; locale: Locale; emailOk: boolean; pushOk: boolean; hasApp: boolean; source: Customer['source']; tags: string[]; subs: Subscription[]; createdAt: number; userId?: string; favorites: string[]; notes: { id: string; body: string; authorName: string; createdAt: number }[] }

const people: [string, Locale, string[], ScopeType, string][] = [
  ['Anna Petrova', 'ru', ['regulars'], 'org', ORG],
  ['Giorgos Pappas', 'el', ['regulars'], 'shop', KIF],
  ['Katerina Nikolaou', 'el', [], 'shop', KIF],
  ['Ivan Smirnov', 'ru', [], 'shop', MAR],
  ['Olga Ivanova', 'ru', ['wholesale'], 'group', NORTH],
  ['Christos Antoniou', 'el', [], 'shop', GLY],
  ['Eleftheria Vlachou', 'el', ['regulars'], 'shop', KIF],
  ['Dmitry Volkov', 'ru', [], 'org', ORG],
  ['Sophie Martin', 'en', [], 'shop', GLY],
  ['Panagiotis Dimas', 'el', [], 'shop', MAR],
  ['Natalia Sokolova', 'ru', ['regulars'], 'shop', KIF],
  ['Vasilis Karras', 'el', [], 'group', NORTH],
  ['Irini Lambrou', 'el', [], 'shop', KIF],
  ['Alexei Morozov', 'ru', [], 'shop', GLY],
  ['Maria Kyriakou', 'el', ['wholesale'], 'org', ORG],
  ['Thomas Weber', 'en', [], 'shop', KIF],
  ['Despina Georgiadou', 'el', [], 'shop', MAR],
  ['Elena Kuznetsova', 'ru', [], 'shop', KIF],
  ['Stavros Michail', 'el', [], 'shop', GLY],
  ['Lena Orlova', 'ru', [], 'group', NORTH],
];

const customers: FxCustomer[] = people.map(([name, locale, tags, scopeType, scopeId], i) => ({
  id: `cus_${i + 1}`,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}.${name.split(' ')[1]!.toLowerCase()}@example.com`,
  phone: i % 3 === 0 ? `+3069${String(40000000 + i * 7919).slice(0, 8)}` : null,
  locale,
  emailOk: i % 4 !== 2,
  pushOk: i % 3 !== 1,
  hasApp: i % 2 === 0,
  source: i % 5 === 3 ? 'staff' : 'join_link',
  tags,
  subs: [{ scopeType, scopeId, status: i === 12 ? 'pending' : 'subscribed' }],
  createdAt: now() - (i * 2 + 1) * DAY,
  userId: i === 0 ? 'u_anna' : undefined,
  favorites: i === 0 ? ['prod_pistachio'] : [],
  notes: i === 1 ? [{ id: 'n1', body: 'Ψάχνει πάντα το θυμαρίσιο μέλι.', authorName: 'Maria Ioannou', createdAt: now() - 3 * DAY }] : [],
}));

// 14 people waiting for the thyme honey (out in Kifisia)
interface FxAlert { id: string; customerId: string; variantId: string; shopId: string | null; status: 'waiting' | 'notified' }
const alerts: FxAlert[] = customers.slice(0, 14).map((c, i) => ({ id: `al_${i}`, customerId: c.id, variantId: 'var_honey_0', shopId: i % 3 === 0 ? null : KIF, status: 'waiting' }));
alerts.push({ id: 'al_x', customerId: 'cus_4', variantId: 'var_loukoumi_0', shopId: GLY, status: 'waiting' });

// stock in the shop people wait at (or all shops when they wait for any shop)
function onHandWhereWaited(variantId: string): number {
  const shopIds = [...new Set(alerts.filter((a) => a.status === 'waiting' && a.variantId === variantId).map((a) => a.shopId))];
  const shopsToSum = shopIds.includes(null) ? topology.shops : (shopIds as string[]);
  return shopsToSum.reduce((n, s) => n + (levels.get(lk(s, variantId))?.onHand ?? 0), 0);
}

function waitingFor(variantId: string, shopId?: string): number {
  return alerts.filter((a) => a.status === 'waiting' && a.variantId === variantId && (!shopId || a.shopId === null || a.shopId === shopId)).length;
}

// ------------------------------------------------------------------ movements and history

const movements: Movement[] = [];
function seedHistory() {
  const kinds: [MovementInput['kind'], number][] = [['receive', 12], ['sale', -1], ['sale', -2], ['sale', -1], ['adjust', -1], ['sale', -1]];
  let t = now() - 6 * DAY;
  for (const p of products.slice(0, 8)) {
    const v = p.variants[0]!;
    for (const [kind, d] of kinds) {
      t += 3_600_000 * 5;
      movements.push({
        id: uuidv7(t), orgId: ORG, shopId: KIF, variantId: v.id, qtyDelta: kind === 'receive' && p.uom === 'kg' ? 5000 : d, kind,
        reason: kind === 'adjust' ? 'damaged' : undefined, occurredAt: t, recordedAt: t,
        createdBy: kind === 'receive' ? 'u_maria' : 'u_dimitris', createdByName: kind === 'receive' ? 'Maria Ioannou' : 'Dimitris Kostas',
        unitPriceMinor: kind === 'sale' ? v.priceMinor ?? undefined : undefined,
      });
    }
  }
}
seedHistory();

// 14 days of sales for charts
const salesSeries = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(now() - (13 - i) * DAY);
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  return { day: d.toISOString().slice(0, 10), value: Math.round((weekend ? 42000 : 26000) + Math.sin(i * 1.7) * 6000) };
});

// ------------------------------------------------------------------ posts

interface FxPost extends Post { shopScopes: string[] }

function resolveShops(a: Audience): string[] {
  const set = new Set<string>();
  for (const s of a.scopes) {
    if (s.scopeType === 'org') topology.shops.forEach((x) => set.add(x));
    else if (s.scopeType === 'group') (topology.groups[s.scopeId] ?? []).forEach((x) => set.add(x));
    else set.add(s.scopeId);
  }
  return [...set];
}

function postProducts(items: { variantId: string; offerPriceMinor: number | null }[]): Post['products'] {
  return items.map((it) => {
    const { p, v } = variantIndex.get(it.variantId)!;
    return { variantId: v.id, productId: p.id, name: p.name, imageUrl: p.images[0]?.url ?? null, priceMinor: v.priceMinor, offerPriceMinor: it.offerPriceMinor, wasMinor: it.offerPriceMinor ? v.priceMinor : null };
  });
}

function makePost(id: string, input: PostInput, extra: Partial<FxPost>): FxPost {
  return {
    id, orgId: ORG, kind: input.kind, status: 'draft', defaultLocale: input.defaultLocale, translations: input.translations,
    channels: input.channels, audience: input.audience, products: postProducts(input.products), coverUrl: input.coverUrl,
    scheduledAt: input.scheduledAt, validFrom: input.validFrom, validUntil: input.validUntil,
    authorId: 'u_nikos', authorName: 'Nikos Georgiou', approvedBy: null, sentAt: null, recipientsCount: null, stats: null,
    createdAt: now(), shopScopes: resolveShops(input.audience), ...extra,
  };
}

// the offer text says "until sunday", so it ends at the end of the coming sunday
function endOfSunday(): number {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}

const orgAudience: Audience = { scopes: [{ scopeType: 'org', scopeId: ORG }], tags: [], interests: [], locales: [], savedAnyLinked: false, joinedWithinDays: null };

const posts: FxPost[] = [
  makePost('post_harvest', {
    kind: 'new_arrival', defaultLocale: 'el', channels: ['feed', 'push', 'email'], audience: orgAudience, coverUrl: IMAGES.postHarvest!, scheduledAt: null, validFrom: null, validUntil: null,
    products: [{ variantId: 'var_oil_0', offerPriceMinor: null }],
    translations: {
      el: { title: 'Το νέο ελαιόλαδο ήρθε', body: 'Η φετινή σοδειά από την Κρήτη είναι στα ράφια μας. Περάστε να το δοκιμάσετε.' },
      en: { title: 'The new olive oil is in', body: 'This year\'s harvest from Crete is on our shelves. Come and taste it.' },
      ru: { title: 'Новое оливковое масло уже здесь', body: 'Урожай этого года с Крита уже на полках. Заходите попробовать.' },
    },
  }, { status: 'sent', sentAt: now() - 2 * DAY, recipientsCount: 18, stats: { queued: 0, sent: 31, failed: 1, opened: 12, skipped: 4 }, createdAt: now() - 2 * DAY }),
  makePost('post_offer', {
    kind: 'offer', defaultLocale: 'el', channels: ['feed', 'push'], audience: orgAudience, coverUrl: IMAGES.postOffer!, scheduledAt: null, validFrom: now() - DAY, validUntil: endOfSunday(),
    products: [{ variantId: 'var_pistachio_0', offerPriceMinor: 690 }, { variantId: 'var_tahini_0', offerPriceMinor: 350 }],
    translations: {
      el: { title: 'Εβδομάδα Αιγίνης', body: 'Φιστίκια Αιγίνης και ταχίνι σε τιμή προσφοράς μέχρι την Κυριακή.' },
      en: { title: 'Aegina week', body: 'Aegina pistachios and tahini at offer prices until Sunday.' },
      ru: { title: 'Неделя Эгины', body: 'Фисташки Эгины и тахини по акции до воскресенья.' },
    },
  }, { status: 'sent', sentAt: now() - DAY, recipientsCount: 19, stats: { queued: 0, sent: 24, failed: 0, opened: 15, skipped: 2 }, createdAt: now() - DAY }),
  makePost('post_event', {
    kind: 'event', defaultLocale: 'el', channels: ['feed', 'push'], audience: { ...orgAudience, scopes: [{ scopeType: 'shop', scopeId: KIF }] }, coverUrl: IMAGES.postEvent!, scheduledAt: now() + 2 * DAY, validFrom: null, validUntil: null, products: [],
    translations: {
      el: { title: 'Γευσιγνωσία μελιού το Σάββατο', body: 'Πέντε μέλια από πέντε νησιά. Σάββατο στις 12:00 στην Κηφισιά.' },
      en: { title: 'Honey tasting on Saturday', body: 'Five honeys from five islands. Saturday at 12:00 in Kifisia.' },
    } as PostInput['translations'],
  }, { status: 'scheduled', createdAt: now() - 3_600_000 }),
  makePost('post_draft', {
    kind: 'news', defaultLocale: 'el', channels: ['feed'], audience: { ...orgAudience, scopes: [{ scopeType: 'shop', scopeId: KIF }] }, coverUrl: null, scheduledAt: null, validFrom: null, validUntil: null, products: [],
    translations: { el: { title: 'Νέο ωράριο τις Κυριακές', body: 'Από αυτή την Κυριακή είμαστε ανοιχτά 10:00 με 15:00.' } } as PostInput['translations'],
  }, { status: 'pending_approval', authorId: 'u_maria', authorName: 'Maria Ioannou', createdAt: now() - 2 * 3_600_000 }),
];

// ------------------------------------------------------------------ join links

const joinLinks: JoinLink[] = [
  { id: 'jl_window', code: 'KIF-WIN', scopeType: 'shop', scopeId: KIF, label: 'Window poster', url: 'https://custock.app/j/KIF-WIN', opens: 214, signups: 61, confirmed: 52, disabled: false },
  { id: 'jl_insta', code: 'LEM-IG', scopeType: 'org', scopeId: ORG, label: 'Instagram bio', url: 'https://custock.app/j/LEM-IG', opens: 388, signups: 44, confirmed: 37, disabled: false },
  { id: 'jl_receipt', code: 'MAR-RCP', scopeType: 'shop', scopeId: MAR, label: 'Receipt', url: 'https://custock.app/j/MAR-RCP', opens: 96, signups: 31, confirmed: 29, disabled: false },
];

// ------------------------------------------------------------------ helpers

function variantPrice(v: FxVariant, shopId?: string): number | null {
  if (shopId) {
    const o = shopPrices.get(lk(shopId, v.id));
    if (o !== undefined) return o;
  }
  return v.priceMinor;
}

function levelsFor(p: FxProduct): StockLevel[] {
  const out: StockLevel[] = [];
  for (const v of p.variants) for (const s of topology.shops) {
    const l = levels.get(lk(s, v.id))!;
    out.push({ ...l, waiting: waitingFor(v.id, s) });
  }
  return out;
}

function shapeProduct(p: FxProduct, access: OrgAccess | null, locale: Locale): Product & { levels: StockLevel[] } {
  const showCost = !!access && can(access, 'products.cost.view');
  const tr = p.translations?.[locale];
  return {
    ...p,
    name: tr?.name ?? p.name,
    variants: p.variants.map((v) => ({ ...v, costMinor: showCost ? v.costMinor : undefined })),
    levels: levelsFor(p),
  };
}

function shapeCustomer(c: FxCustomer, access: OrgAccess): Customer {
  const full = can(access, 'customers.contact.view');
  return {
    id: c.id, name: c.name, email: full ? c.email : maskEmail(c.email), phone: full ? c.phone : maskPhone(c.phone), contactMasked: !full,
    locale: c.locale, emailOk: c.emailOk, pushOk: c.pushOk, smsOk: false, hasApp: c.hasApp, source: c.source, tags: c.tags,
    subscriptions: c.subs, createdAt: c.createdAt,
  };
}

function customerReaches(c: FxCustomer, shopIds: string[]): boolean {
  return shopIds.some((s) => followsShop(c.subs, topology, s, true));
}

// stock counts in progress, shared by every phone like the rest of the data
const counts = new Map<string, StockCount>();

// ------------------------------------------------------------------ the fixture api

export function createFixtureApi(getToken: () => string | null, getLocale: () => Locale = () => 'el'): CustockApi {
  const loc = (): Locale => getLocale();

  function me(): FxUser {
    const token = getToken();
    const u = token?.startsWith('fx.') ? users.find((x) => x.id === token.slice(3)) : undefined;
    if (!u) throw new FixtureError(401, 'unauthorized');
    return u;
  }
  function access(): OrgAccess {
    const a = orgAccess(me());
    if (!a) throw new FixtureError(403, 'forbidden');
    return a;
  }
  function need(perm: string, shopId?: string | null) {
    if (!can(access(), perm, shopId)) throw new FixtureError(403, 'forbidden');
  }
  function visibleShops(a: OrgAccess, perm: string): string[] {
    return a.shops.filter((s) => s.perms.includes(perm)).map((s) => s.shopId);
  }
  function tokens(userId: string) {
    return { accessToken: `fx.${userId}`, refreshToken: `fxr.${userId}`, expiresAt: now() + 15 * 60_000 };
  }
  function myCustomer(): FxCustomer {
    const u = me();
    const c = customers.find((x) => x.userId === u.id || x.email === u.email);
    if (!c) throw new FixtureError(404, 'not_found');
    return c;
  }
  function publicProductFor(p: FxProduct, c: FxCustomer | null): PublicProduct {
    const v = p.variants[0]!;
    const tr = p.translations?.[loc()];
    const offerPost = posts.find((x) => x.kind === 'offer' && x.status === 'sent' && (x.validUntil ?? 0) > now() && x.products.some((pp) => pp.variantId === v.id));
    const offerItem = offerPost?.products.find((pp) => pp.variantId === v.id);
    const availability = shops.filter((s) => s.customerVisible).map((s) => {
      const mode = p.customerStockHidden ? 'off' : s.customerStock ?? settings.customerStock;
      const onHand = levels.get(lk(s.id, v.id))?.onHand ?? 0;
      const state = mode === 'off' ? null : onHand <= 0 ? 'out' : onHand <= (p.uom === 'kg' ? 1000 : settings.fewLeftThreshold) ? 'few' : 'in';
      return { shopId: s.id, shopName: s.name, state, qty: mode === 'exact' ? Math.max(0, onHand) : null } as PublicProduct['availability'][number];
    });
    return {
      id: p.id, orgId: ORG, orgName: settings.name, name: tr?.name ?? p.name, description: p.description, images: p.images,
      categoryName: p.categoryName, priceMinor: settings.customerPrices ? v.priceMinor : null, currency: settings.currency,
      offer: offerItem?.offerPriceMinor ? { postId: offerPost!.id, priceMinor: offerItem.offerPriceMinor, wasMinor: offerItem.wasMinor, validUntil: offerPost!.validUntil } : null,
      availability, variantId: v.id,
      waitingForIt: !!c && alerts.some((a) => a.customerId === c.id && a.variantId === v.id && a.status === 'waiting'),
      saved: !!c && c.favorites.includes(p.id),
    };
  }
  function shapePost(p: FxPost, l: Locale): Post {
    const { shopScopes: _s, ...rest } = p;
    void _s;
    return { ...rest, products: rest.products.map((pp) => ({ ...pp, name: variantIndex.get(pp.variantId)?.p.translations?.[l]?.name ?? pp.name })) };
  }
  function feedItem(p: FxPost, l: Locale): FeedItem {
    return { post: shapePost(p, l), orgName: settings.name, shopNames: p.shopScopes.length === 3 ? [] : p.shopScopes.map(shopName) };
  }

  const impl: Partial<CustockApi> = {
    async login(email, password) {
      await wait();
      const u = users.find((x) => x.email === email.trim().toLowerCase());
      if (!u || !u.password || u.password !== password) throw new FixtureError(401, 'unauthorized');

      return tokens(u.id);
    },
    async requestOtp(email) {
      await wait();
      return { sent: true, devCode: email ? '246810' : undefined };
    },
    async verifyOtp(email, code) {
      await wait();
      const u = users.find((x) => x.email === email.trim().toLowerCase());
      if (!u || code !== '246810') throw new FixtureError(401, 'unauthorized');
      return tokens(u.id);
    },
    async refresh(rt) {
      return tokens(rt.replace('fxr.', ''));
    },
    async logout() {},
    async me(): Promise<MeContext> {
      await wait(60);
      const u = me();
      const a = orgAccess(u);
      const c = customers.find((x) => x.userId === u.id);
      return {
        user: { id: u.id, email: u.email, displayName: u.name, locale: u.locale },
        orgs: a ? [a] : [],
        following: c ? [{ orgId: ORG, orgName: settings.name, customerId: c.id }] : [],
      };
    },

    async orgSettings() {
      await wait(60);
      access();
      return settings;
    },
    async updateOrgSettings(_org, patch) {
      need('org.settings.manage');
      settings = { ...settings, ...patch };
      return settings;
    },
    async shops() {
      await wait(60);
      const u = me();
      const a = orgAccess(u);
      if (!a) return shops;
      return shops.filter((s) => a.shops.some((x) => x.shopId === s.id));
    },
    async groups() {
      return [{ id: NORTH, name: 'North Athens', shopIds: [KIF, MAR] }];
    },
    async updateShop(_org, shopId, patch) {
      need('shop.settings.manage', shopId);
      const s = shops.find((x) => x.id === shopId)!;
      Object.assign(s, patch);
      return s;
    },

    async categories() {
      return categories;
    },
    async products(_org, query = {}) {
      await wait();
      need('products.view');
      const a = access();
      const shopsVisible = query.shopId ? [query.shopId] : visibleShops(a, 'stock.view');
      let list = products.filter((p) => !p.archivedAt && matches(p.searchKey, query.q ?? ''));
      if (query.categoryId) list = list.filter((p) => p.categoryId === query.categoryId);
      if (query.filter) {
        list = list.filter((p) => p.variants.some((v) => shopsVisible.some((s) => {
          const l = levels.get(lk(s, v.id))!;
          if (query.filter === 'out') return l.onHand === 0;
          if (query.filter === 'negative') return l.onHand < 0;
          if (query.filter === 'low') return l.onHand > 0 && l.onHand <= (l.reorderPoint ?? 3);
          return waitingFor(v.id, s) > 0;
        })));
      }
      me();
      return { items: list.map((p) => shapeProduct(p, a, loc())), nextCursor: null };
    },
    async product(_org, productId) {
      await wait();
      need('products.view');
      const p = products.find((x) => x.id === productId);
      if (!p) throw new FixtureError(404, 'not_found');
      return shapeProduct(p, access(), loc());
    },
    async createProduct(_org, input) {
      need('products.create');
      const id = `prod_${uuidv7().slice(-8)}`;
      const vId = `var_${id}`;
      const p: FxProduct = {
        id, key: id, orgId: ORG, categoryId: input.categoryId ?? null, categoryName: null, name: input.name, description: input.description ?? null, brand: input.brand ?? null,
        uom: input.uom ?? 'piece', taxRateBp: input.taxRateBp ?? 2400, trackStock: input.trackStock ?? true, customerVisible: true, customerStockHidden: false, images: [],
        variants: [{ id: vId, productId: id, sku: null, options: null, priceMinor: input.priceMinor ?? null, costMinor: input.costMinor ?? null, isDefault: true, barcodes: input.barcode ? [{ id: `bc_${id}`, code: input.barcode, codeNorm: normalizeBarcode(input.barcode).codeNorm, symbology: null, packQty: 1 }] : [] }],
        archivedAt: null, searchKey: searchKey(input.name),
      };
      products.push(p);
      variantIndex.set(vId, { p, v: p.variants[0]! });
      for (const s of topology.shops) levels.set(lk(s, vId), { shopId: s, variantId: vId, onHand: 0, inTransitIn: 0, reorderPoint: null, lastMovementAt: null, waiting: 0 });
      return shapeProduct(p, access(), loc());
    },
    async updateProduct(_org, productId, patch) {
      need('products.edit');
      const p = products.find((x) => x.id === productId)!;
      if (patch.priceMinor !== undefined) {
        need('products.price.edit');
        p.variants[0]!.priceMinor = patch.priceMinor;
      }
      if (patch.name) {
        p.name = patch.name;
        p.searchKey = searchKey(patch.name);
      }
      return shapeProduct(p, access(), loc());
    },
    async setShopPrice(_org, shopId, variantId, priceMinor) {
      need('prices.shop.edit', shopId);
      if (priceMinor === null) shopPrices.delete(lk(shopId, variantId));
      else shopPrices.set(lk(shopId, variantId), priceMinor);
    },
    async scan(_org, code, symbology) {
      await wait(80);
      need('products.view');
      const n = normalizeBarcode(code, symbology);
      for (const p of products) for (const v of p.variants) {
        const b = v.barcodes.find((x) => x.codeNorm === n.codeNorm);
        if (b) return { codeNorm: n.codeNorm, kind: n.kind, valid: n.valid, match: p.archivedAt ? 'archived' : 'variant', packQty: b.packQty, product: shapeProduct(p, access(), loc()), variantId: v.id };
      }
      return { codeNorm: n.codeNorm, kind: n.kind, valid: n.valid, match: 'unknown', packQty: 1, product: null, variantId: null };
    },
    async attachBarcode(_org, variantId, code, packQty = 1) {
      need('products.edit');
      const n = normalizeBarcode(code);
      const { v } = variantIndex.get(variantId)!;
      v.barcodes.push({ id: `bc_${uuidv7().slice(-6)}`, code: n.code, codeNorm: n.codeNorm, symbology: null, packQty });
    },
    async postMovements(_org, input): Promise<MovementBatchResult> {
      await wait(140);
      const u = me();
      const a = access();
      const result: MovementBatchResult = { accepted: [], duplicates: [], rejected: [], levels: [], backInStock: [], lowStock: [] };
      const permFor: Record<string, string> = { receive: 'stock.receive', sale: 'stock.sell', return: 'stock.return', adjust: 'stock.adjust', damage: 'stock.adjust', count: 'stock.count.approve', initial: 'stock.adjust', transfer_out: 'stock.transfer.send', transfer_in: 'stock.transfer.receive', reversal: 'stock.view' };
      for (const m of input) {
        if (movements.some((x) => x.id === m.id)) {
          result.duplicates.push(m.id);
          continue;
        }
        if (!can(a, permFor[m.kind]!, m.shopId)) {
          result.rejected.push({ id: m.id, code: 'forbidden' });
          continue;
        }
        const l = levels.get(lk(m.shopId, m.variantId));
        if (!l) {
          result.rejected.push({ id: m.id, code: 'not_found' });
          continue;
        }
        const before = l.onHand;
        if (!settings.allowNegativeStock && before + m.qtyDelta < 0) {
          result.rejected.push({ id: m.id, code: 'negative_stock_blocked' });
          continue;
        }
        l.onHand = before + m.qtyDelta;
        l.lastMovementAt = now();
        const { v } = variantIndex.get(m.variantId)!;
        movements.push({ ...m, orgId: ORG, createdBy: u.id, createdByName: u.name, recordedAt: now(), unitPriceMinor: m.kind === 'sale' ? m.unitPriceMinor ?? variantPrice(v, m.shopId) ?? undefined : m.unitPriceMinor });
        result.accepted.push(m.id);
        if (['receive', 'transfer_in', 'return'].includes(m.kind) && before <= 0 && l.onHand > 0) {
          const told = alerts.filter((x) => x.status === 'waiting' && x.variantId === m.variantId && (x.shopId === null || x.shopId === m.shopId));
          told.forEach((x) => (x.status = 'notified'));
          if (told.length) result.backInStock.push({ variantId: m.variantId, shopId: m.shopId, notified: told.length });
        }
        if (m.qtyDelta < 0 && l.reorderPoint !== null && before > l.reorderPoint && l.onHand <= l.reorderPoint) {
          result.lowStock.push({ variantId: m.variantId, shopId: m.shopId, onHand: l.onHand });
        }
      }
      const touched = new Set(input.map((m) => lk(m.shopId, m.variantId)));
      result.levels = [...touched].map((k) => {
        const l = levels.get(k)!;
        return { ...l, waiting: waitingFor(l.variantId, l.shopId) };
      });
      return result;
    },
    async movements(_org, query) {
      await wait();
      need('stock.history.view', query.shopId);
      const list = movements
        .filter((m) => (!query.shopId || m.shopId === query.shopId) && (!query.variantId || m.variantId === query.variantId))
        .sort((x, y) => y.recordedAt - x.recordedAt)
        .slice(0, query.limit ?? 50);
      return { items: list, nextCursor: null };
    },
    async unknownScans() {
      return [{ id: 'us1', code: '4006381333931', shopId: KIF, times: 3, scannedAt: now() - 5 * 3_600_000 }];
    },

    async customers(_org, query = {}) {
      await wait();
      need('customers.view');
      const a = access();
      const reach = query.shopId ? [query.shopId] : visibleShops(a, 'customers.view');
      const q = query.q?.trim().toLowerCase() ?? '';
      const list = customers
        .filter((c) => customerReaches(c, reach))
        .filter((c) => !q || matches(searchKey(c.name, c.email), q))
        .filter((c) => !query.tag || c.tags.includes(query.tag))
        .filter((c) => !query.locale || c.locale === query.locale)
        .sort((x, y) => y.createdAt - x.createdAt);
      return { items: list.map((c) => shapeCustomer(c, a)), nextCursor: null };
    },
    async customer(_org, id): Promise<CustomerDetail> {
      await wait();
      need('customers.view');
      const a = access();
      const c = customers.find((x) => x.id === id);
      if (!c) throw new FixtureError(404, 'not_found');
      return {
        ...shapeCustomer(c, a),
        consents: [
          { channel: 'email', granted: c.emailOk, textVersion: `${c.locale}-2026-11`, source: c.source === 'staff' ? 'staff' : 'join_page', createdAt: c.createdAt },
          { channel: 'push', granted: c.pushOk, textVersion: `${c.locale}-2026-11`, source: 'app', createdAt: c.createdAt + 3_600_000 },
        ],
        notes: c.notes,
        waitingFor: alerts.filter((x) => x.customerId === c.id && x.status === 'waiting').map((x) => ({ variantId: x.variantId, productName: variantIndex.get(x.variantId)!.p.name, shopId: x.shopId })),
        favorites: c.favorites.map((pid) => ({ productId: pid, productName: products.find((p) => p.id === pid)!.name })),
        deliveries: posts.filter((p) => p.status === 'sent').map((p) => ({ postId: p.id, channel: 'push', status: c.pushOk && c.hasApp ? 'sent' : 'skipped', createdAt: p.sentAt! })),
      };
    },
    async addCustomerNote(_org, id, body) {
      need('customers.edit');
      customers.find((x) => x.id === id)!.notes.unshift({ id: uuidv7(), body, authorName: me().name, createdAt: now() });
    },
    async setCustomerTags(_org, id, tags) {
      need('customers.edit');
      customers.find((x) => x.id === id)!.tags = tags;
    },
    async joinLinks() {
      need('joinlinks.manage');
      return joinLinks;
    },
    async createJoinLink(_org, input) {
      need('joinlinks.manage', input.scopeType === 'shop' ? input.scopeId : null);
      const code = `NEW-${uuidv7().slice(-4).toUpperCase()}`;
      const l: JoinLink = { id: `jl_${code}`, code, ...input, label: input.label ?? null, url: `https://custock.app/j/${code}`, opens: 0, signups: 0, confirmed: 0, disabled: false };
      joinLinks.push(l);
      return l;
    },

    async posts() {
      await wait();
      need('posts.view');
      const a = access();
      const mine = visibleShops(a, 'posts.view');
      return { items: posts.filter((p) => p.shopScopes.some((s) => mine.includes(s))).sort((x, y) => y.createdAt - x.createdAt).map((p) => shapePost(p, loc())), nextCursor: null };
    },
    async post(_org, id) {
      await wait();
      const p = posts.find((x) => x.id === id);
      if (!p) throw new FixtureError(404, 'not_found');
      return shapePost(p, loc());
    },
    async createPost(_org, input) {
      need('posts.create');
      const u = me();
      const p = makePost(`post_${uuidv7().slice(-8)}`, input, { authorId: u.id, authorName: u.name });
      posts.push(p);
      return shapePost(p, loc());
    },
    async updatePost(_org, id, input) {
      need('posts.create');
      const i = posts.findIndex((x) => x.id === id);
      posts[i] = makePost(id, input, { authorId: posts[i]!.authorId, authorName: posts[i]!.authorName });
      return shapePost(posts[i]!, loc());
    },
    async previewAudience(_org, audience, channels): Promise<AudiencePreview> {
      await wait(90);
      const shopIds = resolveShops(audience);
      const reached = customers.filter((c) => shopIds.some((s) => followsShop(c.subs, topology, s)))
        .filter((c) => !audience.tags.length || audience.tags.some((t) => c.tags.includes(t)))
        .filter((c) => !audience.locales.length || audience.locales.includes(c.locale));
      const byScope = audience.scopes.map((s) => ({
        ...s,
        name: s.scopeType === 'org' ? settings.name : s.scopeType === 'group' ? 'North Athens' : shopName(s.scopeId),
        count: reached.filter((c) => c.subs.some((x) => x.scopeType === s.scopeType && x.scopeId === s.scopeId)).length,
      }));
      const others = reached.length - byScope.reduce((n, s) => n + s.count, 0);
      if (others > 0) byScope.push({ scopeType: 'org', scopeId: ORG, name: settings.name, count: others });
      const byLocale: Record<string, number> = {};
      for (const c of reached) byLocale[c.locale] = (byLocale[c.locale] ?? 0) + 1;
      const pushOn = channels.includes('push');
      const emailOn = channels.includes('email');
      const hour = new Date().getHours();
      return {
        total: reached.length,
        byScope: byScope.filter((s) => s.count > 0),
        byLocale,
        push: {
          count: pushOn ? reached.filter((c) => c.pushOk && c.hasApp).length : 0,
          turnedOff: reached.filter((c) => !c.pushOk).length,
          noApp: reached.filter((c) => !c.hasApp).length,
          capReached: 0,
          heldForQuietHours: pushOn && (hour >= 22 || hour < 9),
        },
        email: {
          count: emailOn ? reached.filter((c) => c.emailOk).length : 0,
          unconfirmed: reached.filter((c) => c.subs.some((s) => s.status === 'pending')).length,
          suppressed: 0,
        },
      };
    },
    async publishPost(_org, id) {
      await wait(200);
      const p = posts.find((x) => x.id === id)!;
      const a = access();
      const canPublish = p.shopScopes.every((s) => can(a, 'posts.publish', s)) && !settings.postsNeedApproval;
      if (!canPublish) {
        p.status = 'pending_approval';
      } else if (p.scheduledAt && p.scheduledAt > now()) {
        p.status = 'scheduled';
      } else {
        p.status = 'sent';
        p.sentAt = now();
        p.recipientsCount = customers.filter((c) => p.shopScopes.some((s) => followsShop(c.subs, topology, s))).length;
        p.stats = { queued: 0, sent: p.recipientsCount, failed: 0, opened: 0, skipped: 0 };
      }
      return shapePost(p, loc());
    },
    async approvePost(_org, id) {
      const p = posts.find((x) => x.id === id)!;
      p.shopScopes.forEach((s) => need('posts.publish', s));
      p.approvedBy = me().id;
      p.status = 'sent';
      p.sentAt = now();
      return shapePost(p, loc());
    },
    async cancelPost(_org, id) {
      const p = posts.find((x) => x.id === id)!;
      p.status = 'cancelled';
      return shapePost(p, loc());
    },

    async members(): Promise<Member[]> {
      await wait();
      need('members.view');
      const actor = me();
      return users.filter((u) => u.assignments.length).map((u) => {
        const target = { userId: u.id, assignments: accessAssignments(u) };
        const scope = u.assignments[0]!;
        const res = canManageMember({ actor: { userId: actor.id, assignments: accessAssignments(actor) }, topology, target, scope });
        return {
          membershipId: `m_${u.id}`, userId: u.id, name: u.name, email: u.email, status: 'active',
          assignments: u.assignments.map((x) => ({ id: x.id, roleId: x.roleId, roleName: roleById(x.roleId).name, scopeType: x.scopeType, scopeId: x.scopeId, scopeName: x.scopeType === 'org' ? settings.name : shopName(x.scopeId) })),
          canManage: res.ok, manageBlockedBy: res.ok ? null : res.code,
        };
      });
    },
    async roles(): Promise<Role[]> {
      return roles.map((r) => ({ ...r, memberCount: users.filter((u) => u.assignments.some((a) => a.roleId === r.id)).length }));
    },
    async grantableRoles(_org, scopeType, scopeId) {
      const actor = me();
      return grantableRoles({ actor: { userId: actor.id, assignments: accessAssignments(actor) }, topology, scope: { scopeType, scopeId }, roles });
    },
    async invite(_org, input) {
      await wait(200);
      const actor = me();
      const role = roleById(input.roleId);
      const res = grantableRoles({ actor: { userId: actor.id, assignments: accessAssignments(actor) }, topology, scope: input, roles: [role] })[0]!;
      if (!res.ok) throw new FixtureError(403, res.blockedBy ?? 'forbidden');
      return { id: uuidv7(), devLink: `custock://invite/${uuidv7().slice(-10)}` };
    },
    async assignRole() {},
    async removeAssignment() {},
    async saveRole(_org, input) {
      need('roles.manage');
      const r = { id: input.id ?? `role_${uuidv7().slice(-6)}`, templateKey: null, name: input.name, rank: input.rank, locked: false, permissions: input.permissions };
      roles.push(r as never);
      return { ...r, memberCount: 0 };
    },

    async dashboard(_org, shopId): Promise<DashboardCards> {
      await wait();
      const a = access();
      const scope = shopId ? [shopId] : visibleShops(a, 'stock.view');
      let low = 0, out = 0, neg = 0, value = 0;
      for (const l of levels.values()) {
        if (!scope.includes(l.shopId)) continue;
        if (l.onHand < 0) neg++;
        else if (l.onHand === 0) out++;
        else if (l.onHand <= (l.reorderPoint ?? 3)) low++;
        const cost = variantIndex.get(l.variantId)!.v.costMinor ?? 0;
        const units = variantIndex.get(l.variantId)!.p.uom === 'kg' ? l.onHand / 1000 : l.onHand;
        value += Math.max(0, units) * cost;
      }
      const money = can(a, 'reports.financial.view');
      return {
        lowStock: low, outOfStock: out, negativeStock: neg,
        peopleWaiting: alerts.filter((x) => x.status === 'waiting' && (x.shopId === null || scope.includes(x.shopId))).length,
        newFollowersWeek: customers.filter((c) => c.createdAt > now() - 7 * DAY && customerReaches(c, scope)).length,
        scheduledPosts: posts.filter((p) => p.status === 'scheduled').length,
        pendingApprovals: can(a, 'posts.publish') ? posts.filter((p) => p.status === 'pending_approval').length : 0,
        countsInReview: 0, transfersOnTheWay: scope.includes(KIF) ? 1 : 0, unknownCodes: can(a, 'products.create') ? 1 : 0,
        stockValueCostMinor: money ? Math.round(value) : null,
        salesTodayMinor: money ? salesSeries[13]!.value : null,
      };
    },
    async salesSeries() {
      return salesSeries;
    },
    async topSellers() {
      const money = can(access(), 'reports.financial.view');
      return products.slice(0, 5).map((p, i) => ({ variantId: p.variants[0]!.id, name: p.translations?.[loc()]?.name ?? p.name, qty: 40 - i * 6, valueMinor: money ? (40 - i * 6) * (p.variants[0]!.priceMinor ?? 0) : null }));
    },
    async mostWanted() {
      const ids = [...new Set(alerts.filter((a) => a.status === 'waiting').map((a) => a.variantId))];
      return ids.map((id) => ({ variantId: id, name: variantIndex.get(id)!.p.translations?.[loc()]?.name ?? variantIndex.get(id)!.p.name, waiting: waitingFor(id), onHand: onHandWhereWaited(id) })).sort((x, y) => y.waiting - x.waiting);
    },
    async joinLinkStats() {
      return joinLinks.map((l) => ({ joinLinkId: l.id, label: l.label, opens: l.opens, signups: l.signups, confirmed: l.confirmed }));
    },
    async shrinkage() {
      const money = can(access(), 'reports.financial.view');
      return [
        { reason: 'damaged', qty: 6, valueMinor: money ? 2340 : null },
        { reason: 'expired', qty: 4, valueMinor: money ? 1680 : null },
        { reason: 'lost', qty: 2, valueMinor: money ? 1290 : null },
      ];
    },

    // customer side
    async feed() {
      await wait();
      const c = myCustomer();
      const followed = topology.shops.filter((s) => followsShop(c.subs, topology, s));
      const items = posts
        .filter((p) => p.status === 'sent' && p.shopScopes.some((s) => followed.includes(s)) && (!p.validUntil || p.validUntil > now()))
        .sort((x, y) => (y.sentAt ?? 0) - (x.sentAt ?? 0))
        .map((p) => feedItem(p, loc()));
      return { items, nextCursor: null };
    },
    async offers() {
      await wait();
      const c = myCustomer();
      const followed = topology.shops.filter((s) => followsShop(c.subs, topology, s));
      return posts
        .filter((p) => p.kind === 'offer' && p.status === 'sent' && (p.validUntil ?? 0) > now() && p.shopScopes.some((s) => followed.includes(s)))
        .sort((x, y) => (x.validUntil ?? 0) - (y.validUntil ?? 0))
        .map((p) => feedItem(p, loc()));
    },
    async catalog(_slug, query = {}) {
      await wait();
      if (settings.customerCatalog === 'off') return [];
      const c = myCustomer();
      return products
        .filter((p) => p.customerVisible && !p.archivedAt && matches(p.searchKey, query.q ?? ''))
        .filter((p) => !query.categoryId || p.categoryId === query.categoryId)
        .map((p) => publicProductFor(p, c));
    },
    async publicProduct(_slug, productId) {
      await wait();
      const p = products.find((x) => x.id === productId);
      if (!p) throw new FixtureError(404, 'not_found');
      let c: FxCustomer | null = null;
      try { c = myCustomer(); } catch { c = null; }
      return publicProductFor(p, c);
    },
    async notifyMe(variantId, shopId) {
      const c = myCustomer();
      if (!alerts.some((a) => a.customerId === c.id && a.variantId === variantId && a.status === 'waiting')) {
        alerts.push({ id: uuidv7(), customerId: c.id, variantId, shopId, status: 'waiting' });
      }
    },
    async setFavorite(productId, saved) {
      const c = myCustomer();
      c.favorites = saved ? [...new Set([...c.favorites, productId])] : c.favorites.filter((x) => x !== productId);
    },
    async followedShops() {
      await wait();
      const c = myCustomer();
      return shops.filter((s) => s.customerVisible && followsShop(c.subs, topology, s.id)).map((s) => ({ ...s, orgName: settings.name }));
    },
    async unfollow(scopeType, scopeId) {
      const c = myCustomer();
      const row = c.subs.find((s) => s.scopeType === scopeType && s.scopeId === scopeId);
      if (row) row.status = 'unsubscribed';
      else c.subs.push({ scopeType, scopeId, status: 'unsubscribed' });
    },
    async setChannel(_org, channel, on) {
      const c = myCustomer();
      if (channel === 'email') c.emailOk = on;
      else c.pushOk = on;
    },
    async exportMyData() {
      const c = myCustomer();
      return { customer: { name: c.name, email: c.email, locale: c.locale }, subscriptions: c.subs, favorites: c.favorites };
    },
    async deleteMyAccount() {
      const c = myCustomer();
      c.name = '';
      c.email = '';
    },

    // public
    async joinPage(code) {
      await wait();
      const l = joinLinks.find((x) => x.code.toUpperCase() === code.trim().toUpperCase());
      if (!l) throw new FixtureError(404, 'not_found');
      const scopeName = l.scopeType === 'org' ? settings.name : shopName(l.scopeId);
      const image = l.scopeType === 'shop' ? shops.find((s) => s.id === l.scopeId)?.imageUrl ?? null : IMAGES.postArrivals!;
      return { code: l.code, orgName: settings.name, scopeName, scopeType: l.scopeType, brandColor: settings.brandColor, logoUrl: null, imageUrl: image, disabled: l.disabled, interests: categories };
    },
    async join(code, input) {
      await wait(200);
      const l = joinLinks.find((x) => x.code.toUpperCase() === code.toUpperCase());
      if (!l) throw new FixtureError(404, 'not_found');
      let c = customers.find((x) => x.email === input.email.toLowerCase());
      if (!c) {
        c = { id: `cus_${customers.length + 1}`, name: input.name, email: input.email.toLowerCase(), phone: null, locale: input.locale, emailOk: false, pushOk: input.push, hasApp: true, source: 'join_link', tags: [], subs: [], createdAt: now(), favorites: [], notes: [] };
        customers.push(c);
      }
      const existing = c.subs.find((s) => s.scopeType === l.scopeType && s.scopeId === l.scopeId);
      if (existing) existing.status = 'subscribed';
      else c.subs.push({ scopeType: l.scopeType, scopeId: l.scopeId, status: 'subscribed' });
      if (input.emailNews) c.emailOk = true;
      l.signups++;
      return { pending: true, devConfirmLink: `custock://confirm/${l.code}` };
    },
    async confirmJoin(token) {
      const l = joinLinks.find((x) => token.endsWith(x.code));
      return { orgName: settings.name, scopeName: l ? (l.scopeType === 'org' ? settings.name : shopName(l.scopeId)) : settings.name };
    },
    async shelfProduct(code) {
      const n = normalizeBarcode(code);
      const p = products.find((x) => x.variants.some((v) => v.barcodes.some((b) => b.codeNorm === n.codeNorm)));
      if (!p) throw new FixtureError(404, 'not_found');
      return publicProductFor(p, null);
    },
    // ---------------------------------------------------------------- stage 2: what the app uses

    async updateMe(patch) {
      const u = me();
      if (patch.locale) u.locale = patch.locale;
      if (patch.displayName) u.name = patch.displayName;
    },
    async joinAsCustomer(code, input) {
      const u = me();
      const page = await impl.joinPage!(code);
      await impl.join!(code, { name: u.name, email: u.email, locale: u.locale, emailNews: input?.emailNews ?? false, push: input?.push ?? false, over15: true, interests: [] });
      const c = customers.find((x) => x.email === u.email);
      if (c) c.userId = u.id;
      return { orgName: page.orgName, scopeName: page.scopeName };
    },
    async follow(scopeType, scopeId) {
      const c = myCustomer();
      const row = c.subs.find((s) => s.scopeType === scopeType && s.scopeId === scopeId);
      if (row) row.status = 'subscribed';
      else c.subs.push({ scopeType, scopeId, status: 'subscribed' });
    },
    async alerts(): Promise<StockAlertItem[]> {
      const c = myCustomer();
      return alerts.filter((a) => a.customerId === c.id && a.status !== 'notified').map((a) => {
        const { p, v } = variantIndex.get(a.variantId)!;
        return {
          id: a.id, orgId: ORG, orgName: settings.name, variantId: v.id, productId: p.id, productName: p.translations?.[loc()]?.name ?? p.name,
          imageUrl: p.images[0]?.url ?? null, shopId: a.shopId, shopName: a.shopId ? shopName(a.shopId) : null, status: a.status, createdAt: now(), notifiedAt: null,
        };
      });
    },
    async cancelAlert(alertId) {
      const a = alerts.find((x) => x.id === alertId);
      if (a) a.status = 'notified';
    },
    async favorites() {
      const c = myCustomer();
      return products.filter((p) => c.favorites.includes(p.id)).map((p) => publicProductFor(p, c));
    },
    async counts(_org, query = {}) {
      return [...counts.values()].filter((c) => (!query.shopId || c.shopId === query.shopId) && (!query.status || c.status === query.status));
    },
    async stockCount(_org, id) {
      const c = counts.get(id);
      if (!c) throw new FixtureError(404, 'not_found');
      return c;
    },
    async startCount(_org, shopId, input) {
      need('stock.count', shopId);
      const open = [...counts.values()].find((c) => c.shopId === shopId && c.status === 'open');
      if (open) return open;
      const c: StockCount = { id: `cnt_${uuidv7().slice(-8)}`, shopId, kind: input.kind, filter: input.filter ?? null, status: 'open', startedBy: me().id, startedAt: now(), submittedAt: null, appliedBy: null, appliedAt: null, uncountedPolicy: null, lines: [] };
      counts.set(c.id, c);
      return c;
    },
    async setCountLine(_org, countId, variantId, countedQty, mode = 'set') {
      const c = counts.get(countId)!;
      need('stock.count', c.shopId);
      const { p } = variantIndex.get(variantId)!;
      const expected = levels.get(lk(c.shopId, variantId))?.onHand ?? 0;
      const prev = c.lines.find((l) => l.variantId === variantId);
      const counted = mode === 'add' ? (prev?.countedQty ?? 0) + countedQty : countedQty;
      const showCost = can(access(), 'products.cost.view');
      const line: StockCountLine = {
        variantId, productId: p.id, name: p.translations?.[loc()]?.name ?? p.name, countedQty: counted, expectedQty: expected, difference: counted - expected,
        differenceCostMinor: showCost ? (counted - expected) * (variantIndex.get(variantId)!.v.costMinor ?? 0) : null,
        countedBy: me().id, countedByName: me().name, countedAt: now(),
      };
      c.lines = [line, ...c.lines.filter((l) => l.variantId !== variantId)];
      return line;
    },
    async submitCount(_org, countId) {
      const c = counts.get(countId)!;
      need('stock.count', c.shopId);
      c.status = 'review';
      c.submittedAt = now();
      return c;
    },
    async applyCount(_org, countId, policy = 'ignore') {
      const c = counts.get(countId)!;
      need('stock.count.approve', c.shopId);
      const moves = c.lines.filter((l) => l.difference !== 0).map((l) => ({ id: uuidv7(), shopId: c.shopId, variantId: l.variantId, qtyDelta: l.difference, kind: 'count' as const, refType: 'count', refId: c.id, occurredAt: now() }));
      if (moves.length) await impl.postMovements!(ORG, moves);
      c.status = 'applied';
      c.appliedAt = now();
      c.appliedBy = me().id;
      c.uncountedPolicy = policy;
      return c;
    },
    async cancelCount(_org, countId) {
      const c = counts.get(countId)!;
      c.status = 'cancelled';
      return c;
    },
    async transfers() {
      return [];
    },
  };

  // anything the demo data does not cover answers "not found", like a server without that data
  return new Proxy(impl as CustockApi, {
    get(target, prop) {
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (v !== undefined) return v;
      // not a promise, and not a method for symbols (console, inspectors)
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return async () => {
        throw new FixtureError(404, 'not_found');
      };
    },
  });
}


// the demo accounts, shown on the sign in screen when the app runs on fixtures
export const DEMO_ACCOUNTS = users.map((u) => ({
  email: u.email,
  name: u.name,
  role: u.assignments[0] ? roleById(u.assignments[0].roleId).templateKey : 'customer',
  scope: u.assignments[0] ? (u.assignments[0].scopeType === 'org' ? 'org' : shopName(u.assignments[0].scopeId)) : null,
  otp: !u.password,
}));

export const FIXTURE_OTP = '246810';
