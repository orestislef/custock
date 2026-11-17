/* made up data for the demo. nothing here is real: names, emails (example.com), phones, barcodes.
   makeData() builds a fresh copy so "reset demo" can start over. */
(function () {
  'use strict';
  const H = 36e5, D = 864e5;

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // ean-13 with a real check digit. 520 is the greek gs1 prefix.
  function ean13(base12) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += Number(base12[i]) * (i % 2 ? 3 : 1);
    return base12 + ((10 - (s % 10)) % 10);
  }

  // permission matrix, exactly the defaults in thinking/03-permissions.md
  // O owner, A admin, M manager, S staff, V viewer
  const MATRIX = {
    'org.settings.manage': 'OA', 'org.billing.manage': 'O', 'org.audit.view': 'OA', 'org.support_access.manage': 'O',
    'shops.create': 'OA', 'shops.archive': 'OA', 'groups.manage': 'OA', 'roles.manage': 'OA', 'categories.manage': 'OA',
    'products.price.edit': 'OA', 'customers.import': 'OA', 'customers.erase': 'OA',
    'members.view': 'OAM', 'members.invite': 'OAM', 'members.manage': 'OAM', 'shop.settings.manage': 'OAM',
    'products.view': 'OAMSV', 'products.create': 'OAM', 'products.edit': 'OAM', 'products.archive': 'OA', 'products.import': 'OA',
    'products.cost.view': 'OAV', 'products.cost.edit': 'OA', 'prices.shop.edit': 'OAM',
    'stock.view': 'OAMSV', 'stock.history.view': 'OAMV', 'stock.receive': 'OAMS', 'stock.sell': 'OAMS', 'stock.return': 'OAMS',
    'stock.adjust': 'OAM', 'stock.count': 'OAMS', 'stock.count.approve': 'OAM', 'stock.transfer.send': 'OAM',
    'stock.transfer.receive': 'OAMS', 'stock.settings.manage': 'OAM',
    'customers.view': 'OAMSV', 'customers.contact.view': 'OAM', 'customers.add': 'OAMS', 'customers.edit': 'OAM', 'customers.export': 'OA',
    'posts.view': 'OAMSV', 'posts.create': 'OAM', 'posts.publish': 'OAM', 'posts.channel.push': 'OAM', 'posts.channel.email': 'OAM',
    'posts.delete': 'OA', 'joinlinks.manage': 'OAM',
    'reports.view': 'OAMV', 'reports.financial.view': 'OAV', 'reports.staff.view': 'OAM'
  };
  const ORG_LEVEL = ['org.settings.manage', 'org.billing.manage', 'org.audit.view', 'org.support_access.manage', 'shops.create', 'shops.archive',
    'groups.manage', 'roles.manage', 'categories.manage', 'products.price.edit', 'customers.import', 'customers.erase'];
  const ANY_LEVEL = ['products.view', 'products.create', 'products.edit', 'products.archive', 'products.import', 'products.cost.view', 'products.cost.edit'];
  const PERM_GROUPS = [
    ['org', ['org.settings.manage', 'org.billing.manage', 'org.audit.view', 'org.support_access.manage', 'shops.create', 'shops.archive', 'groups.manage', 'roles.manage', 'categories.manage', 'products.price.edit', 'customers.import', 'customers.erase']],
    ['team', ['members.view', 'members.invite', 'members.manage', 'shop.settings.manage']],
    ['catalog', ['products.view', 'products.create', 'products.edit', 'products.archive', 'products.import', 'products.cost.view', 'products.cost.edit', 'prices.shop.edit']],
    ['stock', ['stock.view', 'stock.history.view', 'stock.receive', 'stock.sell', 'stock.return', 'stock.adjust', 'stock.count', 'stock.count.approve', 'stock.transfer.send', 'stock.transfer.receive', 'stock.settings.manage']],
    ['customers', ['customers.view', 'customers.contact.view', 'customers.add', 'customers.edit', 'customers.export']],
    ['comms', ['posts.view', 'posts.create', 'posts.publish', 'posts.channel.push', 'posts.channel.email', 'posts.delete', 'joinlinks.manage']],
    ['reports', ['reports.view', 'reports.financial.view', 'reports.staff.view']]
  ];

  function rolesFromMatrix() {
    const letter = { owner: 'O', admin: 'A', manager: 'M', staff: 'S', viewer: 'V' };
    const rank = { owner: 100, admin: 80, manager: 60, staff: 40, viewer: 20 };
    const roles = {};
    Object.keys(letter).forEach(function (k) {
      const perms = Object.keys(MATRIX).filter(function (p) { return MATRIX[p].indexOf(letter[k]) >= 0; });
      roles[k] = { id: k, tpl: k, rank: rank[k], locked: k === 'owner', perms: new Set(perms), custom: false };
    });
    roles.cashier = {
      id: 'cashier', tpl: null, custom: true, rank: 30, locked: false, createdBy: 'nikos',
      name: { en: 'Cashier', el: 'Ταμίας', ru: 'Кассир' },
      perms: new Set(['products.view', 'stock.view', 'stock.sell', 'stock.return', 'customers.view', 'customers.add', 'posts.view'])
    };
    return roles;
  }

  const L = function (en, el, ru) { return { en: en, el: el, ru: ru }; };

  function makeData(now) {
    now = now || Date.now();
    const r = rng(20261117);
    const pick = function (a) { return a[Math.floor(r() * a.length)]; };

    const org = {
      id: 'lemoni', name: 'Lemoni',
      settings: { catalog: 'subscribers', prices: true, stock: 'availability', fewLeft: 3, quietFrom: 22, quietTo: 9, pushCap: 2, needsApproval: false }
    };
    const shops = [
      { id: 'kif', img: 's-kifisia', name: L('Kifisia', 'Κηφισιά', 'Кифисия'), addr: L('12 Kassaveti St, Kifisia', 'Κασσαβέτη 12, Κηφισιά', 'ул. Кассавети 12, Кифисия'), hours: '09:00 to 21:00', customerStock: null, visible: true },
      { id: 'mar', img: 's-marousi', name: L('Marousi', 'Μαρούσι', 'Маруси'), addr: L('40 Ermou St, Marousi', 'Ερμού 40, Μαρούσι', 'ул. Эрму 40, Маруси'), hours: '09:00 to 21:00', customerStock: null, visible: true },
      { id: 'gly', img: 's-glyfada', name: L('Glyfada', 'Γλυφάδα', 'Глифада'), addr: L('7 Metaxa St, Glyfada', 'Μεταξά 7, Γλυφάδα', 'ул. Метакса 7, Глифада'), hours: '10:00 to 22:00', customerStock: null, visible: true }
    ];
    const groups = [{ id: 'nath', name: L('North Athens', 'Βόρεια Αθήνα', 'Северные Афины'), shops: ['kif', 'mar'] }];
    const categories = [
      { id: 'pantry', name: L('Pantry', 'Κελάρι', 'Бакалея') },
      { id: 'deli', name: L('Deli', 'Τυροκομικά', 'Деликатесы') },
      { id: 'drinks', name: L('Drinks', 'Ποτά', 'Напитки') },
      { id: 'home', name: L('Home', 'Σπίτι', 'Для дома') },
      { id: 'care', name: L('Body care', 'Περιποίηση', 'Уход') }
    ];

    const members = [
      { id: 'eleni', name: 'Eleni Papadopoulou', email: 'eleni@example.com', tile: 1, status: 'active', assign: [{ role: 'owner', scope: 'org', id: 'lemoni' }] },
      { id: 'nikos', name: 'Nikos Georgiou', email: 'nikos@example.com', tile: 2, status: 'active', assign: [{ role: 'admin', scope: 'org', id: 'lemoni' }] },
      { id: 'maria', name: 'Maria Ioannou', email: 'maria@example.com', tile: 3, status: 'active', assign: [{ role: 'manager', scope: 'shop', id: 'kif' }] },
      { id: 'dimitris', name: 'Dimitris Kostas', email: 'dimitris@example.com', tile: 4, status: 'active', assign: [{ role: 'staff', scope: 'shop', id: 'kif' }] },
      { id: 'sofia', name: 'Sofia Antoniou', email: 'sofia@example.com', tile: 6, status: 'active', assign: [{ role: 'viewer', scope: 'org', id: 'lemoni' }] },
      { id: 'irina', name: 'Irina Volkova', email: 'irina@example.com', tile: 2, status: 'active', assign: [{ role: 'manager', scope: 'group', id: 'nath' }] },
      { id: 'petros', name: 'Petros Lambrou', email: 'petros@example.com', tile: 5, status: 'active', assign: [{ role: 'manager', scope: 'shop', id: 'mar' }] },
      { id: 'alexei', name: 'Alexei Morozov', email: 'alexei@example.com', tile: 3, status: 'active', assign: [{ role: 'staff', scope: 'shop', id: 'kif' }] },
      { id: 'katerina', name: 'Katerina Vlachou', email: 'katerina@example.com', tile: 1, status: 'active', assign: [{ role: 'staff', scope: 'shop', id: 'mar' }] },
      { id: 'giorgos', name: 'Giorgos Nikolaou', email: 'giorgos@example.com', tile: 4, status: 'active', assign: [{ role: 'cashier', scope: 'shop', id: 'gly' }] },
      { id: 'christina', name: 'Christina Pappa', email: 'christina@example.com', tile: 6, status: 'suspended', assign: [{ role: 'staff', scope: 'shop', id: 'kif' }] }
    ];

    // products. prices and costs in cents, with vat. stock per shop.
    let n = 0;
    function V(id, opt, price, cost, stock, rp) {
      n += 1;
      return { id: id, opt: opt, price: price, cost: cost, stock: stock, rp: rp || { kif: 4, mar: 4, gly: 4 },
        sku: 'LEM-' + String(100 + n), barcodes: [ean13('5201234' + String(10000 + n * 37).slice(-5))] };
    }
    const products = [
      { id: 'olive-oil', img: 'p-olive-oil', cat: 'pantry', vat: 13, pop: 1.8,
        name: L('Extra virgin olive oil 1 l', 'Εξαιρετικό παρθένο ελαιόλαδο 1 l', 'Оливковое масло extra virgin, 1 л'),
        desc: L('Koroneiki, new harvest from Messinia.', 'Κορωνέικη, νέα σοδειά από τη Μεσσηνία.', 'Сорт коронейки, новый урожай из Мессинии.'),
        variants: [V('olive-oil', null, 1490, 820, { kif: 24, mar: 18, gly: 31 }, { kif: 8, mar: 8, gly: 8 })] },
      { id: 'thyme-honey', img: 'p-thyme-honey', cat: 'pantry', vat: 13, pop: 1.1,
        name: L('Thyme honey 450 g', 'Θυμαρίσιο μέλι 450 g', 'Тимьяновый мёд, 450 г'),
        desc: L('Raw, from Crete.', 'Ακατέργαστο, από την Κρήτη.', 'Сырой, с Крита.'),
        variants: [V('thyme-honey', null, 1250, 690, { kif: 6, mar: 11, gly: 7 }, { kif: 5, mar: 5, gly: 5 })] },
      { id: 'greek-coffee', img: 'p-greek-coffee', cat: 'pantry', vat: 13, pop: 2.6,
        name: L('Greek coffee 200 g', 'Ελληνικός καφές 200 g', 'Греческий кофе, 200 г'),
        desc: L('Freshly ground, medium roast.', 'Φρεσκοαλεσμένος, μέτριο καβούρδισμα.', 'Свежемолотый, средняя обжарка.'),
        variants: [V('greek-coffee', null, 420, 210, { kif: 40, mar: 36, gly: 22 }, { kif: 10, mar: 10, gly: 10 })] },
      { id: 'mastiha', img: 'p-mastiha', cat: 'drinks', vat: 24, pop: 0.6,
        name: L('Chios mastiha liqueur 500 ml', 'Λικέρ μαστίχα Χίου 500 ml', 'Ликёр мастика с Хиоса, 500 мл'),
        desc: L('Serve it ice cold.', 'Σερβίρεται παγωμένο.', 'Подавать охлаждённым.'),
        variants: [V('mastiha', null, 1890, 1040, { kif: 9, mar: 6, gly: 12 })] },
      { id: 'olive-soap', img: 'p-olive-soap', cat: 'care', vat: 24, pop: 0.8,
        name: L('Olive oil soap', 'Σαπούνι ελαιολάδου', 'Мыло на оливковом масле'),
        desc: L('Handmade, unscented.', 'Χειροποίητο, χωρίς άρωμα.', 'Ручной работы, без отдушек.'),
        variants: [V('olive-soap', null, 380, 140, { kif: 52, mar: 0, gly: 15 }, { kif: 10, mar: 10, gly: 10 })] },
      { id: 'ceramic-cup', img: 'p-ceramic-cup', cat: 'home', vat: 24, pop: 0.5,
        name: L('Ceramic cup', 'Κεραμική κούπα', 'Керамическая чашка'),
        desc: L('Glazed by hand in Sifnos.', 'Εφυαλωμένη στο χέρι στη Σίφνο.', 'Глазурь ручной работы, Сифнос.'),
        variants: [V('ceramic-cup-250', L('250 ml', '250 ml', '250 мл'), 900, 350, { kif: 6, mar: 4, gly: 0 }, { kif: 2, mar: 2, gly: 2 }),
          V('ceramic-cup-350', L('350 ml', '350 ml', '350 мл'), 1100, 420, { kif: 2, mar: 5, gly: 3 }, { kif: 2, mar: 2, gly: 2 })] },
      { id: 'linen-tote', img: 'p-linen-tote', cat: 'home', vat: 24, pop: 0.4,
        name: L('Linen tote bag', 'Λινή τσάντα', 'Льняная сумка-шопер'),
        desc: L('Washed linen, long handles.', 'Πλυμένο λινό, μακριά χερούλια.', 'Стираный лён, длинные ручки.'),
        variants: [V('linen-tote-natural', L('Natural', 'Φυσικό', 'Натуральный'), 1600, 600, { kif: 5, mar: 3, gly: 4 }, { kif: 2, mar: 2, gly: 2 }),
          V('linen-tote-black', L('Black', 'Μαύρο', 'Чёрный'), 1600, 600, { kif: 1, mar: 4, gly: 2 }, { kif: 2, mar: 2, gly: 2 }),
          V('linen-tote-olive', L('Olive', 'Λαδί', 'Оливковый'), 1600, 600, { kif: 0, mar: 2, gly: 3 }, { kif: 2, mar: 2, gly: 2 })] },
      { id: 'sea-salt', img: 'p-sea-salt', cat: 'pantry', vat: 13, pop: 0.7,
        name: L('Sea salt flakes 250 g', 'Ανθός αλατιού 250 g', 'Морская соль хлопьями, 250 г'),
        desc: L('Hand harvested in Messolonghi.', 'Μαζεμένος στο χέρι στο Μεσολόγγι.', 'Собрана вручную в Месолонги.'),
        variants: [V('sea-salt', null, 540, 220, { kif: 14, mar: -2, gly: 9 })] },
      { id: 'mountain-tea', img: 'p-mountain-tea', cat: 'pantry', vat: 13, pop: 0.9,
        name: L('Greek mountain tea', 'Τσάι του βουνού', 'Греческий горный чай'),
        desc: L('Sideritis from Mount Olympus.', 'Σιδερίτης από τον Όλυμπο.', 'Сидеритис с горы Олимп.'),
        variants: [V('mountain-tea', null, 490, 180, { kif: 0, mar: 8, gly: 5 }, { kif: 4, mar: 4, gly: 4 })] },
      { id: 'loukoumi', img: 'p-loukoumi', cat: 'pantry', vat: 13, pop: 0.7,
        name: L('Rose loukoumi', 'Λουκούμι τριαντάφυλλο', 'Лукум с розой'),
        desc: L('From Syros, the classic.', 'Από τη Σύρο, το κλασικό.', 'С острова Сирос, классика.'),
        variants: [V('loukoumi', null, 650, 290, { kif: 17, mar: 2, gly: 10 })] },
      { id: 'tahini', img: 'p-tahini', cat: 'pantry', vat: 13, pop: 0.5,
        name: L('Wholegrain tahini', 'Ταχίνι ολικής άλεσης', 'Тахини из цельного кунжута'),
        desc: L('Stone ground, nothing added.', 'Αλεσμένο σε πέτρα, χωρίς πρόσθετα.', 'Перемолот на камне, без добавок.'),
        variants: [V('tahini', null, 590, 280, { kif: 11, mar: 9, gly: 4 })] },
      { id: 'pistachio', img: 'p-pistachio', cat: 'pantry', vat: 13, pop: 0.6,
        name: L('Aegina pistachios 200 g', 'Φιστίκι Αιγίνης 200 g', 'Фисташки с Эгины, 200 г'),
        desc: L('Roasted and lightly salted.', 'Καβουρδισμένο, ελαφρά αλατισμένο.', 'Обжаренные, слегка солёные.'),
        variants: [V('pistachio', null, 980, 560, { kif: 2, mar: 7, gly: 13 })] },
      { id: 'candle', img: 'p-candle', cat: 'home', vat: 24, pop: 0.3,
        name: L('Fig leaf soy candle', 'Κερί σόγιας φύλλο συκιάς', 'Соевая свеча «Лист инжира»'),
        desc: L('About 40 hours of burn time.', 'Περίπου 40 ώρες καύσης.', 'Около 40 часов горения.'),
        variants: [V('candle', null, 1900, 750, { kif: 6, mar: 4, gly: 0 }, { kif: 2, mar: 2, gly: 2 })] },
      { id: 'feta', img: 'p-feta', cat: 'deli', vat: 13, pop: 1.2,
        name: L('Epirus feta PDO 400 g', 'Φέτα ΠΟΠ Ηπείρου 400 g', 'Фета PDO из Эпира, 400 г'),
        desc: L('Barrel aged, creamy and salty.', 'Ωρίμανση σε βαρέλι, κρεμώδης και αλμυρή.', 'Выдержана в бочке, сливочная и солёная.'),
        variants: [V('feta', null, 790, 480, { kif: 13, mar: 10, gly: 8 })] }
    ];
    const variants = {};
    products.forEach(function (p) { p.variants.forEach(function (v) { v.pid = p.id; variants[v.id] = v; }); });

    // price history: mastiha had an offer two weeks ago, so its "was" price is 17.50, not 18.90
    const priceHistory = [
      { vid: 'mastiha', price: 1890, from: now - 90 * D, to: now - 14 * D },
      { vid: 'mastiha', price: 1750, from: now - 14 * D, to: now - 9 * D, offer: true },
      { vid: 'mastiha', price: 1890, from: now - 9 * D, to: null },
      { vid: 'loukoumi', price: 650, from: now - 90 * D, to: null }
    ];

    // customers. a few by hand, the rest generated.
    const grF = ['Μαρία', 'Ελένη', 'Κατερίνα', 'Γεωργία', 'Σοφία', 'Δήμητρα', 'Αγγελική', 'Ιωάννα', 'Βασιλική', 'Χριστίνα', 'Δέσποινα', 'Αναστασία', 'Φωτεινή', 'Νίκη'];
    const grM = ['Γιώργος', 'Νίκος', 'Δημήτρης', 'Κώστας', 'Γιάννης', 'Χρήστος', 'Παναγιώτης', 'Βασίλης', 'Αλέξανδρος', 'Μιχάλης', 'Θανάσης', 'Σπύρος', 'Στέλιος', 'Άγγελος'];
    const grS = [['Παπαδόπουλος', 'Παπαδοπούλου'], ['Γεωργίου', 'Γεωργίου'], ['Δημητρίου', 'Δημητρίου'], ['Νικολάου', 'Νικολάου'], ['Ιωάννου', 'Ιωάννου'], ['Παπαδάκης', 'Παπαδάκη'], ['Οικονόμου', 'Οικονόμου'], ['Μαυρίδης', 'Μαυρίδου'], ['Αλεξίου', 'Αλεξίου'], ['Ζαχαρίου', 'Ζαχαρίου'], ['Κωνσταντίνου', 'Κωνσταντίνου'], ['Βλάχος', 'Βλάχου'], ['Αθανασίου', 'Αθανασίου'], ['Μακρής', 'Μακρή'], ['Σταματόπουλος', 'Σταματοπούλου'], ['Πετρίδης', 'Πετρίδου'], ['Ρήγας', 'Ρήγα'], ['Λαμπράκης', 'Λαμπράκη']];
    const ruF = ['Анна', 'Мария', 'Елена', 'Ольга', 'Наталья', 'Ирина', 'Татьяна', 'Екатерина', 'Светлана', 'Юлия', 'Дарья'];
    const ruM = ['Иван', 'Дмитрий', 'Алексей', 'Сергей', 'Андрей', 'Максим', 'Николай', 'Олег', 'Павел', 'Артём'];
    const ruS = [['Иванов', 'Иванова'], ['Петров', 'Петрова'], ['Смирнов', 'Смирнова'], ['Кузнецов', 'Кузнецова'], ['Попов', 'Попова'], ['Соколов', 'Соколова'], ['Волков', 'Волкова'], ['Морозов', 'Морозова'], ['Новиков', 'Новикова'], ['Фёдоров', 'Фёдорова'], ['Лебедев', 'Лебедева'], ['Козлов', 'Козлова']];
    const enN = ['Emma Clarke', 'Tom Becker', 'Laura Smith', 'James Wilson', 'Sophie Martin', 'Lucas Meyer', 'Hannah Berg', 'Olivia Brown'];
    const TAGS = ['regular', 'olive oil club', 'wholesale', 'vip', 'tasting', 'gifts'];

    const tr = window.CSText.translit;
    function emailOf(name, i) {
      const parts = tr(name).replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
      return (parts[0] || 'guest') + '.' + (parts[1] || 'c') + (i > 40 ? i : '') + '@example.com';
    }
    function phoneOf() { return '+30 69' + Math.floor(10000000 + r() * 89999999); }

    const customers = [];
    function addCustomer(c) {
      c.id = c.id || 'c' + (customers.length + 1);
      c.email = c.email || emailOf(c.name, customers.length);
      c.phone = c.phone || phoneOf();
      c.tags = c.tags || [];
      c.notes = c.notes || [];
      c.consents = c.consents || [];
      c.created = c.created || now - Math.floor(r() * 200) * D;
      c.pushesToday = c.pushesToday || 0;
      customers.push(c);
      return c;
    }
    function consentLog(c, src) {
      if (c.emailOk) c.consents.push({ ch: 'email', granted: true, at: c.created + 2 * H, src: 'double_opt_in', text: c.locale + '-2026-09' });
      if (c.pushOk) c.consents.push({ ch: 'push', granted: true, at: c.created + 3 * H, src: 'app', text: c.locale + '-2026-09' });
      if (src === 'withdrawn') c.consents.push({ ch: 'email', granted: false, at: now - 6 * D, src: 'unsubscribe_link', text: c.locale + '-2026-09' });
    }

    const anna = addCustomer({
      id: 'c-anna', name: 'Anna Sokolova', locale: 'ru', email: 'anna.sokolova@example.com', phone: '+30 694 512 3378',
      emailOk: true, emailVerified: true, hasApp: true, pushOk: true, source: 'join_link', link: 'jl-kif-window',
      subs: [{ scope: 'group', id: 'nath', status: 'subscribed', at: now - 120 * D }], tags: ['regular', 'olive oil club'],
      interests: ['pantry', 'drinks'], created: now - 120 * D,
      notes: [{ by: 'maria', at: now - 20 * D, text: L('Asks for mountain tea every week.', 'Ρωτάει για τσάι του βουνού κάθε εβδομάδα.', 'Каждую неделю спрашивает горный чай.') }]
    });
    consentLog(anna);

    const hand = [
      ['Γιώργος Παπαδόπουλος', 'el', 'kif'], ['Ελένη Δημητρίου', 'el', 'kif'], ['Иван Петров', 'ru', 'mar'], ['Мария Кузнецова', 'ru', 'kif'],
      ['Katerina Lazarou', 'el', 'gly'], ['Νίκος Αλεξίου', 'el', 'org'], ['Emma Clarke', 'en', 'gly'], ['Σοφία Μαυρίδου', 'el', 'nath'],
      ['Dmitry Volkov', 'ru', 'mar'], ['Χρήστος Ζαχαρίου', 'el', 'kif'], ['Олег Смирнов', 'ru', 'org'], ['Βασιλική Ρήγα', 'el', 'mar']
    ];
    hand.forEach(function (h, i) {
      const scope = h[2] === 'org' ? 'org' : h[2] === 'nath' ? 'group' : 'shop';
      const c = addCustomer({ name: h[0], locale: h[1], emailOk: i % 3 !== 2, emailVerified: true, hasApp: i % 2 === 0, pushOk: i % 2 === 0,
        source: i % 4 === 3 ? 'staff' : 'join_link', subs: [{ scope: scope, id: h[2] === 'org' ? 'lemoni' : h[2], status: 'subscribed', at: now - (30 + i * 7) * D }],
        tags: i % 3 === 0 ? ['regular'] : i % 5 === 1 ? ['vip', 'tasting'] : [], interests: [pick(['pantry', 'deli', 'drinks', 'home', 'care'])], created: now - (30 + i * 7) * D });
      consentLog(c);
    });

    for (let i = 0; i < 330; i++) {
      const kind = r();
      let name, locale;
      if (kind < 0.66) { const f = r() < 0.55; const s = pick(grS); name = (f ? pick(grF) : pick(grM)) + ' ' + (f ? s[1] : s[0]); locale = 'el'; if (r() < 0.25) name = tr(name).replace(/\b\w/g, function (m) { return m.toUpperCase(); }); }
      else if (kind < 0.92) { const f = r() < 0.6; const s = pick(ruS); name = (f ? pick(ruF) : pick(ruM)) + ' ' + (f ? s[1] : s[0]); locale = 'ru'; }
      else { name = pick(enN); locale = 'en'; }
      const x = r();
      const sub = x < 0.12 ? { scope: 'org', id: 'lemoni' } : x < 0.27 ? { scope: 'group', id: 'nath' } : x < 0.6 ? { scope: 'shop', id: 'kif' } : x < 0.82 ? { scope: 'shop', id: 'mar' } : { scope: 'shop', id: 'gly' };
      const created = now - Math.floor(Math.pow(r(), 1.6) * 220 * D) - Math.floor(r() * 20) * H;
      sub.status = r() < 0.04 ? 'unsubscribed' : 'subscribed';
      sub.at = created;
      const subs = [sub];
      if (r() < 0.12 && sub.scope === 'shop') subs.push({ scope: 'shop', id: sub.id === 'gly' ? 'kif' : 'gly', status: 'subscribed', at: created + 20 * D });
      const hasApp = r() < 0.62;
      const emailOk = r() < 0.7;
      const c = addCustomer({ name: name, locale: locale, emailOk: emailOk, emailVerified: emailOk ? r() < 0.93 : r() < 0.5, hasApp: hasApp, pushOk: hasApp && r() < 0.86,
        source: r() < 0.78 ? 'join_link' : r() < 0.6 ? 'staff' : 'import', subs: subs, created: created,
        tags: r() < 0.3 ? [pick(TAGS)] : [], interests: r() < 0.5 ? [pick(['pantry', 'deli', 'drinks', 'home', 'care'])] : [],
        pushesToday: r() < 0.05 ? 2 : r() < 0.15 ? 1 : 0 });
      c.link = c.source === 'join_link' ? (sub.id === 'kif' ? 'jl-kif-window' : sub.id === 'mar' ? 'jl-mar-receipt' : sub.id === 'gly' ? 'jl-gly-window' : 'jl-insta') : null;
      consentLog(c, r() < 0.03 ? 'withdrawn' : null);
    }

    // join links and how they perform
    const links = [
      { id: 'jl-kif-window', code: 'kif-window', scope: 'shop', sid: 'kif', label: L('Window poster', 'Αφίσα στη βιτρίνα', 'Плакат на витрине'), opens: 420, signups: 96, confirmed: 81 },
      { id: 'jl-insta', code: 'lemoni', scope: 'org', sid: 'lemoni', label: L('Instagram bio', 'Bio στο Instagram', 'Профиль в Instagram'), opens: 1310, signups: 140, confirmed: 118 },
      { id: 'jl-mar-receipt', code: 'mar-receipt', scope: 'shop', sid: 'mar', label: L('Printed receipt', 'Τυπωμένη απόδειξη', 'Печатный чек'), opens: 210, signups: 61, confirmed: 55 },
      { id: 'jl-gly-window', code: 'gly-window', scope: 'shop', sid: 'gly', label: L('Window poster', 'Αφίσα στη βιτρίνα', 'Плакат на витрине'), opens: 180, signups: 44, confirmed: 39 },
      { id: 'jl-gly-tasting', code: 'gly-tasting', scope: 'shop', sid: 'gly', label: L('Tasting night', 'Βραδιά γευσιγνωσίας', 'Вечер дегустации'), opens: 95, signups: 40, confirmed: 37 }
    ];

    // the ledger. 14 days of sales, some receives, some losses.
    const staffBy = { kif: ['dimitris', 'alexei', 'maria'], mar: ['katerina', 'petros'], gly: ['giorgos'] };
    const ledger = [];
    let mid = 0;
    function mv(o) { mid += 1; o.id = 'm' + mid; ledger.push(o); }
    const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
    const t0 = today0.getTime();
    products.forEach(function (p) {
      p.variants.forEach(function (v) {
        ['kif', 'mar', 'gly'].forEach(function (s) {
          const shopMul = s === 'kif' ? 1.15 : s === 'mar' ? 1 : 0.8;
          for (let d = 13; d >= 0; d--) {
            const rate = p.pop * shopMul / p.variants.length;
            let k = 0; let lam = rate; while (r() < lam / (k + 1) && k < 6) { k += 1; lam *= 0.8; }
            for (let j = 0; j < k; j++) {
              if (p.id === 'mountain-tea' && s === 'kif' && d < 2) continue;
              const at = t0 - d * D + (9 + Math.floor(r() * 11)) * H + Math.floor(r() * 59) * 6e4;
              if (at > now) continue;
              mv({ shop: s, vid: v.id, delta: -1 * (r() < 0.15 ? 2 : 1), kind: 'sale', by: pick(staffBy[s]), at: at, price: v.price });
            }
          }
          const recDay = 3 + Math.floor(r() * 9);
          mv({ shop: s, vid: v.id, delta: 6 + Math.floor(r() * 18), kind: 'receive', by: s === 'kif' ? 'maria' : s === 'mar' ? 'petros' : 'eleni', at: t0 - recDay * D + 9 * H + 15 * 6e4, cost: v.cost });
        });
      });
    });
    // the last tea in kifisia sold two days ago, since then people ask for it
    mv({ shop: 'kif', vid: 'mountain-tea', delta: -1, kind: 'sale', by: 'dimitris', at: t0 - 2 * D + 18 * H + 40 * 6e4, price: 490 });
    [['ceramic-cup-250', 'kif', -2, 'damage', 'damaged', 'alexei', 5], ['feta', 'gly', -1, 'damage', 'expired', 'giorgos', 3], ['pistachio', 'kif', -2, 'adjust', 'theft', 'maria', 8],
      ['greek-coffee', 'mar', -1, 'adjust', 'own_use', 'petros', 2], ['olive-soap', 'mar', -3, 'adjust', 'lost', 'katerina', 6], ['candle', 'kif', -1, 'damage', 'damaged', 'dimitris', 4],
      ['sea-salt', 'mar', -2, 'damage', 'damaged', 'katerina', 1], ['feta', 'kif', -1, 'damage', 'expired', 'maria', 9], ['olive-soap', 'kif', 2, 'adjust', 'found', 'maria', 10]
    ].forEach(function (a) { mv({ vid: a[0], shop: a[1], delta: a[2], kind: a[3], reason: a[4], by: a[5], at: t0 - a[6] * D + 13 * H, cost: variants[a[0]].cost }); });
    ledger.sort(function (a, b) { return b.at - a.at; });

    // who waits for what. 14 people wait for mountain tea in kifisia, anna is one of them.
    function reaches(c, shop) {
      const g = groups.filter(function (x) { return x.shops.indexOf(shop) >= 0; }).map(function (x) { return x.id; });
      const sh = c.subs.find(function (s) { return s.scope === 'shop' && s.id === shop; });
      if (sh) return sh.status === 'subscribed';
      const gr = c.subs.find(function (s) { return s.scope === 'group' && g.indexOf(s.id) >= 0; });
      if (gr) return gr.status === 'subscribed';
      const o = c.subs.find(function (s) { return s.scope === 'org'; });
      return !!(o && o.status === 'subscribed');
    }
    const alerts = [];
    let aid = 0;
    function waitFor(vid, shop, count, first) {
      const pool = customers.filter(function (c) { return c.id !== 'c-anna' && reaches(c, shop); });
      const chosen = first ? [first] : [];
      let i = 7;
      while (chosen.length < count && i < pool.length) { chosen.push(pool[i]); i += 5; }
      chosen.forEach(function (c, k) { aid += 1; alerts.push({ id: 'a' + aid, cid: c.id, vid: vid, shop: shop, status: 'waiting', at: now - (k + 1) * 7 * H }); });
    }
    waitFor('mountain-tea', 'kif', 14, anna);
    waitFor('linen-tote-olive', 'kif', 6);
    waitFor('candle', 'gly', 5);
    waitFor('olive-soap', 'mar', 3);
    waitFor('ceramic-cup-250', 'gly', 2);

    const favorites = new Set(['c-anna|olive-oil', 'c-anna|thyme-honey']);

    const posts = [
      { id: 'p-harvest', kind: 'new_arrival', status: 'sent', author: 'eleni', scopes: [{ scope: 'org', id: 'lemoni' }], img: 'post-harvest',
        channels: ['feed', 'push', 'email'], sentAt: now - 3 * D + 2 * H, products: [{ vid: 'olive-oil' }, { vid: 'thyme-honey' }, { vid: 'mountain-tea' }],
        title: L('The new harvest is in', 'Ήρθε η νέα σοδειά', 'Новый урожай уже здесь'),
        body: L('Fresh Koroneiki olive oil, raw thyme honey from Crete and mountain tea from Olympus. In all three shops from today.',
          'Φρέσκο ελαιόλαδο κορωνέικη, ακατέργαστο θυμαρίσιο μέλι από την Κρήτη και τσάι του βουνού από τον Όλυμπο. Σε όλα τα καταστήματα από σήμερα.',
          'Свежее оливковое масло коронейки, сырой тимьяновый мёд с Крита и горный чай с Олимпа. С сегодняшнего дня во всех трёх магазинах.'),
        stats: { reached: 298, pushSent: 161, pushOpened: 72, emailSent: 190, emailOpened: 88, feedViews: 241 } },
      { id: 'p-offer', kind: 'offer', status: 'sent', author: 'nikos', scopes: [{ scope: 'group', id: 'nath' }], img: 'post-offer',
        channels: ['feed', 'push'], sentAt: now - 1 * D, validFrom: now - 1 * D, validUntil: now + 4 * D,
        products: [{ vid: 'mastiha', offer: 1490 }, { vid: 'loukoumi', offer: 520 }],
        title: L('Up to 20% off mastiha and loukoumi', 'Έως 20% έκπτωση σε μαστίχα και λουκούμι', 'Скидки до 20% на мастику и лукум'),
        body: L('Until Sunday in Kifisia and Marousi. Perfect with a Greek coffee.', 'Έως την Κυριακή σε Κηφισιά και Μαρούσι. Ταιριάζει τέλεια με ελληνικό καφέ.', 'До воскресенья в Кифисии и Маруси. Идеально к греческому кофе.'),
        stats: { reached: 212, pushSent: 118, pushOpened: 49, emailSent: 0, emailOpened: 0, feedViews: 166 } },
      { id: 'p-event', kind: 'event', status: 'scheduled', author: 'eleni', scopes: [{ scope: 'shop', id: 'gly' }], img: 'post-event',
        channels: ['feed', 'push', 'email'], scheduledAt: now + 1 * D + 3 * H, products: [{ vid: 'olive-oil' }],
        title: L('Olive oil tasting on Saturday', 'Γευσιγνωσία ελαιολάδου το Σάββατο', 'Дегустация оливкового масла в субботу'),
        body: L('Saturday 11:00 to 14:00 at our Glyfada shop. Free, bring your friends.', 'Σάββατο 11:00 με 14:00 στο κατάστημα της Γλυφάδας. Δωρεάν, φέρτε και την παρέα σας.', 'В субботу с 11:00 до 14:00 в нашем магазине в Глифаде. Вход свободный, приходите с друзьями.') },
      { id: 'p-feta', kind: 'new_arrival', status: 'pending', author: 'maria', scopes: [{ scope: 'shop', id: 'kif' }], img: 'post-new-arrivals',
        channels: ['feed', 'push'], products: [{ vid: 'feta' }], createdAt: now - 4 * H,
        title: L('Fresh feta from Epirus is in', 'Ήρθε φρέσκια φέτα Ηπείρου', 'Свежая фета из Эпира уже в продаже'),
        body: L('Barrel aged, creamy and salty. Only at Kifisia this week.', 'Ωρίμανση σε βαρέλι, κρεμώδης και αλμυρή. Μόνο στην Κηφισιά αυτή την εβδομάδα.', 'Выдержана в бочке, сливочная и солёная. Только в Кифисии на этой неделе.') }
    ];

    // a second business anna follows. it keeps its catalog in the shop (catalog off).
    const otherOrgs = [{
      id: 'anemos', name: L('Anemos bakery', 'Φούρνος Άνεμος', 'Пекарня «Анемос»'), catalog: 'off', tile: 'bakery', letter: L('A', 'Α', 'А'),
      shop: L('Pagrati', 'Παγκράτι', 'Панграти'),
      posts: [{ id: 'p-anemos', kind: 'news', sentAt: now - 2 * D - 5 * H, img: null,
        title: L('Sourdough is back on Sundays', 'Το προζυμένιο ψωμί επιστρέφει τις Κυριακές', 'Хлеб на закваске снова по воскресеньям'),
        body: L('From this week, from 8:00 until it runs out.', 'Από αυτή την εβδομάδα, από τις 8:00 μέχρι να τελειώσει.', 'С этой недели, с 8:00 и пока не закончится.') }]
    }];

    const unknownCodes = [{ code: ean13('520999887766'), shop: 'kif', by: 'dimitris', at: now - 5 * H, times: 2 }];

    const notifs = {
      anna: [
        { id: 'n1', org: 'lemoni', merchant: L('Lemoni Kifisia', 'Lemoni Κηφισιά', 'Lemoni Кифисия'), title: posts[1].title, body: posts[1].body, img: 'post-offer', at: now - 1 * D, route: { role: 'anna', tab: 'c-offers', name: 'c-post', params: { id: 'p-offer' } } },
        { id: 'n2', org: 'anemos', merchant: otherOrgs[0].name, title: otherOrgs[0].posts[0].title, body: otherOrgs[0].posts[0].body, img: null, at: now - 2 * D - 5 * H, route: { role: 'anna', tab: 'c-home', name: 'c-home' } },
        { id: 'n3', org: 'lemoni', merchant: L('Lemoni', 'Lemoni', 'Lemoni'), title: posts[0].title, body: posts[0].body, img: 'post-harvest', at: now - 3 * D + 2 * H, route: { role: 'anna', tab: 'c-home', name: 'c-post', params: { id: 'p-harvest' } } }
      ],
      maria: [
        { id: 'n4', org: 'lemoni', merchant: L('Lemoni Kifisia', 'Lemoni Κηφισιά', 'Lemoni Кифисия'), title: L('Low stock', 'Χαμηλό απόθεμα', 'Заканчивается'),
          body: L('Aegina pistachios are down to 2 (reorder at 4).', 'Το φιστίκι Αιγίνης έπεσε στα 2 (παραγγελία στα 4).', 'Фисташек с Эгины осталось 2 (заказ при 4).'), img: 'p-pistachio', at: now - 6 * H, route: { role: 'maria', tab: 'stock', name: 'product', params: { pid: 'pistachio' } } }
      ],
      dimitris: [], eleni: [], nikos: [], sofia: []
    };

    return {
      now: now, org: org, shops: shops, groups: groups, categories: categories, roles: rolesFromMatrix(), members: members,
      products: products, variants: variants, priceHistory: priceHistory, customers: customers, links: links, ledger: ledger,
      alerts: alerts, favorites: favorites, posts: posts, otherOrgs: otherOrgs, unknownCodes: unknownCodes, notifs: notifs,
      transfers: [], counts: [], audit: [], permsVersion: { maria: 1 }
    };
  }

  window.CSData = { makeData: makeData, ean13: ean13, ORG_LEVEL: ORG_LEVEL, ANY_LEVEL: ANY_LEVEL, PERM_GROUPS: PERM_GROUPS, MATRIX: MATRIX };
})();
