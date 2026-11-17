// made up data for lemoni, a deli and home goods business with three shops.
// used when the real api is not running. same shapes as the real client, in memory only.

import type {
  AuditEntry, DevOutboxItem, Invite, StockCount, StockCountLine, Transfer, UncountedPolicy,
  Audience, AudiencePreview, Category, Customer, CustomerDetail, CustockApi, DashboardCards, FeedItem,
  GrantableRole, JoinInput, JoinLink, JoinPage, Locale, MeContext, Member, Movement, MovementBatchResult,
  MovementInput, OrgAccess, OrgSettings, Page, Post, PostInput, Product, ProductInput, PublicProduct, Role,
  ScanResult, ScopeType, SeriesPoint, Shop, ShopGroup, StockLevel, Tokens, Variant,
} from '@custock/core';
import { ALL_PERMISSIONS } from './perms';
import { matches, searchKey } from '@custock/core';

const DAY = 86_400_000;
const NOW = Date.now();
const ORG = 'org-lemoni';

const IMG = {
  oil: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fa/Extra_Virgin_Cretan_Olive_Oil.JPG/500px-Extra_Virgin_Cretan_Olive_Oil.JPG',
  honey: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/34/Dipper_stick_and_honey_in_a_jar.jpg/500px-Dipper_stick_and_honey_in_a_jar.jpg',
  coffee: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d1/Cafe_grec_i_licor_de_roses1.jpg/500px-Cafe_grec_i_licor_de_roses1.jpg',
  mastiha: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/36/A_jar_of_Chios_Mastic-7631.jpg/500px-A_jar_of_Chios_Mastic-7631.jpg',
  soap: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4c/Bars_of_pure_Marseille_and_Aleppo_soap%2C_2024.jpg/500px-Bars_of_pure_Marseille_and_Aleppo_soap%2C_2024.jpg',
  cup: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/62/Freshly_brewed_cup_of_espresso_in_sunlight_on_kitchen_counter.jpg/500px-Freshly_brewed_cup_of_espresso_in_sunlight_on_kitchen_counter.jpg',
  tote: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c1/Canvas_two-tone_tote_Navy_and_Natural7_%289038437258%29.jpg/500px-Canvas_two-tone_tote_Navy_and_Natural7_%289038437258%29.jpg',
  salt: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b8/Sea_Salt_-_Macro_%2851840172425%29.jpg/500px-Sea_Salt_-_Macro_%2851840172425%29.jpg',
  tea: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dc/Sideritis_scardica_IMG_4653.jpg/500px-Sideritis_scardica_IMG_4653.jpg',
  loukoumi: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fc/Rahat_cu_aroma_de_fructe.jpg/500px-Rahat_cu_aroma_de_fructe.jpg',
  tahini: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/39/Tahina.JPG/500px-Tahina.JPG',
  pistachio: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/04/Pistachio.jpg/500px-Pistachio.jpg',
  candle: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/09/Candle_orange.jpg/500px-Candle_orange.jpg',
  feta: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/59/Greek_feta.jpg/500px-Greek_feta.jpg',
  kifisia: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a9/Daisy_Fresh_Delicatessen_%28interior_view%29%2C_Settle_-_geograph.org.uk_-_3115170.jpg/960px-Daisy_Fresh_Delicatessen_%28interior_view%29%2C_Settle_-_geograph.org.uk_-_3115170.jpg',
  marousi: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d4/Moody%27s_Delicatessen_in_Waltham.jpg/960px-Moody%27s_Delicatessen_in_Waltham.jpg',
  glyfada: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/95/Santorin_%28GR%29%2C_Akrotiri%2C_Supermarkt_--_2017_--_2877-83.jpg/960px-Santorin_%28GR%29%2C_Akrotiri%2C_Supermarkt_--_2017_--_2877-83.jpg',
  arrivals: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/89/Spice_House%2C_Milwaukee%2C_store_shelves.jpg/960px-Spice_House%2C_Milwaukee%2C_store_shelves.jpg',
  offer: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/45/Citrus_and_olive_stall_in_the_souk_of_Meknes_%28423901962%29.jpg/960px-Citrus_and_olive_stall_in_the_souk_of_Meknes_%28423901962%29.jpg',
  event: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/58/Mindful_wine_tasting_-_February_2023_-_Sarah_Stierch_02.jpg/960px-Mindful_wine_tasting_-_February_2023_-_Sarah_Stierch_02.jpg',
  harvest: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ed/Olive-Harvest-Sitia-Lasithi-Crete-Greece.jpg/960px-Olive-Harvest-Sitia-Lasithi-Crete-Greece.jpg',
};

// ---------------------------------------------------------------- helpers

export function ean13(body12: string): string {
  const digits = body12.split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return body12 + ((10 - (sum % 10)) % 10);
}

const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

class FixtureError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

// ---------------------------------------------------------------- org, shops, groups

const settings: OrgSettings = {
  id: ORG, name: 'Lemoni', slug: 'lemoni', country: 'GR', currency: 'EUR', timezone: 'Europe/Athens',
  defaultLocale: 'el', brandColor: '#B0234F', logoUrl: null, allowNegativeStock: true, postsNeedApproval: false,
  pushDailyCap: 2, quietHours: '22:00-09:00', customerCatalog: 'public', customerPrices: true,
  customerStock: 'availability', fewLeftThreshold: 3,
};

const shops: Shop[] = [
  { id: 'shop-kifisia', orgId: ORG, name: 'Kifisia', slug: 'kifisia', city: 'Κηφισιά', address: 'Κασσαβέτη 12', phone: '+30 210 800 0001', timezone: null, imageUrl: IMG.kifisia, customerVisible: true, customerStock: null, groupIds: ['grp-north'] },
  { id: 'shop-marousi', orgId: ORG, name: 'Marousi', slug: 'marousi', city: 'Μαρούσι', address: 'Βασ. Σοφίας 41', phone: '+30 210 800 0002', timezone: null, imageUrl: IMG.marousi, customerVisible: true, customerStock: null, groupIds: ['grp-north'] },
  { id: 'shop-glyfada', orgId: ORG, name: 'Glyfada', slug: 'glyfada', city: 'Γλυφάδα', address: 'Μεταξά 7', phone: '+30 210 800 0003', timezone: null, imageUrl: IMG.glyfada, customerVisible: true, customerStock: null, groupIds: [] },
];

const groups: ShopGroup[] = [{ id: 'grp-north', name: 'North Athens', shopIds: ['shop-kifisia', 'shop-marousi'] }];

const categories: Category[] = [
  { id: 'cat-pantry', parentId: null, name: 'Κελάρι' },
  { id: 'cat-oil', parentId: 'cat-pantry', name: 'Λάδι και ξίδι' },
  { id: 'cat-sweet', parentId: 'cat-pantry', name: 'Γλυκά και μέλι' },
  { id: 'cat-drinks', parentId: 'cat-pantry', name: 'Καφές και τσάι' },
  { id: 'cat-deli', parentId: null, name: 'Αλλαντικά και τυριά' },
  { id: 'cat-home', parentId: null, name: 'Σπίτι' },
];
const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null;

// ---------------------------------------------------------------- roles and people

const ORG_LEVEL = new Set(['org.settings.manage', 'org.billing.manage', 'org.audit.view', 'org.support_access.manage', 'shops.create', 'shops.archive', 'groups.manage', 'roles.manage', 'categories.manage', 'products.price.edit', 'customers.import', 'customers.erase']);
const ANY_LEVEL = new Set(['products.view', 'products.create', 'products.edit', 'products.archive', 'products.import', 'products.cost.view', 'products.cost.edit']);

const all = [...ALL_PERMISSIONS];
const roles: Role[] = [
  { id: 'role-owner', templateKey: 'owner', name: 'owner', rank: 100, locked: true, permissions: all, memberCount: 1 },
  { id: 'role-admin', templateKey: 'admin', name: 'admin', rank: 80, locked: false, permissions: all.filter((p) => p !== 'org.billing.manage' && p !== 'org.support_access.manage'), memberCount: 1 },
  {
    id: 'role-manager', templateKey: 'manager', name: 'manager', rank: 60, locked: false, memberCount: 1,
    permissions: ['members.view', 'members.invite', 'members.manage', 'shop.settings.manage', 'products.view', 'products.create', 'products.edit', 'prices.shop.edit',
      'stock.view', 'stock.history.view', 'stock.receive', 'stock.sell', 'stock.return', 'stock.adjust', 'stock.count', 'stock.count.approve', 'stock.transfer.send', 'stock.transfer.receive', 'stock.settings.manage',
      'customers.view', 'customers.contact.view', 'customers.add', 'customers.edit', 'posts.view', 'posts.create', 'posts.publish', 'posts.channel.push', 'posts.channel.email',
      'offers.price.set', 'joinlinks.manage', 'reports.view', 'reports.staff.view'],
  },
  { id: 'role-staff', templateKey: 'staff', name: 'staff', rank: 40, locked: false, memberCount: 2, permissions: ['products.view', 'stock.view', 'stock.receive', 'stock.sell', 'stock.return', 'stock.count', 'stock.transfer.receive', 'customers.view', 'customers.add', 'posts.view'] },
  { id: 'role-viewer', templateKey: 'viewer', name: 'viewer', rank: 20, locked: false, memberCount: 1, permissions: ['products.view', 'products.cost.view', 'stock.view', 'stock.history.view', 'customers.view', 'posts.view', 'reports.view', 'reports.financial.view'] },
];

interface Person { userId: string; membershipId: string; name: string; email: string; locale: Locale; assignments: { id: string; roleId: string; scopeType: ScopeType; scopeId: string }[] }

const people: Person[] = [
  { userId: 'u-eleni', membershipId: 'm-eleni', name: 'Eleni Papadopoulou', email: 'eleni@example.com', locale: 'el', assignments: [{ id: 'a1', roleId: 'role-owner', scopeType: 'org', scopeId: ORG }] },
  { userId: 'u-nikos', membershipId: 'm-nikos', name: 'Nikos Georgiou', email: 'nikos@example.com', locale: 'el', assignments: [{ id: 'a2', roleId: 'role-admin', scopeType: 'org', scopeId: ORG }] },
  { userId: 'u-maria', membershipId: 'm-maria', name: 'Maria Ioannou', email: 'maria@example.com', locale: 'el', assignments: [{ id: 'a3', roleId: 'role-manager', scopeType: 'shop', scopeId: 'shop-kifisia' }, { id: 'a4', roleId: 'role-staff', scopeType: 'shop', scopeId: 'shop-marousi' }] },
  { userId: 'u-giorgos', membershipId: 'm-giorgos', name: 'Giorgos Antoniou', email: 'giorgos@example.com', locale: 'el', assignments: [{ id: 'a7', roleId: 'role-manager', scopeType: 'shop', scopeId: 'shop-glyfada' }] },
  { userId: 'u-dimitris', membershipId: 'm-dimitris', name: 'Dimitris Kostas', email: 'dimitris@example.com', locale: 'el', assignments: [{ id: 'a5', roleId: 'role-staff', scopeType: 'shop', scopeId: 'shop-kifisia' }] },
  { userId: 'u-katerina', membershipId: 'm-katerina', name: 'Katerina Vlachou', email: 'katerina@example.com', locale: 'el', assignments: [{ id: 'a8', roleId: 'role-staff', scopeType: 'shop', scopeId: 'shop-marousi' }] },
  { userId: 'u-sofia', membershipId: 'm-sofia', name: 'Sofia Alexiou', email: 'sofia@example.com', locale: 'en', assignments: [{ id: 'a6', roleId: 'role-viewer', scopeType: 'org', scopeId: ORG }] },
];

const customerUser = { userId: 'u-anna', email: 'anna@example.com', name: 'Anna Petrova', locale: 'ru' as Locale };

function covers(scopeType: ScopeType, scopeId: string, shopId: string): boolean {
  if (scopeType === 'org') return true;
  if (scopeType === 'shop') return scopeId === shopId;
  return groups.find((g) => g.id === scopeId)?.shopIds.includes(shopId) ?? false;
}

function access(person: Person): OrgAccess {
  const orgPerms = new Set<string>();
  const anyPerms = new Set<string>();
  const roleNames = new Set<string>();
  for (const a of person.assignments) {
    const role = roles.find((r) => r.id === a.roleId)!;
    roleNames.add(role.templateKey ?? role.name);
    for (const p of role.permissions) {
      if (a.scopeType === 'org') orgPerms.add(p);
      if (ANY_LEVEL.has(p)) anyPerms.add(p);
    }
  }
  const shopAccess = shops
    .map((s) => {
      const perms = new Set<string>();
      let rank = 0;
      for (const a of person.assignments) {
        if (!covers(a.scopeType, a.scopeId, s.id)) continue;
        const role = roles.find((r) => r.id === a.roleId)!;
        rank = Math.max(rank, role.rank);
        for (const p of role.permissions) if (!ORG_LEVEL.has(p) || a.scopeType === 'org') perms.add(p);
      }
      return { shopId: s.id, name: s.name, perms: [...perms], rank };
    })
    .filter((s) => s.rank > 0);
  return {
    orgId: ORG, name: settings.name, slug: settings.slug, currency: settings.currency, timezone: settings.timezone,
    defaultLocale: settings.defaultLocale, roleNames: [...roleNames], orgPerms: [...orgPerms].filter((p) => ORG_LEVEL.has(p) || true),
    anyPerms: [...anyPerms], shops: shopAccess, permsVersion: 1,
  };
}

// ---------------------------------------------------------------- catalog

interface Seed {
  id: string; name: string; en: string; ru: string; cat: string; img: string; price: number; cost: number;
  uom?: 'piece' | 'kg'; brand?: string; desc?: string; variants?: { opt: Record<string, string>; price: number }[];
  stock: [number, number, number]; reorder?: number; internal?: boolean;
}

const seeds: Seed[] = [
  { id: 'oil', name: 'Εξαιρετικό παρθένο ελαιόλαδο 500ml', en: 'Extra virgin olive oil 500ml', ru: 'Оливковое масло extra virgin 500 мл', cat: 'cat-oil', img: IMG.oil, price: 1290, cost: 780, brand: 'Λιόφυτο Σητείας', desc: 'Πρώιμη συγκομιδή από την Κρήτη, ψυχρής έκθλιψης.', stock: [24, 18, 9], reorder: 6 },
  { id: 'honey', name: 'Θυμαρίσιο μέλι 450g', en: 'Thyme honey 450g', ru: 'Тимьяновый мёд 450 г', cat: 'cat-sweet', img: IMG.honey, price: 1290, cost: 750, brand: 'Μελισσοκομία Νάξου', desc: 'Ωμό θυμαρίσιο μέλι, όπως βγαίνει από την κηρήθρα.', stock: [0, 7, 2], reorder: 4 },
  { id: 'coffee', name: 'Ελληνικός καφές 200g', en: 'Greek coffee 200g', ru: 'Греческий кофе 200 г', cat: 'cat-drinks', img: IMG.coffee, price: 450, cost: 240, stock: [3, 22, 15], reorder: 5 },
  { id: 'mastiha', name: 'Μαστίχα Χίου 10g', en: 'Chios mastic 10g', ru: 'Хиосская мастика 10 г', cat: 'cat-sweet', img: IMG.mastiha, price: 890, cost: 520, stock: [11, 0, 6] },
  { id: 'soap', name: 'Σαπούνι ελαιολάδου', en: 'Olive oil soap', ru: 'Мыло на оливковом масле', cat: 'cat-home', img: IMG.soap, price: 380, cost: 150, stock: [40, 32, 28] },
  { id: 'cup', name: 'Κεραμική κούπα', en: 'Ceramic cup', ru: 'Керамическая чашка', cat: 'cat-home', img: IMG.cup, price: 1450, cost: 700, variants: [{ opt: { size: 'S' }, price: 1450 }, { opt: { size: 'L' }, price: 1650 }], stock: [6, 4, 3] },
  { id: 'tote', name: 'Λινή τσάντα', en: 'Linen tote', ru: 'Льняная сумка', cat: 'cat-home', img: IMG.tote, price: 1900, cost: 900, variants: [{ opt: { color: 'natural' }, price: 1900 }, { opt: { color: 'black' }, price: 1900 }], stock: [8, 5, 2] },
  { id: 'salt', name: 'Θαλασσινό αλάτι 250g', en: 'Sea salt 250g', ru: 'Морская соль 250 г', cat: 'cat-pantry', img: IMG.salt, price: 350, cost: 120, stock: [19, 12, -2] },
  { id: 'tea', name: 'Τσάι του βουνού', en: 'Greek mountain tea', ru: 'Греческий горный чай', cat: 'cat-drinks', img: IMG.tea, price: 390, cost: 180, stock: [14, 9, 11] },
  { id: 'loukoumi', name: 'Λουκούμι τριαντάφυλλο', en: 'Rose loukoumi', ru: 'Лукум с розой', cat: 'cat-sweet', img: IMG.loukoumi, price: 650, cost: 320, stock: [12, 10, 7], internal: true },
  { id: 'tahini', name: 'Ταχίνι ολικής 300g', en: 'Wholegrain tahini 300g', ru: 'Тахини цельнозерновое 300 г', cat: 'cat-pantry', img: IMG.tahini, price: 480, cost: 250, stock: [9, 2, 13], reorder: 3 },
  { id: 'pistachio', name: 'Φιστίκι Αιγίνης 250g', en: 'Aegina pistachios 250g', ru: 'Фисташки с Эгины 250 г', cat: 'cat-pantry', img: IMG.pistachio, price: 990, cost: 610, stock: [16, 11, 8] },
  { id: 'candle', name: 'Κερί σόγιας με λεμόνι', en: 'Lemon soy candle', ru: 'Соевая свеча с лимоном', cat: 'cat-home', img: IMG.candle, price: 1800, cost: 760, stock: [5, 3, 1], internal: true },
  { id: 'feta', name: 'Φέτα ΠΟΠ', en: 'Feta PDO', ru: 'Фета PDO', cat: 'cat-deli', img: IMG.feta, price: 1490, cost: 980, uom: 'kg', stock: [4200, 2800, 3500], reorder: 2000 },
];

interface ProductRow extends Product { key: string; shopPrices: Record<string, number> }

let barcodeSeq = 1;
const products: ProductRow[] = seeds.map((s, i) => {
  const variantsSeed = s.variants ?? [{ opt: null as unknown as Record<string, string>, price: s.price }];
  const variants: Variant[] = variantsSeed.map((v, j) => {
    const code = s.internal
      ? ean13(`20${String(1000 + barcodeSeq++).padStart(10, '0')}`)
      : ean13(`520004417${String(i).padStart(2, '0')}${j}`);
    return {
      id: `v-${s.id}-${j}`,
      productId: `p-${s.id}`,
      sku: `LEM-${s.id.toUpperCase()}${variantsSeed.length > 1 ? '-' + Object.values(v.opt ?? {}).join('').toUpperCase() : ''}`,
      options: v.opt ?? null,
      priceMinor: v.price,
      costMinor: s.cost,
      isDefault: j === 0,
      barcodes: [{ id: `b-${s.id}-${j}`, code, codeNorm: code.padStart(14, '0'), symbology: s.internal ? 'internal' : 'ean13', packQty: 1 }],
    };
  });
  return {
    id: `p-${s.id}`, orgId: ORG, categoryId: s.cat, categoryName: catName(s.cat), name: s.name,
    description: s.desc ?? null, brand: s.brand ?? null, uom: s.uom ?? 'piece', taxRateBp: 1300,
    trackStock: true, customerVisible: true, customerStockHidden: false,
    images: [{ id: `img-${s.id}`, url: s.img, width: 500, height: 375 }],
    variants, translations: { en: { name: s.en, description: null }, ru: { name: s.ru, description: null } },
    archivedAt: null, key: searchKey(s.name, s.en, s.ru, s.brand), shopPrices: {},
  };
});
products.find((p) => p.id === 'p-tote')!.taxRateBp = 2400;
products.find((p) => p.id === 'p-cup')!.taxRateBp = 2400;
products.find((p) => p.id === 'p-candle')!.taxRateBp = 2400;
products.find((p) => p.id === 'p-soap')!.taxRateBp = 2400;
products.find((p) => p.id === 'p-oil')!.shopPrices['shop-glyfada'] = 1250;

const levels: StockLevel[] = [];
seeds.forEach((s) => {
  const product = products.find((p) => p.id === `p-${s.id}`)!;
  product.variants.forEach((v, j) => {
    shops.forEach((shop, k) => {
      const base = s.stock[k]!;
      const onHand = product.variants.length > 1 ? Math.max(0, Math.round(base / product.variants.length) + (j === 0 ? 1 : -1)) : base;
      levels.push({ shopId: shop.id, variantId: v.id, onHand, inTransitIn: 0, reorderPoint: s.reorder ?? null, lastMovementAt: NOW - (k + j + 1) * 3_600_000, waiting: 0 });
    });
  });
});
const lvl = (shopId: string, variantId: string) => levels.find((l) => l.shopId === shopId && l.variantId === variantId)!;
lvl('shop-kifisia', 'v-honey-0').waiting = 14;
lvl('shop-marousi', 'v-mastiha-0').waiting = 3;
lvl('shop-kifisia', 'v-coffee-0').inTransitIn = 12;

const movements: Movement[] = [];
function seedMovement(daysAgo: number, shopId: string, variantId: string, qtyDelta: number, kind: Movement['kind'], by: Person, extra: Partial<Movement> = {}) {
  const at = NOW - daysAgo * DAY - Math.floor(Math.random() * 6) * 3_600_000;
  movements.push({ id: uid(), orgId: ORG, shopId, variantId, qtyDelta, kind, occurredAt: at, recordedAt: at, createdBy: by.userId, createdByName: by.name, ...extra });
}
const [eleni, nikos, maria, , dimitris] = people as [Person, Person, Person, Person, Person];
for (let d = 13; d >= 0; d--) {
  for (const v of ['v-oil-0', 'v-coffee-0', 'v-soap-0', 'v-pistachio-0', 'v-tea-0', 'v-loukoumi-0']) {
    const n = 1 + ((d * 7 + v.length) % 4);
    seedMovement(d, 'shop-kifisia', v, -n, 'sale', dimitris, { unitPriceMinor: products.find((p) => p.variants[0]!.id === v)!.variants[0]!.priceMinor ?? 0 });
  }
}
seedMovement(2, 'shop-kifisia', 'v-oil-0', 24, 'receive', maria, { unitCostMinor: 780, batchId: 'batch-1' });
seedMovement(2, 'shop-kifisia', 'v-tahini-0', 12, 'receive', maria, { unitCostMinor: 250, batchId: 'batch-1' });
seedMovement(4, 'shop-kifisia', 'v-honey-0', -6, 'sale', dimitris, { unitPriceMinor: 1290 });
seedMovement(5, 'shop-kifisia', 'v-cup-0', -1, 'damage', maria, { reason: 'damaged', note: 'Σπασμένο στο ράφι' });
seedMovement(6, 'shop-glyfada', 'v-salt-0', -3, 'sale', nikos, { unitPriceMinor: 350 });
seedMovement(7, 'shop-marousi', 'v-feta-0', -120, 'adjust', nikos, { reason: 'expired' });
seedMovement(9, 'shop-kifisia', 'v-tote-1', -1, 'adjust', eleni, { reason: 'own_use' });
movements.sort((a, b) => b.recordedAt - a.recordedAt);

const unknownScans = [
  { id: 'us-1', code: '4006381333931', shopId: 'shop-kifisia', times: 3, scannedAt: NOW - 3 * 3_600_000 },
  { id: 'us-2', code: '8410076472885', shopId: 'shop-marousi', times: 1, scannedAt: NOW - DAY },
];

// ---------------------------------------------------------------- customers

const custSeed: [string, Locale, string[], ScopeType, string, boolean, boolean][] = [
  ['Anna Petrova', 'ru', ['regulars', 'honey lovers'], 'shop', 'shop-kifisia', true, true],
  ['Giorgos Papadakis', 'el', ['regulars'], 'org', ORG, true, true],
  ['Katerina Nikolaou', 'el', ['newsletter'], 'shop', 'shop-kifisia', true, false],
  ['Ivan Smirnov', 'ru', ['wholesale'], 'group', 'grp-north', true, true],
  ['Kostas Dimitriou', 'el', [], 'shop', 'shop-glyfada', false, true],
  ['Olga Kuznetsova', 'ru', ['honey lovers'], 'shop', 'shop-kifisia', true, true],
  ['Despina Alexiou', 'el', ['regulars'], 'shop', 'shop-marousi', true, false],
  ['Yannis Vlachos', 'el', [], 'org', ORG, false, true],
  ['Elena Sokolova', 'ru', ['newsletter'], 'shop', 'shop-glyfada', true, true],
  ['Maria Konstantinou', 'el', ['regulars', 'honey lovers'], 'shop', 'shop-kifisia', true, true],
  ['Dmitri Volkov', 'ru', [], 'group', 'grp-north', true, false],
  ['Eftychia Markou', 'el', ['newsletter'], 'shop', 'shop-marousi', true, true],
  ['Thanos Leventis', 'el', ['wholesale'], 'org', ORG, true, false],
  ['Natalia Orlova', 'ru', ['regulars'], 'shop', 'shop-kifisia', false, true],
  ['Panagiotis Raptis', 'el', [], 'shop', 'shop-glyfada', true, true],
  ['Sophie Martin', 'en', ['tourists'], 'shop', 'shop-kifisia', true, false],
  ['Vasiliki Stavrou', 'el', ['regulars'], 'shop', 'shop-kifisia', true, true],
  ['Alexei Morozov', 'ru', [], 'shop', 'shop-marousi', true, true],
  ['Irini Zachariou', 'el', ['honey lovers'], 'group', 'grp-north', true, true],
  ['James Walker', 'en', ['tourists'], 'shop', 'shop-glyfada', false, true],
];

interface CustomerRow extends CustomerDetail { email: string; key: string; fullPhone: string }

const customers: CustomerRow[] = custSeed.map(([name, locale, tags, scopeType, scopeId, emailOk, pushOk], i) => {
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;
  const created = NOW - (i * 3 + 1) * DAY;
  return {
    id: `c-${i + 1}`, name, email, phone: null, fullPhone: `+30 69${String(41234567 + i * 7919).slice(0, 8)}`, contactMasked: false, locale,
    emailOk, pushOk, smsOk: false, hasApp: pushOk, source: i % 3 === 0 ? 'join_link' : i % 3 === 1 ? 'app' : 'staff', tags,
    subscriptions: [{ scopeType, scopeId, status: 'subscribed' }], createdAt: created,
    consents: [
      ...(emailOk ? [{ channel: 'email' as const, granted: true, textVersion: `${locale}-2026-11`, source: 'join_page', createdAt: created }] : []),
      ...(pushOk ? [{ channel: 'push' as const, granted: true, textVersion: `${locale}-2026-11`, source: 'app', createdAt: created + 3_600_000 }] : []),
    ],
    notes: i === 0 ? [{ id: 'n1', body: 'Ρωτάει κάθε εβδομάδα για το θυμαρίσιο μέλι.', authorName: 'Maria Ioannou', createdAt: NOW - 2 * DAY }] : [],
    waitingFor: tags.includes('honey lovers') ? [{ variantId: 'v-honey-0', productName: 'Θυμαρίσιο μέλι 450g', shopId: 'shop-kifisia' }] : [],
    favorites: i % 4 === 0 ? [{ productId: 'p-pistachio', productName: 'Φιστίκι Αιγίνης 250g' }] : [],
    deliveries: [{ postId: 'post-arrivals', channel: pushOk ? 'push' : 'email', status: 'sent', createdAt: NOW - 3 * DAY }],
    key: searchKey(name, email, tags.join(' ')),
  };
});

// ---------------------------------------------------------------- posts and join links

const variantInfo = (variantId: string, offerPriceMinor: number | null = null) => {
  const p = products.find((x) => x.variants.some((v) => v.id === variantId))!;
  const v = p.variants.find((x) => x.id === variantId)!;
  return { variantId, productId: p.id, name: p.name, imageUrl: p.images[0]?.url ?? null, priceMinor: v.priceMinor, offerPriceMinor, wasMinor: offerPriceMinor != null ? v.priceMinor : null };
};

const aud = (scopes: { scopeType: ScopeType; scopeId: string }[]): Audience => ({ scopes, tags: [], interests: [], locales: [], savedAnyLinked: false, joinedWithinDays: null });

const posts: Post[] = [
  {
    id: 'post-offer', orgId: ORG, kind: 'offer', status: 'sent', defaultLocale: 'el',
    translations: {
      el: { title: 'Φιστίκι και λουκούμι, μόνο αυτή την εβδομάδα', body: 'Φρέσκο φιστίκι Αιγίνης και λουκούμι τριαντάφυλλο σε καλύτερη τιμή σε όλα τα καταστήματα μέχρι την Κυριακή.' },
      en: { title: 'Pistachios and loukoumi, this week only', body: 'Fresh Aegina pistachios and rose loukoumi at a better price in every shop until Sunday.' },
      ru: { title: 'Фисташки и лукум, только на этой неделе', body: 'Свежие фисташки с Эгины и лукум с розой по лучшей цене во всех магазинах до воскресенья.' },
    },
    channels: ['feed', 'push', 'email'], audience: aud([{ scopeType: 'org', scopeId: ORG }]),
    products: [variantInfo('v-pistachio-0', 850), variantInfo('v-loukoumi-0', 550)], coverUrl: IMG.offer,
    scheduledAt: null, validFrom: NOW - DAY, validUntil: NOW + 4 * DAY, authorId: 'u-nikos', authorName: 'Nikos Georgiou', approvedBy: null,
    sentAt: NOW - DAY, recipientsCount: 312, stats: { queued: 0, sent: 290, failed: 4, opened: 131, skipped: 18 }, createdAt: NOW - 2 * DAY,
  },
  {
    id: 'post-arrivals', orgId: ORG, kind: 'new_arrival', status: 'sent', defaultLocale: 'el',
    translations: {
      el: { title: 'Ήρθε το φετινό ελαιόλαδο', body: 'Το πρώτο λάδι της χρονιάς από τη Σητεία έφτασε στην Κηφισιά. Πράσινο, πικάντικο, φρέσκο.' },
      en: { title: 'This year\'s olive oil is in', body: 'The first oil of the year from Sitia has arrived in Kifisia. Green, peppery, fresh.' },
    },
    channels: ['feed', 'push'], audience: aud([{ scopeType: 'shop', scopeId: 'shop-kifisia' }]),
    products: [variantInfo('v-oil-0')], coverUrl: IMG.harvest, scheduledAt: null, validFrom: null, validUntil: null,
    authorId: 'u-maria', authorName: 'Maria Ioannou', approvedBy: null, sentAt: NOW - 3 * DAY, recipientsCount: 186,
    stats: { queued: 0, sent: 180, failed: 2, opened: 97, skipped: 4 }, createdAt: NOW - 3 * DAY,
  },
  {
    id: 'post-event', orgId: ORG, kind: 'event', status: 'scheduled', defaultLocale: 'el',
    translations: {
      el: { title: 'Γευσιγνωσία μελιού το Σάββατο', body: 'Ελάτε στη Γλυφάδα το Σάββατο στις 12:00 να δοκιμάσετε πέντε μέλια από πέντε νησιά.' },
      en: { title: 'Honey tasting on Saturday', body: 'Come to Glyfada on Saturday at 12:00 and taste five honeys from five islands.' },
      ru: { title: 'Дегустация мёда в субботу', body: 'Приходите в Глифаду в субботу в 12:00 и попробуйте пять видов мёда с пяти островов.' },
    },
    channels: ['feed', 'push'], audience: aud([{ scopeType: 'shop', scopeId: 'shop-glyfada' }]), products: [], coverUrl: IMG.event,
    scheduledAt: NOW + 2 * DAY, validFrom: null, validUntil: null, authorId: 'u-nikos', authorName: 'Nikos Georgiou', approvedBy: null,
    sentAt: null, recipientsCount: null, stats: null, createdAt: NOW - 6 * 3_600_000,
  },
  {
    id: 'post-draft', orgId: ORG, kind: 'back_in_stock', status: 'pending_approval', defaultLocale: 'el',
    translations: { el: { title: 'Το θυμαρίσιο μέλι επιστρέφει', body: 'Η νέα παρτίδα από τη Νάξο έρχεται την Πέμπτη στην Κηφισιά.' } },
    channels: ['feed', 'push'], audience: aud([{ scopeType: 'shop', scopeId: 'shop-kifisia' }]), products: [variantInfo('v-honey-0')], coverUrl: null,
    scheduledAt: null, validFrom: null, validUntil: null, authorId: 'u-maria', authorName: 'Maria Ioannou', approvedBy: null,
    sentAt: null, recipientsCount: null, stats: null, createdAt: NOW - 2 * 3_600_000,
  },
];

const joinLinks: JoinLink[] = [
  { id: 'jl-1', code: 'kif7q2', scopeType: 'shop', scopeId: 'shop-kifisia', label: 'Window poster', url: '/j/kif7q2', opens: 412, signups: 96, confirmed: 81, disabled: false },
  { id: 'jl-2', code: 'ig4m8x', scopeType: 'org', scopeId: ORG, label: 'Instagram bio', url: '/j/ig4m8x', opens: 1230, signups: 140, confirmed: 118, disabled: false },
  { id: 'jl-3', code: 'mr3c5t', scopeType: 'shop', scopeId: 'shop-marousi', label: 'Receipt', url: '/j/mr3c5t', opens: 210, signups: 58, confirmed: 52, disabled: false },
];


// ---------------------------------------------------------------- stage 2: counts, transfers, audit, dev outbox

const counts: StockCount[] = [];
const transfers: Transfer[] = [
  {
    id: 'tr-1', fromShopId: 'shop-marousi', toShopId: 'shop-kifisia', status: 'sent', note: 'Για το Σάββατο',
    createdBy: 'u-nikos', createdAt: NOW - 5 * 3_600_000, sentAt: NOW - 4 * 3_600_000, receivedAt: null,
    lines: [{ variantId: 'v-coffee-0', name: 'Ελληνικός καφές 200g', qtySent: 12, qtyReceived: null, lost: 0 }],
  },
];
const auditLog: AuditEntry[] = [
  { id: 'au-1', actorId: 'u-eleni', actorName: 'Eleni Papadopoulou', actorKind: 'member', action: 'role.assigned', entityType: 'member', entityId: 'm-maria', before: null, after: { role: 'manager', shop: 'Kifisia' }, createdAt: NOW - 20 * DAY },
  { id: 'au-2', actorId: 'u-nikos', actorName: 'Nikos Georgiou', actorKind: 'member', action: 'product.price_changed', entityType: 'product', entityId: 'p-oil', before: { price: 1190 }, after: { price: 1290 }, createdAt: NOW - 6 * DAY },
  { id: 'au-3', actorId: 'u-eleni', actorName: 'Eleni Papadopoulou', actorKind: 'member', action: 'customers.exported', entityType: 'org', entityId: ORG, before: null, after: { rows: 412 }, createdAt: NOW - 2 * DAY },
  { id: 'au-4', actorId: 'u-nikos', actorName: 'Nikos Georgiou', actorKind: 'member', action: 'post.published', entityType: 'post', entityId: 'post-offer', before: null, after: null, createdAt: NOW - DAY },
];
const outbox: DevOutboxItem[] = [];
const invites: Invite[] = [
  { id: 'inv-1', email: 'petros@example.com', roleId: 'role-staff', roleName: 'staff', scopeType: 'shop', scopeId: 'shop-marousi', invitedBy: 'u-nikos', createdAt: NOW - DAY, expiresAt: NOW + 6 * DAY },
];

function logAudit(by: Person | null, action: string, entityType: string, entityId: string, before: unknown = null, after: unknown = null) {
  auditLog.unshift({ id: uid(), actorId: by?.userId ?? null, actorName: by?.name ?? null, actorKind: by ? 'member' : 'system', action, entityType, entityId, before, after, createdAt: Date.now() });
}

function queueOutbox(channel: DevOutboxItem['channel'], c: CustomerRow, title: string, body: string, payload: unknown = null) {
  outbox.unshift({ id: uid(), channel, orgId: ORG, userId: null, customerId: c.id, to: channel === 'email' ? c.email : c.name, locale: c.locale, title, body, payload, createdAt: Date.now() });
}

function productOfVariant(variantId: string) {
  return products.find((p) => p.variants.some((v) => v.id === variantId));
}

// ---------------------------------------------------------------- the fixture api

function page<T>(items: T[], cursor?: string, limit = 50): Page<T> {
  const start = cursor ? Number(cursor) : 0;
  const slice = items.slice(start, start + limit);
  return { items: slice, nextCursor: start + limit < items.length ? String(start + limit) : null };
}

function scopeName(scopeType: ScopeType, scopeId: string): string {
  if (scopeType === 'org') return settings.name;
  if (scopeType === 'group') return groups.find((g) => g.id === scopeId)?.name ?? scopeId;
  return shops.find((s) => s.id === scopeId)?.name ?? scopeId;
}

function customerReaches(c: CustomerRow, shopId: string): boolean {
  return c.subscriptions.some((s) => s.status === 'subscribed' && covers(s.scopeType, s.scopeId, shopId));
}

function wantedCount(variantId: string): number {
  return levels.filter((l) => l.variantId === variantId).reduce((a, l) => a + l.waiting, 0);
}

export function createFixtureApi(initialUser?: string | null): CustockApi {
  let currentUser: string | null = initialUser ?? null;
  const me = () => people.find((p) => p.userId === currentUser) ?? null;
  const orgAccess = () => {
    const p = me();
    if (!p) throw new FixtureError(401, 'unauthorized');
    return access(p);
  };
  const canDo = (perm: string, shopId?: string) => {
    const a = orgAccess();
    if (a.orgPerms.includes(perm)) return true;
    if (shopId) return a.shops.find((s) => s.shopId === shopId)?.perms.includes(perm) ?? false;
    return a.anyPerms.includes(perm) || a.shops.some((s) => s.perms.includes(perm));
  };
  const visibleShops = () => orgAccess().shops.map((s) => s.shopId);
  const tokens = (userId: string): Tokens => ({ accessToken: `dev.${userId}`, refreshToken: `devr.${userId}`, expiresAt: NOW + 900_000 });

  const productOut = (p: ProductRow) => {
    const showCost = currentUser ? canDo('products.cost.view') : false;
    const { key: _k, shopPrices: _s, ...rest } = p;
    void _k; void _s;
    const ids = new Set(visibleShops());
    return {
      ...rest,
      variants: p.variants.map((v) => (showCost ? v : { ...v, costMinor: undefined })),
      levels: levels.filter((l) => ids.has(l.shopId) && p.variants.some((v) => v.id === l.variantId)),
    };
  };

  const customerOut = (c: CustomerRow): Customer => {
    const full = canDo('customers.contact.view');
    return {
      id: c.id, name: c.name, email: full ? c.email : c.email.replace(/^(.{2}).*@/, '$1***@'),
      phone: full ? c.fullPhone : c.fullPhone.replace(/(\+30 69).*(\d{3})$/, '$1** *** $2'), contactMasked: !full,
      locale: c.locale, emailOk: c.emailOk, pushOk: c.pushOk, smsOk: c.smsOk, hasApp: c.hasApp, source: c.source,
      tags: c.tags, subscriptions: c.subscriptions, createdAt: c.createdAt,
    };
  };

  const preview = (audience: Audience, channels: string[]): AudiencePreview => {
    const reached = customers.filter((c) => audience.scopes.some((s) => (s.scopeType === 'org' ? true : shops.some((sh) => covers(s.scopeType, s.scopeId, sh.id) && customerReaches(c, sh.id))))
      && (audience.tags.length === 0 || audience.tags.some((t) => c.tags.includes(t)))
      && (audience.locales.length === 0 || audience.locales.includes(c.locale)));
    // scale the 20 sample customers up to a believable shop size
    const k = 16;
    const byScope = audience.scopes.map((s) => ({ scopeType: s.scopeType, scopeId: s.scopeId, name: scopeName(s.scopeType, s.scopeId), count: 0 }));
    for (const c of reached) {
      const direct = byScope.find((s) => c.subscriptions.some((x) => x.scopeType === s.scopeType && x.scopeId === s.scopeId)) ?? byScope[0];
      if (direct) direct.count += k;
    }
    const byLocale: Record<string, number> = {};
    for (const c of reached) byLocale[c.locale] = (byLocale[c.locale] ?? 0) + k;
    const hour = new Date().getUTCHours() + 2;
    return {
      total: reached.length * k,
      byScope,
      byLocale,
      push: channels.includes('push')
        ? { count: reached.filter((c) => c.pushOk).length * k, turnedOff: reached.filter((c) => c.hasApp && !c.pushOk).length * k, noApp: reached.filter((c) => !c.hasApp).length * k, capReached: 0, heldForQuietHours: hour >= 22 || hour < 9 }
        : { count: 0, turnedOff: 0, noApp: 0, capReached: 0, heldForQuietHours: false },
      email: channels.includes('email')
        ? { count: reached.filter((c) => c.emailOk).length * k, unconfirmed: Math.round(reached.length * 0.6), suppressed: 0 }
        : { count: 0, unconfirmed: 0, suppressed: 0 },
    };
  };

  const publicProduct = (p: ProductRow): PublicProduct => {
    const v = p.variants[0]!;
    const offerPost = posts.find((x) => x.kind === 'offer' && x.status === 'sent' && (x.validUntil ?? 0) > Date.now() && x.products.some((pp) => pp.variantId === v.id));
    const offerLine = offerPost?.products.find((pp) => pp.variantId === v.id);
    return {
      id: p.id, orgId: ORG, orgName: settings.name, name: p.name, description: p.description, images: p.images, categoryName: p.categoryName,
      priceMinor: settings.customerPrices ? v.priceMinor : null, currency: settings.currency,
      offer: offerPost && offerLine?.offerPriceMinor != null ? { postId: offerPost.id, priceMinor: offerLine.offerPriceMinor, wasMinor: offerLine.wasMinor, validUntil: offerPost.validUntil } : null,
      availability: shops.filter((s) => s.customerVisible).map((s) => {
        const mode = p.customerStockHidden ? 'off' : (s.customerStock ?? settings.customerStock);
        const onHand = p.variants.reduce((a, vv) => a + (lvl(s.id, vv.id)?.onHand ?? 0), 0);
        const state = onHand <= 0 ? 'out' : onHand <= (p.uom === 'piece' ? settings.fewLeftThreshold : settings.fewLeftThreshold * 1000) ? 'few' : 'in';
        return { shopId: s.id, shopName: s.name, state: mode === 'off' ? null : state, qty: mode === 'exact' ? Math.max(0, onHand) : null };
      }),
      variantId: v.id, waitingForIt: false, saved: false,
    };
  };

  const api: Partial<CustockApi> = {
    async login(email, password) {
      const p = people.find((x) => x.email === email.toLowerCase().trim());
      if (!p || password !== 'custock') throw new FixtureError(401, 'unauthorized');
      currentUser = p.userId;
      return tokens(p.userId);
    },
    async requestOtp() { return { sent: true, devCode: '123456' }; },
    async verifyOtp(email, code) {
      if (code !== '123456') throw new FixtureError(401, 'unauthorized');
      currentUser = email === customerUser.email ? customerUser.userId : null;
      return tokens(customerUser.userId);
    },
    async refresh(rt) { return tokens(rt.replace('devr.', '')); },
    async logout() { currentUser = null; },
    async me(): Promise<MeContext> {
      const p = me();
      if (!p) throw new FixtureError(401, 'unauthorized');
      return { user: { id: p.userId, email: p.email, displayName: p.name, locale: p.locale }, orgs: [access(p)], following: [] };
    },

    async orgSettings() { return { ...settings }; },
    async updateOrgSettings(_org, patch) {
      if (!canDo('org.settings.manage')) throw new FixtureError(403, 'forbidden');
      Object.assign(settings, patch);
      return { ...settings };
    },
    async shops() { return shops.map((s) => ({ ...s })); },
    async groups() { return groups; },
    async updateShop(_org, shopId, patch) {
      const s = shops.find((x) => x.id === shopId);
      if (!s) throw new FixtureError(404, 'not_found');
      if (!canDo('shop.settings.manage', shopId) && !canDo('org.settings.manage')) throw new FixtureError(403, 'forbidden');
      Object.assign(s, patch);
      return { ...s };
    },

    async categories() { return categories; },
    async products(_org, q = {}) {
      let list = products.filter((p) => !p.archivedAt);
      if (q.q) list = list.filter((p) => matches(p.key, q.q!) || p.variants.some((v) => v.barcodes.some((b) => b.code.includes(q.q!.trim()))));
      if (q.categoryId) list = list.filter((p) => p.categoryId === q.categoryId || categories.find((c) => c.id === p.categoryId)?.parentId === q.categoryId);
      const shopIds = q.shopId ? [q.shopId] : visibleShops();
      const sum = (p: ProductRow, s: string) => p.variants.reduce((a, v) => a + (lvl(s, v.id)?.onHand ?? 0), 0);
      if (q.filter === 'out') list = list.filter((p) => shopIds.some((s) => sum(p, s) <= 0));
      if (q.filter === 'negative') list = list.filter((p) => shopIds.some((s) => sum(p, s) < 0));
      if (q.filter === 'low') list = list.filter((p) => shopIds.some((s) => p.variants.some((v) => { const l = lvl(s, v.id); return l && l.reorderPoint != null && l.onHand > 0 && l.onHand <= l.reorderPoint; })));
      if (q.filter === 'waiting') list = list.filter((p) => p.variants.some((v) => wantedCount(v.id) > 0));
      return page(list.map(productOut), q.cursor, q.limit);
    },
    async product(_org, id) {
      const p = products.find((x) => x.id === id);
      if (!p) throw new FixtureError(404, 'not_found');
      return productOut(p);
    },
    async createProduct(_org, input: ProductInput) {
      if (!canDo('products.create')) throw new FixtureError(403, 'forbidden');
      const id = `p-${uid().slice(0, 8)}`;
      const code = input.barcode ?? ean13(`20${String(2000 + barcodeSeq++).padStart(10, '0')}`);
      // the sample data already takes variants and photo urls, the shapes the form sends
      const specs = input.variants?.length ? input.variants : [{ options: null, priceMinor: input.priceMinor ?? null }];
      const row: ProductRow = {
        id, orgId: ORG, categoryId: input.categoryId ?? null, categoryName: catName(input.categoryId ?? null), name: input.name, description: input.description ?? null,
        brand: input.brand ?? null, uom: input.uom, taxRateBp: input.taxRateBp, trackStock: input.trackStock, customerVisible: true, customerStockHidden: false,
        images: (input.imageUrls ?? []).map((url) => ({ id: uid(), url, width: null, height: null })),
        variants: specs.map((v, j) => {
          const vcode = j === 0 ? code : ean13(`20${String(2000 + barcodeSeq++).padStart(10, '0')}`);
          return { id: `v-${id}-${j}`, productId: id, sku: null, options: v.options ?? null, priceMinor: v.priceMinor ?? input.priceMinor ?? null, costMinor: input.costMinor ?? null, isDefault: j === 0, barcodes: [{ id: uid(), code: vcode, codeNorm: vcode.padStart(14, '0'), symbology: 'ean13', packQty: 1 }] };
        }),
        archivedAt: null, key: searchKey(input.name, input.brand), shopPrices: {},
      };
      products.unshift(row);
      for (const s of shops) for (const v of row.variants) levels.push({ shopId: s.id, variantId: v.id, onHand: 0, inTransitIn: 0, reorderPoint: null, lastMovementAt: null, waiting: 0 });
      logAudit(me(), 'product.created', 'product', id, null, { name: input.name });
      return productOut(row);
    },
    async updateProduct(_org, id, patch) {
      const p = products.find((x) => x.id === id);
      if (!p) throw new FixtureError(404, 'not_found');
      if (!canDo('products.edit')) throw new FixtureError(403, 'forbidden');
      if (patch.priceMinor !== undefined && !canDo('products.price.edit')) throw new FixtureError(403, 'forbidden');
      if (patch.name) { p.name = patch.name; p.key = searchKey(p.name, p.translations?.en?.name, p.translations?.ru?.name); }
      if (patch.description !== undefined) p.description = patch.description ?? null;
      if (patch.brand !== undefined) p.brand = patch.brand ?? null;
      if (patch.categoryId !== undefined) { p.categoryId = patch.categoryId ?? null; p.categoryName = catName(p.categoryId); }
      if (patch.uom) p.uom = patch.uom;
      if (patch.taxRateBp) p.taxRateBp = patch.taxRateBp;
      if (patch.trackStock !== undefined) p.trackStock = patch.trackStock;
      if (patch.costMinor !== undefined && canDo('products.cost.edit')) p.variants[0]!.costMinor = patch.costMinor ?? null;
      if (patch.imageUrls) p.images = patch.imageUrls.map((url) => ({ id: uid(), url, width: null, height: null }));
      if (patch.barcode) { const code = patch.barcode.trim(); p.variants[0]!.barcodes.push({ id: uid(), code, codeNorm: code.padStart(14, '0'), symbology: 'ean13', packQty: 1 }); }
      if (patch.priceMinor !== undefined) p.variants[0]!.priceMinor = patch.priceMinor ?? null;
      return productOut(p);
    },
    async setShopPrice(_org, shopId, variantId, priceMinor) {
      if (!canDo('prices.shop.edit', shopId)) throw new FixtureError(403, 'forbidden');
      const p = products.find((x) => x.variants.some((v) => v.id === variantId));
      if (p) { if (priceMinor == null) delete p.shopPrices[shopId]; else p.shopPrices[shopId] = priceMinor; }
    },
    async scan(_org, code): Promise<ScanResult> {
      const norm = code.trim().padStart(14, '0');
      const p = products.find((x) => x.variants.some((v) => v.barcodes.some((b) => b.codeNorm === norm)));
      if (!p) return { codeNorm: norm, kind: /^\d+$/.test(code) ? 'gtin' : 'raw', valid: true, match: 'unknown', packQty: 1, product: null, variantId: null };
      const v = p.variants.find((x) => x.barcodes.some((b) => b.codeNorm === norm))!;
      return { codeNorm: norm, kind: 'gtin', valid: true, match: p.archivedAt ? 'archived' : 'variant', packQty: 1, product: productOut(p), variantId: v.id };
    },
    async attachBarcode(_org, variantId, code, packQty = 1) {
      const norm = code.padStart(14, '0');
      if (products.some((p) => p.variants.some((v) => v.barcodes.some((b) => b.codeNorm === norm)))) throw new FixtureError(409, 'barcode_taken');
      const v = products.flatMap((p) => p.variants).find((x) => x.id === variantId);
      v?.barcodes.push({ id: uid(), code, codeNorm: norm, symbology: 'ean13', packQty });
    },
    async postMovements(_org, input: MovementInput[]): Promise<MovementBatchResult> {
      const result: MovementBatchResult = { accepted: [], duplicates: [], rejected: [], levels: [], backInStock: [], lowStock: [] };
      const by = me()!;
      for (const m of input) {
        if (movements.some((x) => x.id === m.id)) { result.duplicates.push(m.id); continue; }
        const perm = ({ receive: 'stock.receive', sale: 'stock.sell', return: 'stock.return', adjust: 'stock.adjust', damage: 'stock.adjust', initial: 'stock.adjust', count: 'stock.count.approve', transfer_out: 'stock.transfer.send', transfer_in: 'stock.transfer.receive', reversal: 'stock.view' } as const)[m.kind];
        if (!canDo(perm, m.shopId)) { result.rejected.push({ id: m.id, code: 'forbidden' }); continue; }
        const l = lvl(m.shopId, m.variantId);
        if (!l) { result.rejected.push({ id: m.id, code: 'not_found' }); continue; }
        const before = l.onHand;
        l.onHand += m.qtyDelta;
        l.lastMovementAt = Date.now();
        movements.unshift({ ...m, orgId: ORG, createdBy: by.userId, createdByName: by.name, recordedAt: Date.now() });
        result.accepted.push(m.id);
        if (before <= 0 && l.onHand > 0 && ['receive', 'transfer_in', 'return'].includes(m.kind) && l.waiting > 0) {
          result.backInStock.push({ variantId: m.variantId, shopId: m.shopId, notified: l.waiting });
          const prod = productOfVariant(m.variantId);
          const shopName = shops.find((x) => x.id === m.shopId)?.name ?? '';
          for (const c of customers.filter((x) => x.waitingFor.some((w) => w.variantId === m.variantId))) {
            queueOutbox(c.pushOk ? 'push' : 'email', c, `${settings.name} ${shopName}`, `${prod?.translations?.[c.locale]?.name ?? prod?.name ?? ''}: back in stock`, { kind: 'back_in_stock', variantId: m.variantId });
          }
          l.waiting = 0;
        }
        if (l.reorderPoint != null && before > l.reorderPoint && l.onHand <= l.reorderPoint) result.lowStock.push({ variantId: m.variantId, shopId: m.shopId, onHand: l.onHand });
        result.levels.push({ ...l });
      }
      return result;
    },
    async movements(_org, q) {
      const ids = new Set(visibleShops());
      let list = movements.filter((m) => ids.has(m.shopId));
      if (q.shopId) list = list.filter((m) => m.shopId === q.shopId);
      if (q.variantId) list = list.filter((m) => m.variantId === q.variantId);
      return page(list, q.cursor, q.limit ?? 30);
    },
    async unknownScans(_org, shopId) { return unknownScans.filter((u) => !shopId || u.shopId === shopId); },

    async customers(_org, q = {}) {
      if (!canDo('customers.view')) throw new FixtureError(403, 'forbidden');
      const a = orgAccess();
      const mine = a.orgPerms.includes('customers.view') ? customers : customers.filter((c) => a.shops.some((s) => s.perms.includes('customers.view') && customerReaches(c, s.shopId)));
      let list = mine;
      if (q.q) list = list.filter((c) => matches(c.key, q.q!));
      if (q.shopId) list = list.filter((c) => customerReaches(c, q.shopId!));
      if (q.tag) list = list.filter((c) => c.tags.includes(q.tag!));
      if (q.channel) list = list.filter((c) => (q.channel === 'email' ? c.emailOk : c.pushOk));
      if (q.locale) list = list.filter((c) => c.locale === q.locale);
      return page(list.map(customerOut), q.cursor, q.limit);
    },
    async customer(_org, id) {
      const c = customers.find((x) => x.id === id);
      if (!c) throw new FixtureError(404, 'not_found');
      return { ...c, ...customerOut(c) };
    },
    async addCustomerNote(_org, id, body) {
      if (!canDo('customers.edit')) throw new FixtureError(403, 'forbidden');
      customers.find((x) => x.id === id)?.notes.unshift({ id: uid(), body, authorName: me()?.name ?? null, createdAt: Date.now() });
    },
    async setCustomerTags(_org, id, tags) {
      if (!canDo('customers.edit')) throw new FixtureError(403, 'forbidden');
      const c = customers.find((x) => x.id === id);
      if (c) c.tags = tags;
    },
    async joinLinks() { return joinLinks; },
    async createJoinLink(_org, input) {
      if (!canDo('joinlinks.manage', input.scopeType === 'shop' ? input.scopeId : undefined)) throw new FixtureError(403, 'forbidden');
      const code = uid().replace(/-/g, '').slice(0, 8);
      const link: JoinLink = { id: uid(), code, scopeType: input.scopeType, scopeId: input.scopeId, label: input.label ?? null, url: `/j/${code}`, opens: 0, signups: 0, confirmed: 0, disabled: false };
      joinLinks.unshift(link);
      return link;
    },

    async posts(_org, q = {}) {
      const list = q.status ? posts.filter((p) => p.status === q.status) : posts;
      return page([...list].sort((a, b) => b.createdAt - a.createdAt), q.cursor);
    },
    async post(_org, id) {
      const p = posts.find((x) => x.id === id);
      if (!p) throw new FixtureError(404, 'not_found');
      return p;
    },
    async createPost(_org, input: PostInput) {
      if (!canDo('posts.create')) throw new FixtureError(403, 'forbidden');
      const p: Post = {
        id: `post-${uid().slice(0, 8)}`, orgId: ORG, kind: input.kind, status: 'draft', defaultLocale: input.defaultLocale,
        translations: input.translations as Post['translations'], channels: input.channels, audience: input.audience,
        products: input.products.map((x) => variantInfo(x.variantId, x.offerPriceMinor)), coverUrl: input.coverUrl, scheduledAt: input.scheduledAt,
        validFrom: input.validFrom, validUntil: input.validUntil, authorId: me()!.userId, authorName: me()!.name, approvedBy: null,
        sentAt: null, recipientsCount: null, stats: null, createdAt: Date.now(),
      };
      posts.unshift(p);
      return p;
    },
    async updatePost(org, id, input) {
      const i = posts.findIndex((x) => x.id === id);
      const created = await api.createPost!(org, input);
      posts.splice(posts.indexOf(created), 1);
      if (i >= 0) posts[i] = { ...created, id };
      return posts[i] ?? created;
    },
    async previewAudience(_org, audience, channels) { return preview(audience, channels); },
    async publishPost(_org, id) {
      const p = posts.find((x) => x.id === id);
      if (!p) throw new FixtureError(404, 'not_found');
      const shopIds = p.audience.scopes.flatMap((s) => shops.filter((sh) => covers(s.scopeType, s.scopeId, sh.id)).map((sh) => sh.id));
      const mayPublish = !settings.postsNeedApproval && shopIds.every((s) => canDo('posts.publish', s));
      if (!mayPublish) { p.status = 'pending_approval'; return p; }
      const pr = preview(p.audience, p.channels);
      p.status = p.scheduledAt && p.scheduledAt > Date.now() ? 'scheduled' : 'sent';
      if (p.status === 'sent') {
        p.sentAt = Date.now(); p.recipientsCount = pr.total; p.stats = { queued: 0, sent: pr.push.count + pr.email.count, failed: 0, opened: 0, skipped: 0 };
        const reached = customers.filter((c) => p.audience.scopes.some((sc) => sc.scopeType === 'org' || shops.some((sh) => covers(sc.scopeType, sc.scopeId, sh.id) && customerReaches(c, sh.id))));
        for (const c of reached) {
          const text = p.translations[c.locale] ?? p.translations[p.defaultLocale]!;
          if (p.channels.includes('push') && c.pushOk) queueOutbox('push', c, settings.name, text.title, { kind: 'post', postId: p.id });
          if (p.channels.includes('email') && c.emailOk) queueOutbox('email', c, text.title, text.body, { kind: 'post', postId: p.id });
        }
        logAudit(me(), 'post.published', 'post', p.id);
      }
      return p;
    },
    async approvePost(org, id) {
      if (!canDo('posts.publish')) throw new FixtureError(403, 'forbidden');
      const p = posts.find((x) => x.id === id)!;
      p.approvedBy = me()!.userId;
      p.status = 'draft';
      return api.publishPost!(org, id);
    },
    async cancelPost(_org, id) {
      const p = posts.find((x) => x.id === id)!;
      p.status = 'cancelled';
      return p;
    },

    async members(): Promise<Member[]> {
      const a = orgAccess();
      const myRank = (shopId: string | null) => (shopId ? a.shops.find((s) => s.shopId === shopId)?.rank ?? 0 : Math.max(0, ...a.shops.map((s) => s.rank)));
      return people.map((p) => {
        const theirRank = Math.max(...p.assignments.map((x) => roles.find((r) => r.id === x.roleId)!.rank));
        const self = p.userId === currentUser;
        const scopeShop = p.assignments.find((x) => x.scopeType === 'shop')?.scopeId ?? null;
        // scope rule: someone with an org or group role is outside a shop manager's reach
        const outside = !a.orgPerms.includes('members.manage') && p.assignments.some((x) => x.scopeType !== 'shop' || !canDo('members.manage', x.scopeId));
        const blocked = self ? 'self' : !canDo('members.manage') ? 'forbidden' : outside ? 'scope' : theirRank >= myRank(scopeShop) ? 'rank' : null;
        return {
          membershipId: p.membershipId, userId: p.userId, name: p.name, email: p.email, status: 'active' as const,
          assignments: p.assignments.map((x) => ({ ...x, roleName: roles.find((r) => r.id === x.roleId)!.templateKey ?? '', scopeName: scopeName(x.scopeType, x.scopeId) })),
          canManage: blocked == null, manageBlockedBy: blocked as Member['manageBlockedBy'],
        };
      });
    },
    async roles() { return roles; },
    async grantableRoles(_org, scopeType, scopeId): Promise<GrantableRole[]> {
      const a = orgAccess();
      const shopId = scopeType === 'shop' ? scopeId : null;
      const myRank = shopId ? a.shops.find((s) => s.shopId === shopId)?.rank ?? 0 : Math.max(0, ...a.shops.map((s) => s.rank));
      const mine = new Set(shopId ? [...(a.shops.find((s) => s.shopId === shopId)?.perms ?? []), ...a.orgPerms] : a.orgPerms);
      const inScope = scopeType === 'org' ? a.orgPerms.includes('members.invite') : shopId ? canDo('members.invite', shopId) : a.orgPerms.includes('members.invite');
      return roles.map((r) => {
        const blockedBy = !inScope ? 'scope' : r.rank >= myRank ? 'rank' : r.permissions.some((p) => !mine.has(p) && !ORG_LEVEL.has(p)) ? 'ceiling' : null;
        return { roleId: r.id, name: r.templateKey ?? r.name, rank: r.rank, ok: blockedBy == null, blockedBy: blockedBy as GrantableRole['blockedBy'] };
      });
    },
    async invite(_org, input) {
      if (!canDo('members.invite', input.scopeType === 'shop' ? input.scopeId : undefined)) throw new FixtureError(403, 'forbidden');
      return { id: uid(), devLink: `/admin/invite/${uid().slice(0, 12)}` };
    },
    async assignRole() { /* stored on the real api */ },
    async removeAssignment() { /* stored on the real api */ },
    async saveRole(_org, input) {
      if (!canDo('roles.manage')) throw new FixtureError(403, 'forbidden');
      const existing = roles.find((r) => r.id === input.id);
      if (existing) { Object.assign(existing, { name: input.name, rank: input.rank, permissions: input.permissions }); return existing; }
      const role: Role = { id: uid(), templateKey: null, name: input.name, rank: input.rank, locked: false, permissions: input.permissions, memberCount: 0 };
      roles.push(role);
      return role;
    },

    async dashboard(_org, shopId): Promise<DashboardCards> {
      const ids = shopId ? [shopId] : visibleShops();
      const ls = levels.filter((l) => ids.includes(l.shopId));
      const money = canDo('reports.financial.view');
      const value = ls.reduce((a, l) => {
        const v = products.flatMap((p) => p.variants).find((x) => x.id === l.variantId);
        const p = products.find((x) => x.variants.some((y) => y.id === l.variantId));
        const units = p?.uom === 'piece' ? l.onHand : l.onHand / 1000;
        return a + Math.max(0, units) * (v?.costMinor ?? 0);
      }, 0);
      const today = movements.filter((m) => ids.includes(m.shopId) && m.kind === 'sale' && Date.now() - m.recordedAt < DAY);
      return {
        lowStock: ls.filter((l) => l.reorderPoint != null && l.onHand > 0 && l.onHand <= l.reorderPoint).length,
        outOfStock: ls.filter((l) => l.onHand === 0).length,
        negativeStock: ls.filter((l) => l.onHand < 0).length,
        peopleWaiting: ls.reduce((a, l) => a + l.waiting, 0),
        newFollowersWeek: 23,
        scheduledPosts: posts.filter((p) => p.status === 'scheduled').length,
        pendingApprovals: posts.filter((p) => p.status === 'pending_approval').length,
        countsInReview: 1,
        transfersOnTheWay: ls.filter((l) => l.inTransitIn > 0).length,
        unknownCodes: unknownScans.filter((u) => ids.includes(u.shopId)).length,
        stockValueCostMinor: money ? Math.round(value) : null,
        salesTodayMinor: money ? today.reduce((a, m) => a + -m.qtyDelta * (m.unitPriceMinor ?? 0), 0) : null,
      };
    },
    async salesSeries(_org, shopId, days = 14): Promise<SeriesPoint[]> {
      const ids = shopId ? [shopId] : visibleShops();
      const out: SeriesPoint[] = [];
      for (let d = days - 1; d >= 0; d--) {
        const start = NOW - d * DAY;
        const dayKey = new Date(start).toISOString().slice(0, 10);
        const base = movements.filter((m) => ids.includes(m.shopId) && m.kind === 'sale' && new Date(m.recordedAt).toISOString().slice(0, 10) === dayKey)
          .reduce((a, m) => a + -m.qtyDelta * (m.unitPriceMinor ?? 0), 0);
        const other = ids.filter((s) => s !== 'shop-kifisia').length * (8000 + ((d * 3517) % 6000));
        out.push({ day: dayKey, value: base + other });
      }
      return out;
    },
    async topSellers(_org, shopId) {
      const ids = shopId ? [shopId] : visibleShops();
      const money = canDo('reports.financial.view');
      const agg = new Map<string, { qty: number; value: number }>();
      for (const m of movements) if (m.kind === 'sale' && ids.includes(m.shopId)) {
        const a = agg.get(m.variantId) ?? { qty: 0, value: 0 };
        a.qty += -m.qtyDelta; a.value += -m.qtyDelta * (m.unitPriceMinor ?? 0);
        agg.set(m.variantId, a);
      }
      return [...agg.entries()].map(([variantId, a]) => { const p = products.find((x) => x.variants.some((v) => v.id === variantId))!; return { variantId, name: p.name, qty: a.qty, uom: p.uom, valueMinor: money ? a.value : null }; })
        .sort((x, y) => y.qty - x.qty).slice(0, 6);
    },
    async mostWanted(_org, shopId) {
      const ids = shopId ? [shopId] : visibleShops();
      return levels.filter((l) => ids.includes(l.shopId) && l.waiting > 0)
        .map((l) => ({ variantId: l.variantId, name: products.find((p) => p.variants.some((v) => v.id === l.variantId))!.name, waiting: l.waiting, onHand: l.onHand }))
        .sort((a, b) => b.waiting - a.waiting);
    },
    async joinLinkStats() { return joinLinks.map((j) => ({ joinLinkId: j.id, label: j.label, opens: j.opens, signups: j.signups, confirmed: j.confirmed })); },
    async shrinkage(_org, shopId) {
      const ids = shopId ? [shopId] : visibleShops();
      const money = canDo('reports.financial.view');
      const agg = new Map<string, { qty: number; value: number }>();
      for (const m of movements) if ((m.kind === 'damage' || (m.kind === 'adjust' && m.qtyDelta < 0)) && ids.includes(m.shopId)) {
        const r = m.reason ?? 'correction';
        const a = agg.get(r) ?? { qty: 0, value: 0 };
        const p = products.find((x) => x.variants.some((v) => v.id === m.variantId))!;
        const units = p.uom === 'piece' ? -m.qtyDelta : -m.qtyDelta / 1000;
        a.qty += units; a.value += units * (p.variants[0]!.costMinor ?? 0);
        agg.set(r, a);
      }
      agg.set('theft', agg.get('theft') ?? { qty: 2, value: 1980 });
      return [...agg.entries()].map(([reason, a]) => ({ reason, qty: a.qty, valueMinor: money ? Math.round(a.value) : null }));
    },

    async feed() {
      const items: FeedItem[] = posts.filter((p) => p.status === 'sent').map((post) => ({ post, orgName: settings.name, shopNames: post.audience.scopes.map((s) => scopeName(s.scopeType, s.scopeId)) }));
      return { items, nextCursor: null };
    },
    async offers() {
      return posts.filter((p) => p.kind === 'offer' && p.status === 'sent' && (p.validUntil ?? 0) > Date.now()).map((post) => ({ post, orgName: settings.name, shopNames: post.audience.scopes.map((s) => scopeName(s.scopeType, s.scopeId)) }));
    },
    async catalog(orgSlug, q = {}) {
      if (orgSlug !== settings.slug || settings.customerCatalog === 'off') throw new FixtureError(404, 'not_found');
      let list = products.filter((p) => p.customerVisible && !p.archivedAt);
      if (q.q) list = list.filter((p) => matches(p.key, q.q!));
      if (q.categoryId) list = list.filter((p) => p.categoryId === q.categoryId || categories.find((c) => c.id === p.categoryId)?.parentId === q.categoryId);
      return list.map(publicProduct);
    },
    async publicProduct(orgSlug, productId) {
      const p = products.find((x) => x.id === productId);
      if (orgSlug !== settings.slug || !p) throw new FixtureError(404, 'not_found');
      return publicProduct(p);
    },
    async notifyMe(variantId, shopId) {
      const l = levels.find((x) => x.variantId === variantId && (!shopId || x.shopId === shopId));
      if (l) l.waiting += 1;
    },
    async setFavorite() { /* kept on the real api */ },
    async followedShops() { return shops.map((s) => ({ ...s, orgName: settings.name })); },
    async unfollow() { /* kept on the real api */ },
    async setChannel() { /* kept on the real api */ },
    async exportMyData() { return { customer: customers[0] }; },
    async deleteMyAccount() { /* kept on the real api */ },

    async joinPage(code): Promise<JoinPage> {
      const link = joinLinks.find((j) => j.code === code);
      if (!link) throw new FixtureError(404, 'not_found');
      link.opens += 1;
      const shop = link.scopeType === 'shop' ? shops.find((s) => s.id === link.scopeId) : null;
      return {
        code, orgName: settings.name, scopeName: scopeName(link.scopeType, link.scopeId), scopeType: link.scopeType,
        brandColor: settings.brandColor, logoUrl: settings.logoUrl, imageUrl: shop?.imageUrl ?? IMG.arrivals, disabled: link.disabled,
        interests: categories.filter((c) => c.parentId != null || c.id === 'cat-home' || c.id === 'cat-deli'),
      };
    },
    async join(code, input: JoinInput) {
      const link = joinLinks.find((j) => j.code === code);
      if (!link || link.disabled) throw new FixtureError(410, 'join_link_disabled');
      link.signups += 1;
      void input;
      return { pending: true, devConfirmLink: `/confirm/${code}.${uid().slice(0, 8)}` };
    },
    async confirmJoin(token) {
      const code = token.split('.')[0] ?? '';
      const link = joinLinks.find((j) => j.code === code);
      if (link) link.confirmed += 1;
      return { orgName: settings.name, scopeName: link ? scopeName(link.scopeType, link.scopeId) : settings.name };
    },
    async shelfProduct(code) {
      const norm = code.padStart(14, '0');
      const p = products.find((x) => x.id === code || x.variants.some((v) => v.barcodes.some((b) => b.codeNorm === norm)));
      if (!p) throw new FixtureError(404, 'not_found');
      return publicProduct(p);
    },

    // ------------------------------------------------------------ stage 2
    async archiveProduct(_org, productId) {
      if (!canDo('products.archive')) throw new FixtureError(403, 'forbidden');
      const p = products.find((x) => x.id === productId);
      if (p) { p.archivedAt = Date.now(); logAudit(me(), 'product.archived', 'product', productId); }
    },
    async setBasePrice(_org, variantId, priceMinor) {
      if (!canDo('products.price.edit')) throw new FixtureError(403, 'forbidden');
      const v = products.flatMap((p) => p.variants).find((x) => x.id === variantId);
      if (v) { logAudit(me(), 'product.price_changed', 'variant', variantId, { price: v.priceMinor }, { price: priceMinor }); v.priceMinor = priceMinor; }
    },
    async setShopVariantSettings(_org, shopId, variantId, input) {
      const l = lvl(shopId, variantId);
      if (!l) throw new FixtureError(404, 'not_found');
      if (input.priceOverrideMinor !== undefined) {
        if (!canDo('prices.shop.edit', shopId)) throw new FixtureError(403, 'forbidden');
        const p = productOfVariant(variantId);
        if (p) { if (input.priceOverrideMinor == null) delete p.shopPrices[shopId]; else p.shopPrices[shopId] = input.priceOverrideMinor; }
      }
      if (input.reorderPoint !== undefined) {
        if (!canDo('stock.settings.manage', shopId)) throw new FixtureError(403, 'forbidden');
        l.reorderPoint = input.reorderPoint;
      }
    },
    async nextInternalBarcode() { return { code: ean13(`20${String(3000 + barcodeSeq++).padStart(10, '0')}`) }; },
    async resolveUnknownScan(_org, id, variantId) {
      const i = unknownScans.findIndex((u) => u.id === id);
      if (i < 0) return;
      if (variantId) {
        const v = products.flatMap((p) => p.variants).find((x) => x.id === variantId);
        v?.barcodes.push({ id: uid(), code: unknownScans[i]!.code, codeNorm: unknownScans[i]!.code.padStart(14, '0'), symbology: 'ean13', packQty: 1 });
      }
      unknownScans.splice(i, 1);
    },

    async counts(_org, q = {}) {
      return counts.filter((c) => (!q.shopId || c.shopId === q.shopId) && (!q.status || c.status === q.status) && visibleShops().includes(c.shopId));
    },
    async stockCount(_org, id) {
      const c = counts.find((x) => x.id === id);
      if (!c) throw new FixtureError(404, 'not_found');
      return c;
    },
    async startCount(_org, shopId, input) {
      if (!canDo('stock.count', shopId)) throw new FixtureError(403, 'forbidden');
      const c: StockCount = { id: `count-${uid().slice(0, 8)}`, shopId, kind: input.kind, filter: input.filter ?? null, status: 'open', startedBy: me()!.userId, startedAt: Date.now(), submittedAt: null, appliedBy: null, appliedAt: null, uncountedPolicy: null, lines: [] };
      counts.unshift(c);
      return c;
    },
    async setCountLine(_org, id, variantId, countedQty, mode = 'set') {
      const c = counts.find((x) => x.id === id);
      if (!c || c.status !== 'open') throw new FixtureError(409, 'conflict');
      const p = productOfVariant(variantId)!;
      const expected = lvl(c.shopId, variantId)?.onHand ?? 0;
      let line = c.lines.find((l) => l.variantId === variantId);
      const showCost = canDo('products.cost.view');
      if (!line) {
        line = { variantId, productId: p.id, name: p.name, countedQty: 0, expectedQty: expected, difference: 0, differenceCostMinor: null, countedBy: me()!.userId, countedByName: me()!.name, countedAt: Date.now() };
        c.lines.push(line);
      }
      line.countedQty = mode === 'add' ? line.countedQty + countedQty : countedQty;
      line.expectedQty = expected;
      line.difference = line.countedQty - expected;
      const unit = p.uom === 'piece' ? 1 : 1000;
      line.differenceCostMinor = showCost ? Math.round((line.difference / unit) * (p.variants[0]!.costMinor ?? 0)) : null;
      line.countedAt = Date.now();
      return line as StockCountLine;
    },
    async submitCount(_org, id) {
      const c = counts.find((x) => x.id === id)!;
      c.status = 'review'; c.submittedAt = Date.now();
      return c;
    },
    async applyCount(org, id, policy: UncountedPolicy = 'ignore') {
      const c = counts.find((x) => x.id === id)!;
      if (!canDo('stock.count.approve', c.shopId)) throw new FixtureError(403, 'forbidden');
      const moves: MovementInput[] = c.lines.filter((l) => l.difference !== 0).map((l) => ({ id: uid(), shopId: c.shopId, variantId: l.variantId, qtyDelta: l.difference, kind: 'count', refType: 'count', refId: c.id, occurredAt: Date.now() }));
      if (c.kind === 'full' && policy === 'set_zero') {
        const counted = new Set(c.lines.map((l) => l.variantId));
        for (const l of levels) if (l.shopId === c.shopId && !counted.has(l.variantId) && l.onHand !== 0) moves.push({ id: uid(), shopId: c.shopId, variantId: l.variantId, qtyDelta: -l.onHand, kind: 'count', refType: 'count', refId: c.id, occurredAt: Date.now() });
      }
      if (moves.length) await api.postMovements!(org, moves);
      c.status = 'applied'; c.appliedAt = Date.now(); c.appliedBy = me()!.userId; c.uncountedPolicy = policy;
      logAudit(me(), 'count.applied', 'count', c.id, null, { lines: moves.length });
      return c;
    },
    async cancelCount(_org, id) {
      const c = counts.find((x) => x.id === id)!;
      c.status = 'cancelled';
      return c;
    },

    async transfers(_org, q = {}) {
      const ids = visibleShops();
      return transfers.filter((x) => (ids.includes(x.fromShopId) || ids.includes(x.toShopId)) && (!q.shopId || x.fromShopId === q.shopId || x.toShopId === q.shopId) && (!q.status || x.status === q.status));
    },
    async transfer(_org, id) {
      const x = transfers.find((y) => y.id === id);
      if (!x) throw new FixtureError(404, 'not_found');
      return x;
    },
    async createTransfer(_org, input) {
      if (!canDo('stock.transfer.send', input.fromShopId)) throw new FixtureError(403, 'forbidden');
      const x: Transfer = {
        id: `tr-${uid().slice(0, 8)}`, fromShopId: input.fromShopId, toShopId: input.toShopId, status: 'draft', note: input.note ?? null,
        createdBy: me()!.userId, createdAt: Date.now(), sentAt: null, receivedAt: null,
        lines: input.lines.map((l) => ({ variantId: l.variantId, name: productOfVariant(l.variantId)?.name ?? '', qtySent: l.qty, qtyReceived: null, lost: 0 })),
      };
      transfers.unshift(x);
      return x;
    },
    async sendTransfer(org, id) {
      const x = transfers.find((y) => y.id === id)!;
      if (!canDo('stock.transfer.send', x.fromShopId)) throw new FixtureError(403, 'forbidden');
      await api.postMovements!(org, x.lines.map((l) => ({ id: uid(), shopId: x.fromShopId, variantId: l.variantId, qtyDelta: -l.qtySent, kind: 'transfer_out', refType: 'transfer', refId: x.id, occurredAt: Date.now() })));
      for (const l of x.lines) { const lv = lvl(x.toShopId, l.variantId); if (lv) lv.inTransitIn += l.qtySent; }
      x.status = 'sent'; x.sentAt = Date.now();
      return x;
    },
    async receiveTransfer(org, id, lines) {
      const x = transfers.find((y) => y.id === id)!;
      if (!canDo('stock.transfer.receive', x.toShopId)) throw new FixtureError(403, 'forbidden');
      const got = new Map(lines.map((l) => [l.variantId, l.qtyReceived]));
      const moves: MovementInput[] = [];
      for (const l of x.lines) {
        l.qtyReceived = got.get(l.variantId) ?? l.qtySent;
        l.lost = Math.max(0, l.qtySent - l.qtyReceived);
        const lv = lvl(x.toShopId, l.variantId);
        if (lv) lv.inTransitIn = Math.max(0, lv.inTransitIn - l.qtySent);
        if (l.qtyReceived > 0) moves.push({ id: uid(), shopId: x.toShopId, variantId: l.variantId, qtyDelta: l.qtyReceived, kind: 'transfer_in', refType: 'transfer', refId: x.id, occurredAt: Date.now() });
      }
      if (moves.length) await api.postMovements!(org, moves);
      x.status = 'received'; x.receivedAt = Date.now();
      return x;
    },
    async cancelTransfer(_org, id) {
      const x = transfers.find((y) => y.id === id)!;
      if (x.status !== 'draft') throw new FixtureError(409, 'conflict');
      x.status = 'cancelled';
      return x;
    },

    async addCustomer(_org, input) {
      if (!canDo('customers.add', input.shopId)) throw new FixtureError(403, 'forbidden');
      const row: CustomerRow = {
        id: `c-${uid().slice(0, 6)}`, name: input.name, email: input.email ?? '', phone: null, fullPhone: input.phone ?? '', contactMasked: false,
        locale: input.locale, emailOk: false, pushOk: false, smsOk: false, hasApp: false, source: 'staff', tags: input.tags,
        subscriptions: [{ scopeType: 'shop', scopeId: input.shopId, status: 'pending' }], createdAt: Date.now(),
        consents: [], notes: [], waitingFor: [], favorites: [], deliveries: [], key: searchKey(input.name, input.email),
      };
      customers.unshift(row);
      if (input.email) queueOutbox('email', row, `${settings.name}`, 'Confirm your email to get news and offers.');
      return customerOut(row);
    },
    async eraseCustomer(_org, id) {
      if (!canDo('customers.erase')) throw new FixtureError(403, 'forbidden');
      const c = customers.find((x) => x.id === id);
      if (c) { c.name = null; c.email = ''; c.fullPhone = ''; c.tags = []; c.notes = []; c.key = ''; logAudit(me(), 'customer.erased', 'customer', id); }
    },
    async updateJoinLink(_org, id, patch) {
      const l = joinLinks.find((x) => x.id === id)!;
      if (patch.label !== undefined) l.label = patch.label;
      if (patch.disabled !== undefined) l.disabled = patch.disabled;
      return l;
    },
    async deletePost(_org, id) {
      if (!canDo('posts.delete')) throw new FixtureError(403, 'forbidden');
      const i = posts.findIndex((x) => x.id === id);
      if (i >= 0) posts.splice(i, 1);
    },

    async invites() { return invites; },
    async revokeInvite(_org, id) { const i = invites.findIndex((x) => x.id === id); if (i >= 0) invites.splice(i, 1); },
    async updateMember(_org, membershipId, patch) {
      const p = people.find((x) => x.membershipId === membershipId);
      if (p) logAudit(me(), `member.${patch.status}`, 'member', membershipId);
    },
    async roleImpact(_org, roleId) {
      const names = people.filter((p) => p.assignments.some((a) => a.roleId === roleId)).map((p) => p.name);
      return { members: names.length, names };
    },
    async audit(_org, cursor) {
      if (!canDo('org.audit.view')) throw new FixtureError(403, 'forbidden');
      return page(auditLog, cursor, 50);
    },
    async devOutbox(limit = 100) { return outbox.slice(0, limit); },
    async devRunJobs() { return { ran: 0 }; },
  };
  // anything the sample data does not cover answers like a missing endpoint
  return new Proxy(api, {
    get(target, prop) {
      const v = (target as Record<string | symbol, unknown>)[prop];
      if (v !== undefined || typeof prop === 'symbol') return v;
      return async () => { throw new FixtureError(501, 'internal'); };
    },
  }) as CustockApi;
}

export const FIXTURE_LOGINS = people.map((p) => ({ email: p.email, name: p.name, role: roles.find((r) => r.id === p.assignments[0]!.roleId)!.templateKey! }));
export { FixtureError };
