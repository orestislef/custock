/* custock demo app. plain js, no build step.
   everything visible comes from i18n.js. permissions follow thinking/03-permissions.md. */
(function () {
  'use strict';
  const H = 36e5, D = 864e5;
  const LOC = { en: 'en-GB', el: 'el-GR', ru: 'ru-RU' };
  const PREF = 'custock-demo-v1';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- state ---------------- */
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch (e) { return {}; } }
  const prefs = loadPrefs();
  function guessLang() { const l = (navigator.language || 'en').slice(0, 2); return l === 'el' || l === 'ru' ? l : 'en'; }
  const mqDark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const mqReduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const S = {
    lang: prefs.lang || guessLang(),
    theme: prefs.theme || (mqDark && mqDark.matches ? 'dark' : 'light'),
    reduce: prefs.reduce != null ? prefs.reduce : !!(mqReduce && mqReduce.matches),
    sound: prefs.sound != null ? prefs.sound : true,
    role: prefs.role || 'eleni',
    tips: prefs.tips || {},
    data: window.CSData.makeData(),
    shop: {}, tab: null, stacks: {}, previews: [], ui: {}, compose: null, pendingAccess: {}
  };
  function save() { try { localStorage.setItem(PREF, JSON.stringify({ lang: S.lang, theme: S.theme, reduce: S.reduce, sound: S.sound, role: S.role, tips: S.tips })); } catch (e) { /* private mode */ } }

  /* ---------------- i18n and formats ---------------- */
  const PR = {};
  function plural(n) { const k = S.lang; if (!PR[k]) PR[k] = new Intl.PluralRules(LOC[k]); return PR[k].select(n); }
  function t(key, v) {
    const dict = window.I18N[S.lang] || window.I18N.en;
    let m = dict[key];
    if (m === undefined) m = window.I18N.en[key];
    if (m === undefined) return key;
    if (typeof m === 'object') { const n = v && v.n != null ? v.n : 0; m = m[plural(n)] || m.other; }
    if (v) m = m.replace(/\{(\w+)\}/g, (_, k) => (v[k] == null ? '' : typeof v[k] === 'number' ? num(v[k]) : String(v[k])));
    return m;
  }
  const T = (k, v) => esc(t(k, v));
  const L = (o) => (o == null ? '' : typeof o === 'string' ? o : o[S.lang] || o.en || o.el || '');
  function num(n) { return new Intl.NumberFormat(LOC[S.lang]).format(n); }
  function money(c) { return new Intl.NumberFormat(LOC[S.lang], { style: 'currency', currency: 'EUR' }).format(c / 100); }
  function pct(x) { return new Intl.NumberFormat(LOC[S.lang], { style: 'percent', maximumFractionDigits: 0 }).format(x); }
  function dt(ts, o) { return new Intl.DateTimeFormat(LOC[S.lang], o || { day: 'numeric', month: 'short' }).format(ts); }
  function rel(ts) {
    const diff = ts - Date.now(), a = Math.abs(diff);
    if (a < 6e4) return t('time.now');
    const f = new Intl.RelativeTimeFormat(LOC[S.lang], { numeric: 'auto' });
    if (a < H) return f.format(Math.round(diff / 6e4), 'minute');
    if (a < D) return f.format(Math.round(diff / H), 'hour');
    return f.format(Math.round(diff / D), 'day');
  }

  /* ---------------- icons (own set, 24 grid, round caps) ---------------- */
  const IC = {
    home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v10.5H10V14h4v5.5h4.5V9"/>',
    'home-f': '<path class="f" d="M12 2.9 2.9 10.4a1 1 0 0 0 1.3 1.6l.8-.7V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-8.7l.8.7a1 1 0 0 0 1.3-1.6Z"/>',
    box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    'box-f': '<path class="f" d="M12 2.4 3 7.2l9 4.8 9-4.8z"/><path class="f" d="M2.4 8.4v8.1c0 .4.2.7.5.9l8.5 4.5v-8.8zM12.6 21.9l8.5-4.5c.3-.2.5-.5.5-.9V8.4l-9 4.8z"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M15.5 4.8a3.3 3.3 0 0 1 0 6.4M17.5 14.8c2.2.6 3.6 2.4 4 5.2"/>',
    'people-f': '<circle class="f" cx="9" cy="7.8" r="4"/><path class="f" d="M1.8 20.1C2.5 16 5.4 13.8 9 13.8s6.5 2.2 7.2 6.3a.8.8 0 0 1-.8 1H2.6a.8.8 0 0 1-.8-1Z"/><path d="M15.6 4.4a3.6 3.6 0 0 1 0 6.9M17.9 14.3c2.2.7 3.6 2.6 4.1 5.6"/>',
    megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l8 4.5V4.5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M18.5 9.5a3.5 3.5 0 0 1 0 5M8 15.5l1.2 4.5"/>',
    'megaphone-f': '<path class="f" d="M15.6 3.7a.8.8 0 0 1 .4.7v15.2a.8.8 0 0 1-1.2.7L7 15.9H5a1.6 1.6 0 0 1-1.6-1.6V9.7A1.6 1.6 0 0 1 5 8.1h2l7.8-4.4a.8.8 0 0 1 .8 0Z"/><path d="M19 9.5a3.5 3.5 0 0 1 0 5M8 16.5l1.1 4"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 8.5v7M11 8.5v7M13.5 8.5v7M16 8.5v7"/>',
    tag: '<path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1a1 1 0 0 1 .7.3l7.2 7.2a1 1 0 0 1 0 1.4l-8.1 8.1a1 1 0 0 1-1.4 0l-7.2-7.2a1 1 0 0 1-.3-.7Z"/><circle cx="8.3" cy="8.3" r="1.5"/>',
    'tag-f': '<path class="f" fill-rule="evenodd" d="M3 12.7V4.4A1.4 1.4 0 0 1 4.4 3h8.3a1.4 1.4 0 0 1 1 .4l7.3 7.3a1.4 1.4 0 0 1 0 2l-8.3 8.3a1.4 1.4 0 0 1-2 0L3.4 13.7a1.4 1.4 0 0 1-.4-1ZM8.3 10a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
    'grid-f': '<rect class="f" x="3.5" y="3.5" width="7.5" height="7.5" rx="1.8"/><rect class="f" x="13" y="3.5" width="7.5" height="7.5" rx="1.8"/><rect class="f" x="3.5" y="13" width="7.5" height="7.5" rx="1.8"/><rect class="f" x="13" y="13" width="7.5" height="7.5" rx="1.8"/>',
    store: '<path d="M4.5 10.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-8.5"/><path d="M3 9.5 4.8 4.6a1 1 0 0 1 .9-.6h12.6a1 1 0 0 1 .9.6L21 9.5a2.5 2.5 0 0 1-4.5 1.5 2.5 2.5 0 0 1-4.5 0 2.5 2.5 0 0 1-4.5 0A2.5 2.5 0 0 1 3 9.5Z"/><path d="M10 20v-5h4v5"/>',
    'store-f': '<path class="f" d="M3 9.5 4.8 4.6a1 1 0 0 1 .9-.6h12.6a1 1 0 0 1 .9.6L21 9.5a2.5 2.5 0 0 1-4.5 1.5 2.5 2.5 0 0 1-4.5 0 2.5 2.5 0 0 1-4.5 0A2.5 2.5 0 0 1 3 9.5Z"/><path class="f" d="M4.2 12.4c1 .5 2.2.6 3.3.1 1.4.8 3.1.8 4.5 0 1.4.8 3.1.8 4.5 0 1.1.5 2.3.4 3.3-.1V19a1.2 1.2 0 0 1-1.2 1.2h-4.1V15h-5v5.2H5.4A1.2 1.2 0 0 1 4.2 19Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c.8-4 4-6 8-6s7.2 2 8 6"/>',
    'chev-left': '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
    'chev-right': '<path d="m9 4.5 7.5 7.5L9 19.5"/>',
    'chev-down': '<path d="m5 9 7 7 7-7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.7v.1"/>',
    alert: '<path d="M10.3 4.2 2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4.5M12 17.2v.1"/>',
    out: '<circle cx="12" cy="12" r="8.5"/><path d="m6 18 12-12"/>',
    few: '<rect x="3" y="7.5" width="16" height="9" rx="2.2"/><path d="M21.5 10.5v3M6.5 10.5v3"/>',
    neg: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/>',
    share: '<path d="M12 3.5v11M8 7l4-3.5L16 7"/><path d="M7.5 10.5H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5"/>',
    truck: '<path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3.2v3.3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    receive: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    bag: '<path d="M5.5 8h13l-1 12.5h-11Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    count: '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5v-1h6v1"/><path d="m9 12.5 2 2 4-4.5"/>',
    plusminus: '<path d="M8 4.5v7M4.5 8h7M13 16.5h7M5.5 19.5l13-15"/>',
    undo: '<path d="M4 5v5h5"/><path d="M4.6 13.5A7.5 7.5 0 1 0 6.3 6.6L4 9.6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.5 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.5-3.5-8.5s1-5.9 3.5-8.5Z"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 18.5V20M20 14v1"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8.5 16v-4M12.5 16V8M16.5 16v-6"/>',
    shield: '<path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6Z"/><path d="m9 12 2 2 4-4.5"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    send: '<path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4Z"/>',
    pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10" r="2.3"/>',
    note: '<path d="M5.5 3.5h9l4 4v13h-13z"/><path d="M14.5 3.5v4h4M8.5 12h7M8.5 15.5h5"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
    sound: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    sparkle: '<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'
  };
  function ic(name, cls) { return '<svg class="icon ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (IC[name] || '') + '</svg>'; }
  const APP_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#B0234F"/><circle cx="16" cy="20" r="8" fill="none" stroke="#fff" stroke-width="3.2"/><circle cx="24" cy="20" r="8" fill="none" stroke="#fff" stroke-opacity=".62" stroke-width="3.2"/></svg>');

  /* ---------------- images with fallbacks ---------------- */
  const TINTS = [['#EADCC8', '#5A4326'], ['#D8E4D2', '#2F4A28'], ['#E8D3DC', '#5A2338'], ['#D5DEEC', '#24385A'], ['#ECE0BE', '#5A4710'], ['#DAD5EC', '#3A2F66']];
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function fallbackImg(label, key) {
    const c = TINTS[hash(key || label || 'x') % TINTS.length];
    const letter = String(label || '?').trim().charAt(0).toUpperCase();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="' + c[0] + '"/><text x="100" y="128" text-anchor="middle" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="92" font-weight="600" fill="' + c[1] + '">' + esc(letter) + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function imgSrc(key, label) { const m = window.CUSTOCK_IMAGES || {}; return (key && m[key]) || fallbackImg(label, key); }
  function img(key, label, cls, alt) {
    return '<img class="' + (cls || '') + '" src="' + esc(imgSrc(key, label)) + '" alt="' + esc(alt == null ? label : alt) + '" loading="lazy" decoding="async" data-fb="' + esc(label || '') + '" data-k="' + esc(key || '') + '">';
  }
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (el && el.tagName === 'IMG' && el.dataset && !el.dataset.failed && el.dataset.fb != null) { el.dataset.failed = '1'; el.src = fallbackImg(el.dataset.fb, el.dataset.k); }
  }, true);

  /* ---------------- data helpers ---------------- */
  const Dt = () => S.data;
  const product = (pid) => Dt().products.find((p) => p.id === pid);
  const variant = (vid) => Dt().variants[vid];
  const shopById = (id) => Dt().shops.find((s) => s.id === id);
  const groupById = (id) => Dt().groups.find((g) => g.id === id);
  const memberById = (id) => Dt().members.find((m) => m.id === id);
  const customerById = (id) => Dt().customers.find((c) => c.id === id);
  const pname = (p) => L(p.name);
  function vname(v) { const p = product(v.pid); return pname(p) + (v.opt ? ', ' + L(v.opt) : ''); }
  const sname = (id) => (id === 'all' ? t('shop.all') : shopById(id) ? L(shopById(id).name) : '');
  function scopeName(sc) {
    if (sc.scope === 'org') return t('scope.org');
    if (sc.scope === 'group') return L(groupById(sc.id).name);
    return L(shopById(sc.id).name);
  }
  function initials(name) { return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join(''); }
  function avatar(name, cls) { return '<span class="avatar ' + (cls || '') + '" style="background:var(--tile-' + (1 + hash(name) % 6) + ')" aria-hidden="true">' + esc(initials(name)) + '</span>'; }
  function personName(id) { if (id === 'anna') return 'Anna Sokolova'; const m = memberById(id); return m ? m.name : id; }
  function firstName(id) { return personName(id).split(' ')[0]; }
  function maskEmail(e) { const p = e.split('@'); return p[0].slice(0, 2) + '***@' + p[1]; }
  function maskPhone(p) { return p.slice(0, 6) + '** *** ' + p.slice(-3); }

  /* ---------------- permissions ---------------- */
  const isCust = () => S.role === 'anna';
  const me = () => memberById(S.role);
  function covers(a, shop) {
    if (a.scope === 'org' || !shop) return true;
    if (a.scope === 'group') return groupById(a.id).shops.indexOf(shop) >= 0;
    return a.id === shop;
  }
  function level(perm) { return window.CSData.ORG_LEVEL.indexOf(perm) >= 0 ? 'org' : window.CSData.ANY_LEVEL.indexOf(perm) >= 0 ? 'any' : 'shop'; }
  function can(perm, shop, who) {
    const m = memberById(who || S.role);
    if (!m || m.status !== 'active') return false;
    const lv = level(perm);
    return m.assign.some((a) => {
      const r = Dt().roles[a.role];
      if (!r || !r.perms.has(perm)) return false;
      if (lv === 'org') return a.scope === 'org';
      if (lv === 'any') return true;
      return covers(a, shop);
    });
  }
  function canOrgWide(perm) { const m = me(); return !!m && m.assign.some((a) => a.scope === 'org' && Dt().roles[a.role].perms.has(perm)); }
  function myShops(perm) { return Dt().shops.filter((s) => can(perm || 'stock.view', s.id)).map((s) => s.id); }
  function roleOf(id) { const m = memberById(id); return m ? Dt().roles[m.assign[0].role] : null; }
  function roleName(r) { return r.custom ? L(r.name) : t('role.' + r.tpl); }
  function assignLabel(a) { const r = Dt().roles[a.role]; return t('assign.at', { role: roleName(r), place: scopeName(a) }); }

  // context shop for business screens
  function ctx() {
    const shops = myShops('stock.view');
    let c = S.shop[S.role];
    if (!c) c = shops.length > 1 && canOrgWide('stock.view') ? 'all' : shops[0];
    if (c !== 'all' && shops.indexOf(c) < 0) c = shops[0];
    if (c === 'all' && shops.length < 2) c = shops[0];
    return c;
  }
  const ctxShops = () => (ctx() === 'all' ? myShops('stock.view') : [ctx()]);
  const actionShop = () => (ctx() === 'all' ? myShops('stock.view')[0] : ctx());

  /* ---------------- stock ---------------- */
  const qty = (vid, shop) => variant(vid).stock[shop] || 0;
  const qtyIn = (vid, shops) => shops.reduce((s, sh) => s + qty(vid, sh), 0);
  function stateOf(q, rp) { if (q < 0) return 'neg'; if (q === 0) return 'out'; if (rp != null && q <= rp) return 'few'; return 'ok'; }
  function vState(vid, shops) { const v = variant(vid); return stateOf(qtyIn(vid, shops), shops.reduce((s, sh) => s + (v.rp && v.rp[sh] != null ? v.rp[sh] : 0), 0)); }
  function pState(p, shops) {
    const st = p.variants.map((v) => vState(v.id, shops));
    if (st.indexOf('neg') >= 0) return 'neg';
    if (st.every((x) => x === 'out')) return 'out';
    if (st.some((x) => x === 'out' || x === 'few')) return 'few';
    return 'ok';
  }
  function badge(state, label) {
    if (state === 'ok' || !state) return '';
    const icon = state === 'few' ? 'few' : state === 'out' ? 'out' : 'neg';
    return '<span class="badge ' + state + '">' + ic(icon, 'xs') + esc(label || t('st.' + state)) + '</span>';
  }
  function waitingFor(vid, shops) { return Dt().alerts.filter((a) => a.vid === vid && a.status === 'waiting' && (a.shop === null || shops.indexOf(a.shop) >= 0)); }
  function reaches(c, shop) {
    const g = Dt().groups.filter((x) => x.shops.indexOf(shop) >= 0).map((x) => x.id);
    const sh = c.subs.find((s) => s.scope === 'shop' && s.id === shop);
    if (sh) return sh.status === 'subscribed';
    const gr = c.subs.find((s) => s.scope === 'group' && g.indexOf(s.id) >= 0);
    if (gr) return gr.status === 'subscribed';
    const o = c.subs.find((s) => s.scope === 'org');
    return !!(o && o.status === 'subscribed');
  }
  function wasPrice(vid, at) {
    const from = at - 30 * D;
    const list = Dt().priceHistory.filter((h) => h.vid === vid && h.from < at && (h.to == null || h.to > from));
    if (!list.length) return variant(vid).price;
    return Math.min.apply(null, list.map((h) => h.price));
  }
  function activeOffer(vid, shop) {
    const now = Date.now();
    for (const p of Dt().posts) {
      if (p.kind !== 'offer' || p.status !== 'sent' || !(p.validUntil > now) || !(p.validFrom <= now)) continue;
      const pp = p.products.find((x) => x.vid === vid && x.offer != null);
      if (!pp) continue;
      if (shop && !postReachesShop(p, shop)) continue;
      return { post: p, price: pp.offer, was: wasPrice(vid, p.validFrom) };
    }
    return null;
  }
  function shopsOfScope(sc) { return sc.scope === 'org' ? Dt().shops.map((s) => s.id) : sc.scope === 'group' ? groupById(sc.id).shops.slice() : [sc.id]; }
  function postReachesShop(p, shop) { return p.scopes.some((sc) => shopsOfScope(sc).indexOf(shop) >= 0); }

  let mseq = 0;
  function applyMove(o) {
    const v = variant(o.vid);
    const before = v.stock[o.shop] || 0;
    v.stock[o.shop] = before + o.delta;
    mseq += 1;
    const m = Object.assign({ id: 'x' + mseq, at: Date.now(), by: S.role }, o);
    Dt().ledger.unshift(m);
    const after = v.stock[o.shop];
    let told = [];
    if ((o.kind === 'receive' || o.kind === 'transfer_in' || o.kind === 'return') && before <= 0 && after > 0) told = backInStock(o.vid, o.shop);
    const rp = v.rp && v.rp[o.shop];
    if (o.kind === 'sale' && rp != null && before > rp && after <= rp) lowStock(v, o.shop, after, rp);
    return { m: m, before: before, after: after, told: told };
  }
  function backInStock(vid, shop) {
    const list = Dt().alerts.filter((a) => a.vid === vid && a.status === 'waiting' && (a.shop === shop || a.shop === null));
    list.forEach((a) => { a.status = 'notified'; a.notifiedAt = Date.now(); });
    if (list.some((a) => a.cid === 'c-anna')) {
      setTimeout(() => deliver('anna', { org: 'lemoni', merchant: { en: 'Lemoni ' + L(shopById(shop).name), el: 'Lemoni ' + shopById(shop).name.el, ru: 'Lemoni ' + shopById(shop).name.ru },
        tk: 'push.back.title', bk: 'push.back.body', v: { vid: vid, shop: shop }, img: product(variant(vid).pid).img,
        route: { role: 'anna', tab: 'c-catalog', name: 'c-product', params: { pid: variant(vid).pid } } }), 2600);
    }
    return list;
  }
  function lowStock(v, shop, after, rp) {
    if (shop !== 'kif') return;
    deliver('maria', { org: 'lemoni', merchant: { en: 'Lemoni Kifisia', el: 'Lemoni Κηφισιά', ru: 'Lemoni Кифисия' }, tk: 'push.low.title', bk: 'push.low.body',
      v: { vid: v.id, shop: shop, n: after, rp: rp }, img: product(v.pid).img, route: { role: 'maria', tab: 'stock', name: 'product', params: { pid: v.pid } } }, 1400);
  }

  /* ---------------- sound and haptics ---------------- */
  let AC = null;
  function audio() {
    if (!S.sound) return null;
    try {
      if (!AC) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; AC = new C(); }
      if (AC.state === 'suspended') AC.resume();
      return AC;
    } catch (e) { return null; }
  }
  function tone(freq, start, dur, vol, type) {
    const c = audio(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    const t0 = c.currentTime + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function tick() { tone(1700, 0, 0.045, 0.06, 'square'); haptic(10); }
  function chime() { tone(988, 0, 0.18, 0.08); tone(1319, 0.11, 0.26, 0.07); }
  function haptic(ms) { try { const ua = navigator.userActivation; if (navigator.vibrate && (!ua || ua.hasBeenActive)) navigator.vibrate(ms || 10); } catch (e) { /* not supported */ } }

  /* ---------------- the tally ---------------- */
  const TPREV = {};
  const ROWS = '<span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>&nbsp;</span>';
  function tstr(v) { return String(v).replace('-', '−'); }
  function tallyCols(from, to) {
    const len = Math.max(from.length, to.length);
    const a = from.padStart(len, ' '), b = to.padStart(len, ' ');
    let h = '';
    for (let i = 0; i < len; i++) {
      const isD = (ch) => ch === ' ' || (ch >= '0' && ch <= '9');
      if (isD(a[i]) && isD(b[i])) {
        const fi = a[i] === ' ' ? 10 : +a[i], ti = b[i] === ' ' ? 10 : +b[i];
        h += '<span class="tcol"><span class="tstrip" data-from="' + fi + '" data-to="' + ti + '" style="transform:translateY(-' + fi + 'em)">' + ROWS + '</span></span>';
      } else {
        h += '<span class="tsign">' + esc(b[i] === ' ' ? '' : b[i]) + '</span>';
      }
    }
    return h;
  }
  function tally(key, val, cls) {
    return '<span class="tally ' + (cls || '') + '" data-tk="' + esc(key) + '" data-tv="' + val + '" role="img" aria-label="' + esc(num(val)) + '"><span aria-hidden="true" class="tin">' + tallyCols(tstr(val), tstr(val)) + '</span></span>';
  }
  function syncTallies(root) {
    $$('.tally', root).forEach((el, i) => {
      const k = el.dataset.tk, v = el.dataset.tv;
      const prev = TPREV[k];
      TPREV[k] = v;
      if (prev === undefined || prev === v || S.reduce) return;
      const inner = el.querySelector('.tin');
      inner.innerHTML = tallyCols(tstr(prev), tstr(v));
      const strips = $$('.tstrip', inner);
      strips.forEach((s) => { s.style.transition = 'none'; });
      void inner.offsetWidth;
      strips.forEach((s, j) => {
        s.style.transition = '';
        s.style.transitionDelay = ((strips.length - 1 - j) * 45 + i * 20) + 'ms';
        s.style.transform = 'translateY(-' + s.dataset.to + 'em)';
      });
    });
  }

  /* ---------------- router ---------------- */
  const SCREENS = {}, ACT = {}, IN = {}, CH = {}, PARTS = {};
  const BIZ_TABS = [
    { id: 'home', icon: 'home', label: 'tab.home' },
    { id: 'stock', icon: 'box', label: 'tab.stock', perm: 'stock.view' },
    { id: 'customers', icon: 'people', label: 'tab.customers', perm: 'customers.view' },
    { id: 'posts', icon: 'megaphone', label: 'tab.posts', perm: 'posts.view' }
  ];
  const CUST_TABS = [
    { id: 'c-home', icon: 'home', label: 'tab.feed' },
    { id: 'c-offers', icon: 'tag', label: 'tab.offers' },
    { id: 'c-catalog', icon: 'grid', label: 'tab.catalog' },
    { id: 'c-shops', icon: 'store', label: 'tab.shops' }
  ];
  function tabs() { return isCust() ? CUST_TABS : BIZ_TABS.filter((x) => !x.perm || can(x.perm)); }
  function hasScan() { return !isCust() && can('products.view'); }
  function stack() { if (!S.stacks[S.tab]) S.stacks[S.tab] = [{ name: S.tab, params: {} }]; return S.stacks[S.tab]; }
  const cur = () => stack()[stack().length - 1];

  function buildScreen(route) {
    const spec = SCREENS[route.name](route.params || {}, route);
    route.title = spec.title;
    route.modal = !!spec.modal;
    const st = stack();
    const idx = st.indexOf(route);
    const prev = idx > 0 ? st[idx - 1] : null;
    const large = spec.large !== false && !!spec.title;
    let left = spec.left || '';
    if (!left && prev) {
      const pt = prev.title && prev.title.length <= 13 ? prev.title : t('nav.back');
      left = '<button class="navbtn back" data-act="back" aria-label="' + T('nav.back') + '">' + ic('chev-left') + '<span>' + esc(pt) + '</span></button>';
    }
    const el = document.createElement('section');
    el.className = 'screen ' + (spec.cls || '');
    el.dataset.route = route.name;
    el.innerHTML = '<div class="body">' + (large ? '<h1 class="ltitle t-large">' + esc(spec.title) + '</h1>' : '') + spec.body + '</div>' +
      '<header class="nav' + (spec.solid ? ' solid' : '') + (large ? '' : ' always') + (spec.navCls ? ' ' + spec.navCls : '') + '"><div class="nav-left">' + left + '</div><div class="nav-title">' + esc(spec.navTitle || spec.title || '') + '</div><div class="nav-right">' + (spec.right || '') + '</div></header>';
    el._spec = spec;
    el._large = large;
    return el;
  }
  function afterRender(el, route) {
    const body = $('.body', el), nav = $('.nav', el);
    const lim = el._large ? 38 : 4;
    const onScroll = () => { nav.classList.toggle('scrolled', body.scrollTop > lim); };
    body.addEventListener('scroll', onScroll, { passive: true });
    if (route.scroll) body.scrollTop = route.scroll;
    onScroll();
    if (el._spec.after) el._spec.after(el);
    syncTallies(el);
    $('#statusbar').classList.toggle('on-dark', !!el._spec.dark);
  }
  function renderApp(kind) {
    applyChrome();
    const host = $('#screens');
    $$('.screen', host).slice(0, -1).forEach((n) => n.remove());
    const old = $('.screen', host);
    if (old) { const r0 = old._route; if (r0) r0.scroll = $('.body', old).scrollTop; }
    const route = cur();
    const el = buildScreen(route);
    el._route = route;
    if (kind === 'pop' && old) host.insertBefore(el, old); else host.appendChild(el);
    afterRender(el, route);
    renderTabs();
    if (old) swap(old, el, kind);
    renderNarration();
  }
  function swap(old, el, kind) {
    if (kind === 'tab' || kind === 'none' || !kind) { old.remove(); return; }
    const dur = 380, ease = 'cubic-bezier(0.32, 0.72, 0, 1)';
    if (S.reduce || kind === 'fade') {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out' }).finished.then(() => old.remove()).catch(() => old.remove());
      return;
    }
    if (kind === 'push') {
      el.style.boxShadow = '-8px 0 30px rgba(0,0,0,.12)';
      el.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: dur, easing: ease });
      old.classList.add('dim');
      old.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-30%)' }], { duration: dur, easing: ease, fill: 'forwards' })
        .finished.then(() => { old.remove(); el.style.boxShadow = ''; }).catch(() => old.remove());
    } else {
      el.classList.add('dim');
      el.animate([{ transform: 'translateX(-30%)' }, { transform: 'translateX(0)' }], { duration: dur, easing: ease }).finished.then(() => el.classList.remove('dim')).catch(() => {});
      old.style.boxShadow = '-8px 0 30px rgba(0,0,0,.12)';
      old.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], { duration: dur, easing: ease, fill: 'forwards' })
        .finished.then(() => old.remove()).catch(() => old.remove());
      setTimeout(() => el.classList.remove('dim'), dur);
    }
  }
  function refresh() {
    const host = $('#screens');
    const old = $$('.screen', host).pop();
    if (!old) return renderApp('none');
    const route = cur();
    route.scroll = $('.body', old).scrollTop;
    const el = buildScreen(route);
    el._route = route;
    host.replaceChild(el, old);
    afterRender(el, route);
    renderTabs();
    renderNarration();
    if (SHEET && SHEET.o.render) sheetRefresh();
  }
  function refreshPart(id) {
    $$('[data-part="' + id + '"]').forEach((el) => { el.innerHTML = PARTS[id](); syncTallies(el); });
  }
  function go(name, params) { stack().push({ name: name, params: params || {} }); renderApp('push'); }
  function back() { if (stack().length > 1) { stack().pop(); renderApp('pop'); } }
  function switchTab(id) {
    if (S.tab === id) { if (stack().length > 1) { S.stacks[id] = [stack()[0]]; renderApp('pop'); } else { const b = $('.screen .body'); if (b) b.scrollTo({ top: 0, behavior: S.reduce ? 'auto' : 'smooth' }); } return; }
    S.tab = id; renderApp('tab');
  }
  function openRoute(r) {
    if (r.role && r.role !== S.role) setRole(r.role, true);
    closeSheet(true);
    S.tab = r.tab;
    S.stacks[r.tab] = [{ name: r.tab, params: {} }];
    if (r.name && r.name !== r.tab) S.stacks[r.tab].push({ name: r.name, params: r.params || {} });
    renderApp('fade');
  }

  function renderTabs() {
    const bar = $('#bottom-bar');
    const list = tabs();
    const scanOn = hasScan();
    bar.innerHTML = '<nav class="tabbar" aria-label="' + T('a11y.tabs') + '">' + list.map((x) => {
      const on = S.tab === x.id;
      const badgeN = x.id === 'c-home' ? Dt().alerts.filter((a) => a.cid === 'c-anna' && a.status === 'notified' && !a.seen).length : 0;
      return '<button class="tab" data-act="tab" data-id="' + x.id + '"' + (on ? ' aria-current="page"' : '') + '>' + ic(on ? x.icon + '-f' : x.icon) +
        '<span class="tl">' + T(x.label) + '</span>' + (badgeN ? '<span class="tbadge">' + badgeN + '</span>' : '') + '</button>';
    }).join('') + '</nav>' + (scanOn ? '<button class="accessory" data-act="tab" data-id="scan" aria-label="' + T('tab.scan') + '"' + (S.tab === 'scan' ? ' aria-current="page"' : '') + '>' + ic('scan') + '</button>' : '');
    bar.hidden = !!(cur() && cur().modal);
  }

  /* ---------------- sheets ---------------- */
  let SHEET = null;
  function openSheet(o) {
    closeSheet(true);
    const ov = $('#overlays');
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('click', () => closeSheet());
    const sh = document.createElement('section');
    sh.className = 'sheet' + (o.detent && o.detent !== 'fit' ? ' detent' : '');
    sh.setAttribute('role', 'dialog');
    sh.setAttribute('aria-modal', 'true');
    sh.setAttribute('aria-label', o.title || '');
    sh.innerHTML = '<div class="grab-zone"><div class="grabber"></div></div><div class="sheet-head"><div>' + (o.left || '') + '</div><h2>' + esc(o.title || '') + '</h2><div class="sh-right"><button class="sheet-close" data-act="sheet-close" aria-label="' + T('a11y.close') + '">' + ic('x') + '</button></div></div><div class="sheet-body">' + o.render() + '</div>';
    ov.appendChild(scrim); ov.appendChild(sh);
    const appH = $('#app').offsetHeight;
    const Hh = sh.offsetHeight;
    const med = o.detent === 'medium' ? Math.max(0, Hh - appH * 0.56) : 0;
    SHEET = { el: sh, scrim: scrim, o: o, H: Hh, med: med, y: Hh };
    setSheetY(Hh, false);
    void sh.offsetWidth;
    requestAnimationFrame(() => { setSheetY(med, true); scrim.classList.add('show'); });
    syncTallies(sh);
    dragSheet(sh);
    if (o.after) o.after(sh);
    setTimeout(() => { const f = $('.sheet-close', sh); if (f && !o.noFocus) f.focus({ preventScroll: true }); }, 60);
  }
  function setSheetY(y, anim) {
    if (!SHEET) return;
    SHEET.y = y;
    const el = SHEET.el;
    if (S.reduce) { el.style.transition = 'opacity .2s'; el.style.opacity = y >= SHEET.H - 1 ? '0' : '1'; el.style.transform = 'translateY(' + (y >= SHEET.H - 1 ? 0 : y) + 'px)'; return; }
    el.style.transition = anim ? 'transform .5s cubic-bezier(0.32, 0.72, 0, 1)' : 'none';
    el.style.transform = 'translateY(' + y + 'px)';
  }
  function closeSheet(instant) {
    if (!SHEET) return;
    const s = SHEET; SHEET = null;
    const fin = () => { s.el.remove(); s.scrim.remove(); if (s.o.onClose) s.o.onClose(); };
    if (instant) return fin();
    s.scrim.classList.remove('show');
    if (S.reduce) { s.el.style.transition = 'opacity .2s'; s.el.style.opacity = '0'; } else { s.el.style.transition = 'transform .42s cubic-bezier(0.32, 0.72, 0, 1)'; s.el.style.transform = 'translateY(' + (s.H + 20) + 'px)'; }
    setTimeout(fin, 430);
  }
  function sheetRefresh() { if (!SHEET) return; const b = $('.sheet-body', SHEET.el); b.innerHTML = SHEET.o.render(); syncTallies(b); if (SHEET.o.after) SHEET.o.after(SHEET.el); }
  function dragSheet(sh) {
    const zones = [$('.grab-zone', sh), $('.sheet-head', sh)];
    zones.forEach((z) => z.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || !SHEET) return;
      const s = SHEET, y0 = e.clientY, base = s.y, t0 = performance.now();
      let last = y0, lt = t0, v = 0;
      z.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const dy = ev.clientY - y0;
        let y = base + dy;
        if (y < 0) y = y / 4;
        const now = performance.now();
        v = (ev.clientY - last) / Math.max(1, now - lt); last = ev.clientY; lt = now;
        setSheetY(y, false);
        s.scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - (y - s.med) / (s.H - s.med || 1))));
      };
      const up = () => {
        z.removeEventListener('pointermove', mv); z.removeEventListener('pointerup', up); z.removeEventListener('pointercancel', up);
        s.scrim.style.opacity = '';
        const proj = s.y + v * 220;
        const stops = s.o.detent === 'medium' ? [0, s.med, s.H] : [0, s.H];
        let best = stops[0];
        stops.forEach((p) => { if (Math.abs(p - proj) < Math.abs(best - proj)) best = p; });
        if (best === s.H) closeSheet(); else setSheetY(best, true);
      };
      z.addEventListener('pointermove', mv); z.addEventListener('pointerup', up); z.addEventListener('pointercancel', up);
    }));
  }

  /* ---------------- toast ---------------- */
  let TOAST = null;
  function toast(msg, o) {
    o = o || {};
    if (TOAST) { clearTimeout(TOAST.tm); TOAST.el.remove(); TOAST = null; }
    const el = document.createElement('div');
    el.className = 'toast' + (o.action ? '' : ' noaction');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = (o.icon ? ic(o.icon) : '') + '<span>' + esc(msg) + '</span>' + (o.action ? '<button data-act="toast-action">' + esc(o.actionLabel || t('undo')) + '</button>' : '');
    $('#overlays').appendChild(el);
    void el.offsetWidth;
    el.classList.add('show');
    const tm = setTimeout(hideToast, o.ms || 3400);
    TOAST = { el: el, tm: tm, action: o.action };
  }
  function hideToast() { if (!TOAST) return; const x = TOAST; TOAST = null; clearTimeout(x.tm); x.el.classList.remove('show'); setTimeout(() => x.el.remove(), 300); }
  ACT['toast-action'] = () => { const a = TOAST && TOAST.action; hideToast(); if (a) a(); };

  /* ---------------- push notifications ---------------- */
  function nText(n) {
    const v = n.v || {};
    const vars = { n: v.n, rp: v.rp, product: v.vid ? vname(variant(v.vid)) : '', shop: v.shop ? sname(v.shop) : '', from: v.from ? sname(v.from) : '' };
    return { merchant: L(n.merchant), title: n.title ? L(n.title) : t(n.tk, vars), body: n.body ? L(n.body) : t(n.bk, vars) };
  }
  function deliver(persona, n, delay) {
    const run = () => {
      n.id = 'n' + Date.now() + Math.floor(Math.random() * 1000);
      n.at = Date.now();
      (Dt().notifs[persona] = Dt().notifs[persona] || []).unshift(n);
      if (persona === S.role) showBanner(n);
      else { S.previews.unshift({ persona: persona, n: n }); S.previews = S.previews.slice(0, 6); renderPanel(); pulsePanel(); }
    };
    if (delay) setTimeout(run, delay); else run();
  }
  let BANNER = null;
  function showBanner(n) {
    if (BANNER) BANNER.kill(true);
    const x = nText(n);
    const el = document.createElement('button');
    el.className = 'push';
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<img class="p-icon" src="' + APP_ICON + '" alt="">' +
      '<span class="p-main"><span class="p-head"><span class="p-app">Custock</span><span>' + T('time.now') + '</span></span>' +
      '<span class="p-title" style="display:block">' + esc(x.merchant) + '</span>' +
      '<span class="p-body"><b>' + esc(x.title) + '</b> ' + esc(x.body) + '</span></span>' +
      (n.img ? img(n.img, x.title, 'p-thumb', '') : '');
    $('#overlays').appendChild(el);
    void el.offsetWidth;
    el.classList.add('show');
    chime(); haptic(18);
    let tm = null, dragged = false, dead = false;
    const arm = () => { clearTimeout(tm); tm = setTimeout(() => kill(), 5200); };
    function kill(fast) {
      if (dead) return; dead = true; clearTimeout(tm);
      if (BANNER && BANNER.el === el) BANNER = null;
      if (fast || S.reduce) { el.style.transition = 'opacity .2s'; el.style.opacity = '0'; } else { el.classList.remove('show'); }
      setTimeout(() => el.remove(), 600);
    }
    el.addEventListener('pointerenter', () => clearTimeout(tm));
    el.addEventListener('pointerleave', arm);
    el.addEventListener('focus', () => clearTimeout(tm));
    el.addEventListener('blur', arm);
    el.addEventListener('pointerdown', (e) => {
      const y0 = e.clientY; dragged = false;
      el.setPointerCapture(e.pointerId);
      const mv = (ev) => { const dy = Math.min(0, ev.clientY - y0); if (Math.abs(dy) > 6) dragged = true; el.style.transition = 'none'; el.style.transform = 'translateY(' + dy + 'px)'; };
      const up = (ev) => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
        el.style.transition = ''; el.style.transform = '';
        if (ev.clientY - y0 < -30) kill();
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
    el.addEventListener('click', () => { if (dragged) return; kill(true); if (n.route) openRoute(n.route); });
    arm();
    BANNER = { el: el, kill: kill };
  }

  /* ---------------- small ui bits ---------------- */
  function tip(id, titleKey, textKey) {
    if (S.tips[id]) return '';
    return '<div class="tip" data-tip="' + id + '"><span class="tip-ic">' + ic('info') + '</span><div class="grow"><div class="tip-t">' + T(titleKey) + '</div><p>' + T(textKey) + '</p></div><button class="tip-x" data-act="tip-x" data-id="' + id + '" aria-label="' + T('a11y.dismiss') + '">' + ic('x', 'sm') + '</button></div>';
  }
  ACT['tip-x'] = (el) => {
    S.tips[el.dataset.id] = 1; save();
    const box = el.closest('.tip');
    if (S.reduce) return box.remove();
    box.animate([{ opacity: 1, height: box.offsetHeight + 'px', marginBottom: '12px' }, { opacity: 0, height: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' }], { duration: 260, easing: 'ease-in' }).finished.then(() => box.remove()).catch(() => box.remove());
  };
  function why(textHtml) { return '<div class="why">' + ic('lock') + '<span>' + textHtml + '</span></div>'; }
  function seg(name, options, value) {
    const i = Math.max(0, options.findIndex((o) => o[0] === value));
    return '<div class="seg" role="group" style="--n:' + options.length + '"><span class="seg-thumb" style="width:calc((100% - 4px) / ' + options.length + ');transform:translateX(' + (i * 100) + '%)"></span>' +
      options.map((o) => '<button data-act="seg" data-name="' + name + '" data-val="' + esc(o[0]) + '" aria-pressed="' + (o[0] === value) + '">' + esc(o[1]) + '</button>').join('') + '</div>';
  }
  ACT.seg = (el) => {
    const box = el.closest('.seg');
    const btns = $$('button', box);
    const i = btns.indexOf(el);
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    const th = $('.seg-thumb', box); if (th) th.style.transform = 'translateX(' + (i * 100) + '%)';
    const fn = SEG[el.dataset.name];
    if (fn) setTimeout(() => fn(el.dataset.val), S.reduce ? 0 : 160);
  };
  const SEG = {};
  function sw(name, on, disabled, label) {
    return '<label class="switch"><input type="checkbox" role="switch" data-ch="' + name + '"' + (on ? ' checked' : '') + (disabled ? ' disabled' : '') + ' aria-label="' + esc(label || '') + '"><span class="track"></span><span class="knob"></span></label>';
  }
  function stepper(id, val) {
    return '<span class="stepper"><button data-act="step" data-id="' + id + '" data-d="-1" aria-label="' + T('a11y.less') + '">' + ic('minus') + '</button><span class="s-div"></span><span class="s-val">' + num(val) + '</span><span class="s-div"></span><button data-act="step" data-id="' + id + '" data-d="1" aria-label="' + T('a11y.more') + '">' + ic('plus') + '</button></span>';
  }
  function shopChips() {
    const shops = myShops('stock.view');
    if (shops.length < 2) return '<div class="lsub">' + ic('pin', 'xs') + ' ' + esc(sname(shops[0])) + '</div>';
    const opts = (canOrgWide('stock.view') ? ['all'] : []).concat(shops);
    return '<div class="chips" role="group" aria-label="' + T('a11y.shop') + '" style="margin-bottom:12px">' + opts.map((id) => '<button class="chip" data-act="ctx" data-id="' + id + '" aria-pressed="' + (ctx() === id) + '">' + esc(sname(id)) + '</button>').join('') + '</div>';
  }
  ACT.ctx = (el) => { S.shop[S.role] = el.dataset.id; refresh(); };
  function cell(o) {
    const tag = o.act ? 'button' : 'div';
    return '<' + tag + ' class="cell' + (o.cls ? ' ' + o.cls : '') + '"' + (o.act ? ' data-act="' + o.act + '"' : '') + (o.data ? Object.keys(o.data).map((k) => ' data-' + k + '="' + esc(o.data[k]) + '"').join('') : '') + '>' +
      (o.lead || '') + '<span class="c-main"><span class="c-title" style="display:block">' + (o.title || '') + '</span>' + (o.sub ? '<span class="c-sub" style="display:block">' + o.sub + '</span>' : '') + '</span>' +
      (o.val != null ? '<span class="c-val">' + o.val + '</span>' : '') + (o.act && o.chev !== false ? ic('chev-right', 'chev') : '') + '</' + tag + '>';
  }
  const tileI = (name, n) => '<span class="tile" style="background:var(--tile-' + (n || 5) + ')">' + ic(name) + '</span>';

  /* ======================= business screens ======================= */

  SCREENS.home = () => {
    const shops = ctxShops();
    const vis = Dt().products.flatMap((p) => p.variants.map((v) => v.id));
    const low = vis.filter((vid) => { const s = vState(vid, shops); return s === 'few' || s === 'out'; }).length;
    const neg = vis.filter((vid) => vState(vid, shops) === 'neg');
    const waiting = Dt().alerts.filter((a) => a.status === 'waiting' && (a.shop === null || shops.indexOf(a.shop) >= 0)).length;
    const custs = visibleCustomers();
    const fresh = custs.filter((c) => c.created > Date.now() - 7 * D).length;
    const posts = visiblePosts().filter((p) => p.status === 'scheduled' || p.status === 'pending').length;
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const sold = Dt().ledger.filter((m) => m.kind === 'sale' && m.at >= today0.getTime() && shops.indexOf(m.shop) >= 0);
    const soldQty = -sold.reduce((s, m) => s + m.delta, 0);
    const soldVal = -sold.reduce((s, m) => s + m.delta * (m.price || 0), 0);
    const pend = can('posts.publish') ? visiblePosts().filter((p) => p.status === 'pending') : [];
    const unk = Dt().unknownCodes.filter((u) => shops.indexOf(u.shop) >= 0 && can('products.create'));
    let att = '';
    pend.forEach((p) => { att += cell({ act: 'open-post', data: { id: p.id }, lead: tileI('megaphone', 1), title: T('home.approve', { name: firstName(p.author) }), sub: esc(L(p.title)) }); });
    if (neg.length) att += cell({ act: 'stock-filter', data: { f: 'neg' }, lead: tileI('neg', 1), title: T('home.neg', { n: neg.length }), sub: T('home.neg.sub') });
    unk.forEach((u) => { att += cell({ act: 'unknown-code', data: { code: u.code }, lead: tileI('scan', 4), title: T('home.unknown', { n: u.times }), sub: T('home.unknown.sub', { name: firstName(u.by), code: u.code }) }); });
    const staffQuick = !can('stock.adjust') && (can('stock.sell') || can('stock.receive'));
    return {
      title: t('home.title'),
      right: '<button class="navbtn avatar-btn" data-act="account" aria-label="' + T('a11y.account') + '">' + avatar(personName(S.role), 'md') + '</button>',
      body: shopChips() + tip('home', 'tip.home.t', 'tip.home.b') +
        '<div class="kpis">' +
        kpi('c1', 'few', t('kpi.low'), low, t('kpi.low.note'), 'stock-filter', 'low') +
        kpi('c2', 'bell', t('kpi.waiting'), waiting, t('kpi.waiting.note'), 'stock-filter', 'wanted') +
        kpi('c3', 'people', t('kpi.new'), fresh, t('kpi.new.note'), can('customers.view') ? 'tab' : '', 'customers') +
        kpi('c4', 'calendar', t('kpi.posts'), posts, t('kpi.posts.note'), can('posts.view') ? 'tab' : '', 'posts') +
        '</div>' +
        (staffQuick ? '<div class="section-h">' + T('home.quick') + '</div><div class="btn-row">' +
          (can('stock.sell', actionShop()) ? '<button class="btn tinted" data-act="scan-mode" data-mode="sell">' + ic('bag') + T('mode.sell') + '</button>' : '') +
          (can('stock.receive', actionShop()) ? '<button class="btn tinted" data-act="scan-mode" data-mode="receive">' + ic('receive') + T('mode.receive') + '</button>' : '') + '</div>' : '') +
        (att ? '<div class="section-h">' + T('home.attention') + '</div><div class="list with-tiles">' + att + '</div>' : '') +
        '<div class="section-h">' + T('home.today') + '</div><div class="list with-tiles">' +
        cell({ lead: tileI('bag', 3), title: T('home.sold', { n: soldQty }), val: can('reports.financial.view') ? esc(money(soldVal)) : null, sub: can('reports.financial.view') ? '' : T('home.sold.nomoney') }) +
        cell({ lead: tileI('people', 2), title: T('home.visible', { n: custs.length }), sub: canOrgWide('customers.view') ? T('home.visible.all') : T('home.visible.some') }) +
        '</div>' + '<p class="section-f">' + T('home.foot') + '</p>'
    };
  };
  function kpi(cls, icon, label, val, note, act, arg) {
    const tag = act ? 'button' : 'div';
    return '<' + tag + ' class="kpi ' + cls + '"' + (act ? ' data-act="' + act + '" data-id="' + arg + '" data-f="' + arg + '"' : '') + '><span class="k-label">' + ic(icon) + esc(label) + '</span><span><span class="k-value">' + tally('kpi-' + cls + '-' + S.role, val) + '</span><span class="k-note" style="display:block">' + esc(note) + '</span></span></' + tag + '>';
  }
  ACT['stock-filter'] = (el) => { S.ui.stockFilter = el.dataset.f; S.ui.stockQ = ''; S.tab = 'stock'; S.stacks.stock = [{ name: 'stock', params: {} }]; renderApp('tab'); };
  ACT.tab = (el) => switchTab(el.dataset.id);
  ACT.back = () => back();
  ACT['open-post'] = (el) => { S.tab = 'posts'; S.stacks.posts = [{ name: 'posts', params: {} }, { name: 'post', params: { id: el.dataset.id } }]; renderApp('fade'); };
  ACT['scan-mode'] = (el) => { S.ui.scanMode = el.dataset.mode; S.tab = 'scan'; S.stacks.scan = [{ name: 'scan', params: {} }]; renderApp('tab'); };
  ACT['unknown-code'] = (el) => {
    const code = el.dataset.code;
    openSheet({ title: t('unknown.title'), render: () => '<div class="list"><div class="cell"><span class="c-main"><span class="c-sub" style="display:block">' + T('unknown.code') + '</span><span class="barcode">' + esc(code) + '</span></span></div></div>' +
      '<p class="section-f">' + T('unknown.explain') + '</p><div class="mt16"><button class="btn primary block" data-act="new-product" data-code="' + esc(code) + '">' + ic('plus') + T('unknown.create') + '</button></div>' });
  };

  ACT.account = () => {
    const m = me();
    const all = Object.keys(window.CSData.MATRIX);
    const mine = all.filter((p) => m.assign.some((a) => Dt().roles[a.role].perms.has(p)));
    openSheet({ title: t('account.title'), detent: 'medium', render: () =>
      '<div style="text-align:center;margin:6px 0 16px">' + avatar(m.name, 'lg') + '<div class="t-title3 mt12">' + esc(m.name) + '</div><div class="muted t-sub">' + m.assign.map((a) => esc(assignLabel(a))).join(', ') + '</div></div>' +
      '<div class="list with-tiles">' + cell({ lead: tileI('shield', 6), title: T('account.perms', { n: mine.length, total: all.length }), sub: T('account.perms.sub') }) +
      cell({ lead: tileI('store', 2), title: esc(Dt().org.name), sub: T('account.org') }) + '</div>' +
      '<div class="section-h">' + T('account.can') + '</div><div class="list">' + window.CSData.PERM_GROUPS.map((g) => {
        const have = g[1].filter((p) => mine.indexOf(p) >= 0).length;
        return cell({ title: T('pg.' + g[0]), val: have + ' / ' + g[1].length });
      }).join('') + '</div><p class="section-f">' + T('account.foot') + '</p>' });
  };

  /* stock list */
  function stockRows() {
    const shops = ctxShops();
    const q = S.ui.stockQ || '';
    const f = S.ui.stockFilter || 'all';
    let list = Dt().products.filter((p) => {
      if (!p._idx) p._idx = window.CSText.index([p.name.en, p.name.el, p.name.ru].concat(p.variants.map((v) => v.barcodes.join(' ') + ' ' + v.sku)));
      return window.CSText.match(p._idx, q);
    });
    list = list.filter((p) => {
      const st = pState(p, shops);
      if (f === 'low') return st === 'few' || st === 'out';
      if (f === 'out') return st === 'out' || p.variants.some((v) => vState(v.id, shops) === 'out');
      if (f === 'neg') return st === 'neg';
      if (f === 'wanted') return p.variants.some((v) => waitingFor(v.id, shops).length);
      return true;
    });
    if (!list.length) return '<div class="empty"><span class="e-icon">' + ic('search') + '</span><h3>' + T('stock.empty.t') + '</h3><p>' + T('stock.empty.b') + '</p></div>';
    const single = shops.length === 1;
    return '<div class="list with-thumbs">' + list.map((p) => {
      const total = p.variants.reduce((s, v) => s + qtyIn(v.id, shops), 0);
      const st = pState(p, shops);
      const w = p.variants.reduce((s, v) => s + waitingFor(v.id, shops).length, 0);
      const sub = (p.variants.length > 1 ? T('stock.variants', { n: p.variants.length }) : esc(L(Dt().categories.find((c) => c.id === p.cat).name))) + (w ? ' · ' + T('stock.waiting', { n: w }) : '');
      const rowInner = cell({ act: 'open-product', data: { pid: p.id }, lead: img(p.img, pname(p), 'thumb', ''), title: esc(pname(p)), sub: sub + (st !== 'ok' ? '<span style="display:block;margin-top:4px">' + badge(st) + '</span>' : ''), val: '<span class="qty' + (total < 0 ? ' neg' : '') + '">' + tally('q-' + p.id + '-' + shops.join(''), total) + '</span>', chev: false });
      const swipeOk = single && p.variants.length === 1 && (can('stock.sell', shops[0]) || can('stock.receive', shops[0]));
      if (!swipeOk) return rowInner;
      return '<div class="swipe"><div class="sw-actions">' + (can('stock.receive', shops[0]) ? '<button class="sw-a1" data-act="quick" data-k="receive" data-vid="' + p.variants[0].id + '">' + ic('plus') + T('swipe.plus1') + '</button>' : '') +
        (can('stock.sell', shops[0]) ? '<button class="sw-a2" data-act="quick" data-k="sale" data-vid="' + p.variants[0].id + '">' + ic('bag') + T('swipe.sell1') + '</button>' : '') + '</div>' + rowInner + '</div>';
    }).join('') + '</div>';
  }
  PARTS['stock-list'] = stockRows;
  SCREENS.stock = () => {
    const f = S.ui.stockFilter || 'all';
    const fs = [['all', t('f.all')], ['low', t('f.low')], ['out', t('f.out')], ['neg', t('f.neg')], ['wanted', t('f.wanted')]];
    return {
      title: t('stock.title'),
      body: shopChips() +
        '<label class="search">' + ic('search') + '<input type="search" inputmode="search" enterkeyhint="search" placeholder="' + T('stock.search') + '" value="' + esc(S.ui.stockQ || '') + '" data-in="stock-q" aria-label="' + T('stock.search') + '"></label>' +
        '<div class="chips" style="margin-bottom:12px">' + fs.map((x) => '<button class="chip" data-act="stock-f" data-f="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + esc(x[1]) + '</button>').join('') + '</div>' +
        tip('stock', 'tip.stock.t', 'tip.stock.b') +
        '<div data-part="stock-list">' + stockRows() + '</div>' +
        (ctxShops().length === 1 ? '<p class="section-f">' + T('stock.swipe.hint') + '</p>' : '')
    };
  };
  IN['stock-q'] = (el) => { S.ui.stockQ = el.value; refreshPart('stock-list'); };
  ACT['stock-f'] = (el) => { S.ui.stockFilter = el.dataset.f; $$('[data-act="stock-f"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el))); refreshPart('stock-list'); };
  ACT['open-product'] = (el) => { if (swipedRecently(el)) return; go('product', { pid: el.dataset.pid }); };
  ACT.quick = (el) => {
    const shop = ctxShops()[0];
    const vid = el.dataset.vid;
    const res = applyMove({ vid: vid, shop: shop, delta: el.dataset.k === 'sale' ? -1 : 1, kind: el.dataset.k, price: variant(vid).price });
    tick();
    closeSwipes();
    refreshPart('stock-list');
    afterMoveToast(res, el.dataset.k, 1);
  };
  function afterMoveToast(res, kind, n) {
    if (res.told && res.told.length) { moment(res.m.vid, res.m.shop, res.told); return; }
    const v = variant(res.m.vid);
    toast(t(kind === 'sale' ? 'toast.sold' : 'toast.received', { n: n, product: vname(v), left: res.after }), {
      icon: 'check', ms: 10000, actionLabel: t('undo'), action: () => {
        applyMove({ vid: res.m.vid, shop: res.m.shop, delta: -res.m.delta, kind: 'reversal', ref: res.m.id });
        refresh(); toast(t('toast.undone'), { icon: 'undo' });
      }
    });
  }

  /* product detail */
  SCREENS.product = (pr) => {
    const p = product(pr.pid);
    const shops = myShops('stock.view');
    const hidden = Dt().shops.length - shops.length;
    const vi = Math.min((S.ui.variant && S.ui.variant[p.id]) || 0, p.variants.length - 1);
    const v = p.variants[vi];
    const ash = actionShop();
    const offer = activeOffer(v.id, ash);
    const ctxS = ctxShops();
    const w = waitingFor(v.id, ctxS);
    const catName = L(Dt().categories.find((c) => c.id === p.cat).name);
    let price = '<div class="price-row"><span class="price">' + esc(money(v.price)) + '</span>' +
      (offer ? '<span class="badge accent">' + ic('tag', 'xs') + T('pd.offer', { price: money(offer.price) }) + '</span>' : '') + '</div>';
    if (!can('products.price.edit')) price += '<div class="lock-note mt8">' + ic('lock') + T('pd.price.locked') + '</div>';
    const cost = can('products.cost.view') ? cell({ title: T('pd.cost'), val: esc(money(v.cost)) + ' · ' + T('pd.margin', { p: pct((v.price / (1 + p.vat / 100) - v.cost) / (v.price / (1 + p.vat / 100))) }) }) : '';
    const stockRowsH = shops.map((sh) => {
      const q = qty(v.id, sh), rp = v.rp && v.rp[sh];
      const st = stateOf(q, rp);
      return cell({ title: esc(sname(sh)), sub: (rp != null ? T('pd.rp', { n: rp }) : '') + (st !== 'ok' ? ' ' + badge(st) : ''), val: '<span class="bigqty' + (q < 0 ? ' qty neg' : '') + '">' + tally('pq-' + v.id + '-' + sh, q) + '</span>' });
    }).join('');
    const hist = can('stock.history.view', ash) ? Dt().ledger.filter((m) => m.vid === v.id && ctxS.indexOf(m.shop) >= 0).slice(0, 8) : null;
    const KI = { sale: 'bag', receive: 'receive', return: 'undo', adjust: 'plusminus', damage: 'alert', reversal: 'undo', count: 'count', transfer_in: 'truck', transfer_out: 'truck' };
    const acts = [];
    if (can('stock.sell', ash)) acts.push('<button class="btn tinted" data-act="pd-sell" data-vid="' + v.id + '">' + ic('bag') + T('pd.sell1') + '</button>');
    if (can('stock.receive', ash)) acts.push('<button class="btn tinted" data-act="pd-receive" data-vid="' + v.id + '">' + ic('receive') + T('pd.receive') + '</button>');
    return {
      title: pname(p), large: false,
      body: img(p.img, pname(p), 'hero-img', '') +
        '<div class="pd-head"><div class="muted t-foot">' + esc(catName) + ' · ' + T('pd.vat', { n: p.vat }) + '</div><h1 class="pd-name">' + esc(pname(p)) + '</h1>' + price + '</div>' +
        (p.variants.length > 1 ? '<div class="chips" style="margin-bottom:10px">' + p.variants.map((x, i) => '<button class="chip" data-act="variant" data-pid="' + p.id + '" data-i="' + i + '" aria-pressed="' + (i === vi) + '">' + esc(L(x.opt)) + '</button>').join('') + '</div>' : '') +
        (w.length ? '<div class="row-flex" style="margin:4px 0 12px"><span class="waiting">' + ic('bell', 'sm') + T('pd.waiting', { n: w.length }) + '</span></div><p class="section-f" style="margin:-4px 4px 12px">' + T('pd.waiting.why') + '</p>' : '') +
        (acts.length ? '<div class="btn-row" style="margin-bottom:6px">' + acts.join('') + '</div>' + (ctx() === 'all' ? '<p class="section-f">' + T('pd.actshop', { shop: sname(ash) }) + '</p>' : '') : '') +
        '<div class="section-h">' + T('pd.stock') + '</div><div class="list">' + stockRowsH + '</div>' +
        (hidden ? '<p class="section-f">' + T('pd.hidden.shops', { n: hidden }) + '</p>' : '') +
        (cost ? '<div class="section-h">' + T('pd.money') + '</div><div class="list">' + cost + '</div>' : '') +
        '<div class="section-h">' + T('pd.codes') + '</div><div class="list">' + v.barcodes.map((b) => cell({ title: '<span class="barcode">' + esc(b) + '</span>', sub: 'EAN-13 · SKU ' + esc(v.sku) })).join('') + '</div>' +
        (hist ? '<div class="section-h">' + T('pd.history') + '</div><div class="list with-tiles">' + (hist.length ? hist.map((m) => cell({
          lead: '<span class="k-ic">' + ic(KI[m.kind] || 'box') + '</span>',
          title: T('k.' + m.kind) + (m.reason ? ' · ' + T('r.' + m.reason) : ''),
          sub: esc(firstName(m.by)) + ' · ' + esc(sname(m.shop)) + ' · ' + esc(rel(m.at)),
          val: '<span class="delta' + (m.delta < 0 ? ' minus' : '') + '">' + (m.delta > 0 ? '+' : '−') + Math.abs(m.delta) + '</span>'
        })).join('') : cell({ title: T('pd.history.none') })) + '</div><p class="section-f">' + T('pd.ledger.note') + '</p>' : '')
    };
  };
  ACT.variant = (el) => { S.ui.variant = S.ui.variant || {}; S.ui.variant[el.dataset.pid] = +el.dataset.i; refresh(); };
  ACT['pd-sell'] = (el) => {
    const res = applyMove({ vid: el.dataset.vid, shop: actionShop(), delta: -1, kind: 'sale', price: variant(el.dataset.vid).price });
    tick(); refresh(); afterMoveToast(res, 'sale', 1);
  };
  ACT['pd-receive'] = (el) => {
    const vid = el.dataset.vid;
    S.ui.recvQty = 12;
    openSheet({ title: t('recv.title'), render: () => '<div class="list with-thumbs">' + cell({ lead: img(product(variant(vid).pid).img, vname(variant(vid)), 'thumb', ''), title: esc(vname(variant(vid))), sub: esc(sname(actionShop())), val: stepper('recv', S.ui.recvQty), chev: false }) + '</div>' +
      (can('products.cost.view') ? '<p class="section-f">' + T('recv.cost', { cost: money(variant(vid).cost) }) + '</p>' : '') +
      '<div class="mt16"><button class="btn primary block" data-act="recv-confirm" data-vid="' + vid + '">' + T('recv.confirm', { n: S.ui.recvQty }) + '</button></div>' });
  };
  ACT.step = (el) => {
    const d = +el.dataset.d;
    if (el.dataset.id === 'recv') { S.ui.recvQty = Math.max(1, Math.min(999, S.ui.recvQty + d)); sheetRefresh(); }
    else if (el.dataset.id.indexOf('line:') === 0) { const vid = el.dataset.id.slice(5); const l = S.ui.recvList.find((x) => x.vid === vid); if (l) { l.n = Math.max(0, l.n + d); if (!l.n) S.ui.recvList = S.ui.recvList.filter((x) => x !== l); } refreshPart('scan-list'); }
    haptic(6);
  };
  ACT['recv-confirm'] = (el) => {
    const vid = el.dataset.vid, n = S.ui.recvQty;
    const res = applyMove({ vid: vid, shop: actionShop(), delta: n, kind: 'receive', cost: variant(vid).cost });
    closeSheet(true); tick(); refresh();
    setTimeout(() => afterMoveToast(res, 'receive', n), 80);
  };

  /* the crm meets ims moment */
  function moment(vid, shop, told) {
    const v = variant(vid), p = product(v.pid);
    const people = told.map((a) => customerById(a.cid)).filter(Boolean);
    openSheet({ title: t('moment.title'), render: () => '<div class="moment">' + img(p.img, pname(p), 'thumb', '') +
      '<div class="t-title3 mt12">' + T('moment.head', { product: vname(v), shop: sname(shop) }) + '</div>' +
      '<div class="mt12"><span class="waiting" id="m-pill">' + ic('bell', 'sm') + '<span id="m-pill-t">' + T('pd.waiting', { n: people.length }) + '</span></span></div>' +
      '<div class="m-avatars" id="m-av">' + people.map((c) => '<span title="' + esc(c.name) + '">' + avatar(c.name).replace('</span>', '<span class="ok"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg></span></span>') + '</span>').join('') + '</div>' +
      '<p class="section-f" style="text-align:center">' + T('moment.why') + '</p></div>',
      after: (sh) => setTimeout(() => playMoment(sh, people.length), S.reduce ? 200 : 650),
      onClose: () => setTimeout(() => toast(t('toast.told', { n: people.length }), { icon: 'send' }), 120) });
  }
  function playMoment(sh, count) {
    const pill = $('#m-pill', sh); if (!pill) return;
    const avs = $$('#m-av .avatar', sh);
    const app = $('#app').getBoundingClientRect();
    const pr = pill.getBoundingClientRect();
    const done = () => {
      pill.classList.add('done');
      $('#m-pill-t', sh).textContent = t('moment.told', { n: count });
      pill.firstElementChild.outerHTML = ic('check', 'sm');
      chime(); haptic(20);
    };
    if (S.reduce) { avs.forEach((a) => a.classList.add('told')); done(); return; }
    avs.forEach((a, i) => {
      const ar = a.getBoundingClientRect();
      const d = document.createElement('span');
      d.className = 'flydot';
      d.style.left = (pr.left - app.left + pr.width / 2 - 4) + 'px';
      d.style.top = (pr.top - app.top + pr.height / 2 - 4) + 'px';
      $('#overlays').appendChild(d);
      const dx = ar.left - pr.left + ar.width / 2 - pr.width / 2, dy = ar.top - pr.top + ar.height / 2 - pr.height / 2;
      d.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: 'translate(' + dx * 0.5 + 'px,' + (dy * 0.5 - 30) + 'px) scale(1.3)', opacity: 1, offset: 0.55 }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.6)', opacity: 0.2 }],
        { duration: 620, delay: i * 55, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }).finished.then(() => { d.remove(); a.classList.add('told'); if (i % 3 === 0) tone(1200 + i * 30, 0, 0.05, 0.03); }).catch(() => d.remove());
    });
    setTimeout(done, avs.length * 55 + 640);
  }

  /* scan */
  function modes() {
    const sh = S.ui.scanShop || actionShop();
    const m = [];
    if (can('products.view')) m.push(['lookup', t('mode.lookup')]);
    if (can('stock.receive', sh)) m.push(['receive', t('mode.receive')]);
    if (can('stock.sell', sh)) m.push(['sell', t('mode.sell')]);
    return m;
  }
  function scanList() {
    const mode = S.ui.scanMode;
    if (mode === 'receive') {
      const l = S.ui.recvList || [];
      if (!l.length) return '<p class="section-f" style="margin-top:4px">' + T('scan.recv.empty') + '</p>';
      const total = l.reduce((s, x) => s + x.n, 0);
      return '<div class="list with-thumbs scanlist">' + l.map((x) => cell({ cls: 'line-' + x.vid, lead: img(product(variant(x.vid).pid).img, vname(variant(x.vid)), 'thumb', ''), title: esc(vname(variant(x.vid))), sub: T('scan.instock', { n: qty(x.vid, S.ui.scanShop || actionShop()) }), val: stepper('line:' + x.vid, x.n), chev: false })).join('') + '</div>' +
        '<div class="mt16"><button class="btn primary block" data-act="scan-recv">' + ic('receive') + T('scan.recv.confirm', { n: total }) + '</button></div>';
    }
    if (mode === 'sell') {
      const l = S.ui.sold || [];
      if (!l.length) return '<p class="section-f" style="margin-top:4px">' + T('scan.sell.empty') + '</p>';
      return '<div class="list with-thumbs scanlist">' + l.slice(0, 6).map((x) => cell({ cls: 'line-' + x.vid, lead: img(product(variant(x.vid).pid).img, vname(variant(x.vid)), 'thumb', ''), title: esc(vname(variant(x.vid))), sub: T('scan.sold.n', { n: x.n }), val: '<span class="qty">' + tally('sq-' + x.vid + '-' + x.shop, qty(x.vid, x.shop)) + '</span>', chev: false })).join('') + '</div><p class="section-f">' + T('scan.sell.note') + '</p>';
    }
    return '<p class="section-f" style="margin-top:4px">' + T('scan.lookup.note') + '</p>';
  }
  PARTS['scan-list'] = scanList;
  SCREENS.scan = () => {
    const ms = modes();
    if (!S.ui.scanMode || !ms.some((m) => m[0] === S.ui.scanMode)) S.ui.scanMode = ms[0][0];
    const sh = S.ui.scanShop || actionShop();
    const shops = myShops('stock.view');
    const items = Dt().products.flatMap((p) => p.variants.map((v) => v));
    return {
      title: t('scan.title'), large: false, cls: 'scan-screen', navCls: 'on-camera', dark: true,
      body: '<div class="viewfinder" id="vf" style="background-image:url(\'' + esc(imgSrc('hero-scan', 'scan')) + '\')"><div class="vf-top">' +
        '<button class="vf-pill" data-act="scan-shop" aria-label="' + T('a11y.shop') + '">' + ic('pin', 'xs') + esc(sname(sh)) + (shops.length > 1 ? ic('chev-down', 'xs') : '') + '</button>' +
        '<span class="vf-pill">' + ic('sparkle', 'xs') + T('scan.continuous') + '</span></div>' +
        '<div class="vf-frame"><span class="vf-c tl"></span><span class="vf-c tr"></span><span class="vf-c bl"></span><span class="vf-c br"></span><span class="vf-line"></span></div>' +
        '<div class="vf-hint">' + T('scan.hint') + '</div></div>' +
        '<div class="scan-pad">' + seg('scanmode', ms, S.ui.scanMode) + '</div>' +
        '<div class="section-h">' + T('scan.shelf') + '</div>' +
        '<div class="shelf" role="list">' + items.map((v) => '<button class="shelf-item" role="listitem" data-act="scan-item" data-vid="' + v.id + '" aria-label="' + T('a11y.scanitem', { name: vname(v) }) + '">' + img(product(v.pid).img, vname(v), '', '') + '<div class="si-name">' + esc(vname(v)) + '</div></button>').join('') +
        '<button class="shelf-item" data-act="scan-unknown" aria-label="' + T('scan.unknown') + '"><div class="si-unknown">' + ic('scan') + '</div><div class="si-name">' + T('scan.unknown') + '</div></button></div>' +
        '<div class="scan-pad">' + tip('scan', 'tip.scan.t', 'tip.scan.b') + '<div data-part="scan-list">' + scanList() + '</div></div>'
    };
  };
  SEG.scanmode = (v) => { S.ui.scanMode = v; refreshPart('scan-list'); renderNarration(); };
  ACT['scan-shop'] = () => {
    const shops = myShops('stock.view');
    if (shops.length < 2) return;
    openSheet({ title: t('scan.pickshop'), render: () => '<div class="list">' + shops.map((s) => cell({ act: 'scan-shop-set', data: { id: s }, title: esc(sname(s)), val: (S.ui.scanShop || actionShop()) === s ? ic('check') : '', chev: false })).join('') + '</div>' });
  };
  ACT['scan-shop-set'] = (el) => { S.ui.scanShop = el.dataset.id; S.ui.recvList = []; closeSheet(); refresh(); };
  function scanFx(srcEl, vid) {
    const vf = $('#vf'); if (vf) { vf.classList.remove('flash'); void vf.offsetWidth; vf.classList.add('flash'); }
    tick();
    const im = srcEl.querySelector('img');
    const target = $('.line-' + vid + ' .thumb') || $('[data-part="scan-list"]');
    if (!im || !target || S.reduce) { const row = $('.line-' + vid); if (row) row.classList.add('pulse'); return; }
    const app = $('#app').getBoundingClientRect(), a = im.getBoundingClientRect(), b = target.getBoundingClientRect();
    const f = document.createElement('img'); f.className = 'fly'; f.src = im.src; f.alt = '';
    f.style.left = (a.left - app.left) + 'px'; f.style.top = (a.top - app.top) + 'px'; f.style.width = a.width + 'px'; f.style.height = a.height + 'px';
    $('#overlays').appendChild(f);
    const dx = b.left - a.left + (b.width - a.width) / 2, dy = b.top - a.top + (b.height - a.height) / 2, sc = Math.max(0.3, b.width / a.width);
    f.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')', opacity: 0.9 }], { duration: 480, easing: 'cubic-bezier(.3,.7,.2,1)' })
      .finished.then(() => { f.remove(); const row = $('.line-' + vid); if (row) { row.classList.remove('pulse'); void row.offsetWidth; row.classList.add('pulse'); } }).catch(() => f.remove());
  }
  ACT['scan-item'] = (el) => {
    const vid = el.dataset.vid, mode = S.ui.scanMode, sh = S.ui.scanShop || actionShop();
    if (mode === 'lookup') { tick(); go('product', { pid: variant(vid).pid }); return; }
    if (mode === 'receive') {
      S.ui.recvList = S.ui.recvList || [];
      const l = S.ui.recvList.find((x) => x.vid === vid);
      if (l) l.n += 1; else S.ui.recvList.unshift({ vid: vid, n: 1 });
      refreshPart('scan-list'); scanFx(el, vid); return;
    }
    if (mode === 'sell') {
      const res = applyMove({ vid: vid, shop: sh, delta: -1, kind: 'sale', price: (activeOffer(vid, sh) || {}).price || variant(vid).price });
      S.ui.sold = S.ui.sold || [];
      const l = S.ui.sold.find((x) => x.vid === vid && x.shop === sh);
      if (l) { l.n += 1; S.ui.sold = [l].concat(S.ui.sold.filter((x) => x !== l)); } else S.ui.sold.unshift({ vid: vid, shop: sh, n: 1 });
      refreshPart('scan-list'); scanFx(el, vid);
      toast(t('toast.sold', { n: 1, product: vname(variant(vid)), left: res.after }), { icon: 'check', ms: 10000, actionLabel: t('undo'), action: () => {
        applyMove({ vid: vid, shop: sh, delta: 1, kind: 'reversal', ref: res.m.id });
        const x = S.ui.sold.find((y) => y.vid === vid && y.shop === sh); if (x) { x.n -= 1; if (x.n <= 0) S.ui.sold = S.ui.sold.filter((y) => y !== x); }
        refreshPart('scan-list'); toast(t('toast.undone'), { icon: 'undo' });
      } });
    }
  };
  ACT['scan-recv'] = () => {
    const sh = S.ui.scanShop || actionShop();
    const l = S.ui.recvList || [];
    let told = null, total = 0;
    l.forEach((x) => { const r = applyMove({ vid: x.vid, shop: sh, delta: x.n, kind: 'receive', cost: variant(x.vid).cost }); total += x.n; if (r.told.length && !told) told = r; });
    S.ui.recvList = [];
    refreshPart('scan-list');
    tick();
    if (told) moment(told.m.vid, sh, told.told);
    else toast(t('toast.recv.batch', { n: total, shop: sname(sh) }), { icon: 'check' });
  };
  ACT['scan-unknown'] = (el) => {
    const code = window.CSData.ean13('5209' + String(Math.floor(10000000 + Math.random() * 89999999)));
    const vf = $('#vf'); if (vf) { vf.classList.remove('flash'); void vf.offsetWidth; vf.classList.add('flash'); }
    tick();
    const sh = S.ui.scanShop || actionShop();
    if (can('products.create')) {
      openSheet({ title: t('unknown.title'), render: () => '<div class="list"><div class="cell"><span class="c-main"><span class="c-sub" style="display:block">' + T('unknown.code') + '</span><span class="barcode">' + esc(code) + '</span></span></div></div><p class="section-f">' + T('unknown.can') + '</p><div class="mt16"><button class="btn primary block" data-act="new-product" data-code="' + esc(code) + '">' + ic('plus') + T('unknown.create') + '</button></div>' });
    } else {
      Dt().unknownCodes.unshift({ code: code, shop: sh, by: S.role, at: Date.now(), times: 1 });
      openSheet({ title: t('unknown.title'), render: () => '<div class="list"><div class="cell"><span class="c-main"><span class="c-sub" style="display:block">' + T('unknown.code') + '</span><span class="barcode">' + esc(code) + '</span></span></div></div>' + '<div class="mt12">' + why(T('unknown.cannot')) + '</div><div class="mt16"><button class="btn gray block" data-act="sheet-close">' + T('ok') + '</button></div>' });
    }
  };
  ACT['new-product'] = (el) => {
    const code = el.dataset.code;
    S.ui.np = { name: '', price: '' };
    openSheet({ title: t('np.title'), detent: 'large', noFocus: true, render: () => '<div class="list">' +
      '<div class="input-cell"><label for="np-name">' + T('np.name') + '</label><input id="np-name" data-in="np-name" placeholder="' + T('np.name.ph') + '" autocomplete="off"></div>' +
      '<div class="input-cell"><label for="np-price">' + T('np.price') + '</label><input id="np-price" data-in="np-price" inputmode="decimal" placeholder="0,00"></div>' +
      '<div class="input-cell"><label>' + T('np.code') + '</label><input value="' + esc(code) + '" readonly></div></div>' +
      '<p class="section-f">' + T('np.note') + '</p><div class="mt16"><button class="btn primary block" data-act="np-save" data-code="' + esc(code) + '">' + T('np.save') + '</button></div>',
      after: (sh) => { const i = $('#np-name', sh); if (i) setTimeout(() => i.focus(), 350); } });
  };
  IN['np-name'] = (el) => { S.ui.np.name = el.value; };
  IN['np-price'] = (el) => { S.ui.np.price = el.value; };
  ACT['np-save'] = (el) => {
    const name = (S.ui.np.name || '').trim() || t('np.default');
    const price = Math.round(parseFloat(String(S.ui.np.price || '0').replace(',', '.')) * 100) || 0;
    const id = 'new-' + Date.now();
    const v = { id: id, pid: id, opt: null, price: price, cost: 0, stock: { kif: 0, mar: 0, gly: 0 }, rp: {}, sku: 'LEM-NEW', barcodes: [el.dataset.code] };
    const p = { id: id, img: null, cat: 'pantry', vat: 24, pop: 0, name: { en: name, el: name, ru: name }, desc: { en: '', el: '', ru: '' }, variants: [v] };
    Dt().products.unshift(p); Dt().variants[id] = v;
    Dt().unknownCodes = Dt().unknownCodes.filter((u) => u.code !== el.dataset.code);
    closeSheet(); toast(t('np.saved', { name: name }), { icon: 'check' }); refresh();
  };

  /* customers */
  function visibleCustomers() {
    if (isCust()) return [];
    if (canOrgWide('customers.view')) return Dt().customers;
    const shops = myShops('customers.view');
    return Dt().customers.filter((c) => shops.some((s) => reaches(c, s)));
  }
  function followLabel(c) {
    const s = c.subs.filter((x) => x.status === 'subscribed');
    if (!s.length) return t('cust.unsub');
    return s.map((x) => (x.scope === 'org' ? t('scope.org.short') : scopeName(x))).join(', ');
  }
  function custRows() {
    const q = S.ui.custQ || '';
    const f = S.ui.custF || 'all';
    let list = visibleCustomers().filter((c) => {
      if (!c._idx) c._idx = window.CSText.index([c.name, c.email]);
      if (!window.CSText.match(c._idx, q)) return false;
      if (f === 'new') return c.created > Date.now() - 7 * D;
      if (f === 'push') return c.hasApp && c.pushOk;
      if (f === 'vip') return c.tags.indexOf('vip') >= 0;
      return true;
    });
    list = list.slice().sort((a, b) => b.created - a.created);
    const total = list.length;
    const lim = S.ui.custLimit || 40;
    const full = can('customers.contact.view');
    if (!total) return '<div class="empty"><span class="e-icon">' + ic('people') + '</span><h3>' + T('cust.empty.t') + '</h3><p>' + T('cust.empty.b') + '</p></div>';
    return '<p class="section-f" style="margin:0 16px 8px">' + T('cust.count', { n: total }) + '</p><div class="list with-thumbs">' + list.slice(0, lim).map((c) => cell({
      act: 'open-customer', data: { id: c.id }, lead: avatar(c.name, 'md') + '',
      title: esc(c.name), sub: esc(full ? c.email : maskEmail(c.email)) + ' · ' + esc(followLabel(c)),
      val: '<span class="row-flex" style="gap:6px;color:var(--secondary)">' + (c.hasApp && c.pushOk ? '<span title="' + T('ch.push') + '">' + ic('bell', 'sm') + '</span>' : '') + (c.emailOk && c.emailVerified ? '<span title="' + T('ch.email') + '">' + ic('mail', 'sm') + '</span>' : '') + '</span>'
    })).join('') + '</div>' + (total > lim ? '<div class="mt12"><button class="btn gray block" data-act="cust-more">' + T('cust.more', { n: total - lim }) + '</button></div>' : '');
  }
  PARTS['cust-list'] = custRows;
  SCREENS.customers = () => {
    const f = S.ui.custF || 'all';
    const fs = [['all', t('f.all')], ['new', t('f.new')], ['push', t('f.push')], ['vip', 'VIP']];
    return {
      title: t('cust.title'),
      body: '<label class="search">' + ic('search') + '<input type="search" placeholder="' + T('cust.search') + '" value="' + esc(S.ui.custQ || '') + '" data-in="cust-q" aria-label="' + T('cust.search') + '"></label>' +
        '<div class="chips" style="margin-bottom:12px">' + fs.map((x) => '<button class="chip" data-act="cust-f" data-f="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + esc(x[1]) + '</button>').join('') + '</div>' +
        (canOrgWide('customers.view') ? '' : '<div class="why" style="margin-bottom:12px">' + ic('info') + '<span>' + T('cust.scoped', { places: myShops('customers.view').map(sname).join(', ') }) + '</span></div>') +
        (can('customers.contact.view') ? '' : '<div class="why" style="margin-bottom:12px">' + ic('lock') + '<span>' + T('cust.masked') + '</span></div>') +
        '<div data-part="cust-list">' + custRows() + '</div>'
    };
  };
  IN['cust-q'] = (el) => { S.ui.custQ = el.value; S.ui.custLimit = 40; refreshPart('cust-list'); };
  ACT['cust-f'] = (el) => { S.ui.custF = el.dataset.f; $$('[data-act="cust-f"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el))); refreshPart('cust-list'); };
  ACT['cust-more'] = () => { S.ui.custLimit = (S.ui.custLimit || 40) + 60; refreshPart('cust-list'); };
  ACT['open-customer'] = (el) => go('customer', { id: el.dataset.id });
  SCREENS.customer = (pr) => {
    const c = customerById(pr.id);
    const full = can('customers.contact.view');
    const waits = Dt().alerts.filter((a) => a.cid === c.id);
    const LANGN = { en: 'English', el: 'Ελληνικά', ru: 'Русский' };
    return {
      title: c.name, large: false,
      body: '<div style="text-align:center;margin:8px 0 18px">' + avatar(c.name, 'lg') + '<div class="t-title2 mt12">' + esc(c.name) + '</div><div class="muted t-sub">' + T('cust.since', { date: dt(c.created, { month: 'long', year: 'numeric' }) }) + ' · ' + T('src.' + c.source) + '</div></div>' +
        '<div class="list with-tiles">' + cell({ lead: tileI('mail', 2), title: esc(full ? c.email : maskEmail(c.email)), sub: c.emailVerified ? T('cust.verified') : T('cust.unverified') }) +
        cell({ lead: tileI('phone', 3), title: esc(full ? c.phone : maskPhone(c.phone)), sub: c.hasApp ? T('cust.hasapp') : T('cust.noapp') }) +
        cell({ lead: tileI('globe', 6), title: esc(LANGN[c.locale]), sub: T('cust.lang') }) + '</div>' +
        (full ? '' : '<p class="section-f">' + T('cust.masked.one') + '</p>') +
        '<div class="section-h">' + T('cust.follows') + '</div><div class="list">' + c.subs.map((s) => cell({ title: esc(s.scope === 'org' ? t('scope.org.long') : scopeName(s)), sub: T('sub.' + s.status) + ' · ' + esc(dt(s.at)) })).join('') + '</div>' +
        '<div class="section-h">' + T('cust.consents') + '</div><div class="list">' + (c.consents.length ? c.consents.map((k) => cell({ title: T('ch.' + k.ch) + ' · ' + (k.granted ? T('consent.yes') : T('consent.no')), sub: esc(dt(k.at, { day: 'numeric', month: 'short', year: 'numeric' })) + ' · ' + T('csrc.' + k.src) + ' · ' + esc(k.text) })).join('') : cell({ title: T('consent.none') })) + '</div><p class="section-f">' + T('cust.consents.note') + '</p>' +
        (c.tags.length ? '<div class="section-h">' + T('cust.tags') + '</div><div class="tagrow" style="padding:0 4px">' + c.tags.map((x) => '<span class="chip static">' + esc(x) + '</span>').join('') + '</div>' : '') +
        (waits.length ? '<div class="section-h">' + T('cust.waits') + '</div><div class="list with-thumbs">' + waits.map((a) => { const v = variant(a.vid); return cell({ lead: img(product(v.pid).img, vname(v), 'thumb', ''), title: esc(vname(v)), sub: esc(a.shop ? sname(a.shop) : t('shop.any')) + ' · ' + T('alert.' + a.status) }); }).join('') + '</div>' : '') +
        (c.notes.length ? '<div class="section-h">' + T('cust.notes') + '</div><div class="list">' + c.notes.map((n) => cell({ title: esc(L(n.text)), sub: esc(firstName(n.by)) + ' · ' + esc(dt(n.at)) })).join('') + '</div>' : '')
    };
  };

  /* posts */
  function visiblePosts() {
    const shops = myShops('posts.view');
    return Dt().posts.filter((p) => p.scopes.some((sc) => shopsOfScope(sc).some((s) => shops.indexOf(s) >= 0)));
  }
  const POST_IMG = { news: 'post-harvest', offer: 'post-offer', new_arrival: 'post-new-arrivals', event: 'post-event' };
  function postStatus(p) {
    if (p.status === 'sent') return '<span class="badge plain">' + ic('send', 'xs') + T('ps.sent', { when: rel(p.sentAt) }) + '</span>';
    if (p.status === 'scheduled') return '<span class="badge info">' + ic('clock', 'xs') + T('ps.scheduled', { when: dt(p.scheduledAt, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }) + '</span>';
    if (p.status === 'pending') return '<span class="badge few">' + ic('clock', 'xs') + T('ps.pending') + '</span>';
    return '';
  }
  function postCardBiz(p) {
    return '<button class="post-card" data-act="open-post-here" data-id="' + p.id + '">' + img(p.img, L(p.title), 'cover', '') + '<span class="pc-body" style="display:block"><span class="pc-meta">' + postStatus(p) + '<span>' + T('kind.' + p.kind) + ' · ' + esc(p.scopes.map(scopeName).join(', ')) + '</span></span><h3>' + esc(L(p.title)) + '</h3>' +
      (p.stats ? '<p>' + T('post.stats.short', { n: p.stats.reached, o: p.stats.pushOpened + p.stats.emailOpened }) + '</p>' : '<p>' + T('post.by', { name: firstName(p.author) }) + '</p>') + '</span></button>';
  }
  SCREENS.posts = () => {
    const ps = visiblePosts().slice().sort((a, b) => (b.sentAt || b.scheduledAt || b.createdAt || 0) - (a.sentAt || a.scheduledAt || a.createdAt || 0));
    const groups = [['pending', t('posts.pending')], ['scheduled', t('posts.scheduled')], ['sent', t('posts.sent')]];
    return {
      title: t('posts.title'),
      right: can('posts.create') ? '<button class="navbtn" data-act="compose" aria-label="' + T('posts.new') + '">' + ic('pencil') + '</button>' : '',
      body: tip('posts', 'tip.posts.t', 'tip.posts.b') + (can('posts.create') ? '' : '<div class="why" style="margin-bottom:12px">' + ic('lock') + '<span>' + T('posts.readonly') + '</span></div>') +
        groups.map((g) => { const l = ps.filter((p) => p.status === g[0]); return l.length ? '<div class="section-h">' + esc(g[1]) + '</div>' + l.map(postCardBiz).join('') : ''; }).join('')
    };
  };
  ACT['open-post-here'] = (el) => go('post', { id: el.dataset.id });
  SCREENS.post = (pr) => {
    const p = Dt().posts.find((x) => x.id === pr.id);
    const canApprove = p.status === 'pending' && can('posts.publish');
    return {
      title: t('kind.' + p.kind), large: false,
      body: '<div class="post-card">' + img(p.img, L(p.title), 'cover', '') + '<div class="pc-body"><div class="pc-meta">' + postStatus(p) + '</div><h3>' + esc(L(p.title)) + '</h3><p>' + esc(L(p.body)) + '</p></div>' + prodStrip(p, null) + '</div>' +
        '<div class="section-h">' + T('post.details') + '</div><div class="list">' +
        cell({ title: T('post.audience'), val: esc(p.scopes.map(scopeName).join(', ')) }) +
        cell({ title: T('post.channels'), val: esc(p.channels.map((c) => t('ch.' + c)).join(', ')) }) +
        cell({ title: T('post.author'), val: esc(personName(p.author)) }) + '</div>' +
        (p.stats ? '<div class="section-h">' + T('post.results') + '</div><div class="list">' +
          cell({ title: T('post.reached'), val: tally('ps-r-' + p.id, p.stats.reached) }) +
          cell({ title: T('post.feedviews'), val: num(p.stats.feedViews) }) +
          (p.stats.pushSent ? cell({ title: T('post.push'), val: T('post.opened', { a: p.stats.pushOpened, b: p.stats.pushSent }) }) : '') +
          (p.stats.emailSent ? cell({ title: T('post.email'), val: T('post.opened', { a: p.stats.emailOpened, b: p.stats.emailSent }) }) : '') + '</div><p class="section-f">' + T('post.opens.note') + '</p>' : '') +
        (canApprove ? '<div class="mt24"><button class="btn primary block" data-act="approve" data-id="' + p.id + '">' + ic('send') + T('post.approve') + '</button></div><p class="section-f">' + T('post.approve.note') + '</p>' :
          p.status === 'pending' ? '<div class="mt16">' + why(T('post.waiting')) + '</div>' : '')
    };
  };
  ACT.approve = (el) => {
    const p = Dt().posts.find((x) => x.id === el.dataset.id);
    const aud = audience(p.scopes, [], p.channels);
    p.status = 'sent'; p.sentAt = Date.now(); p.approvedBy = S.role;
    p.stats = { reached: aud.total, pushSent: p.channels.indexOf('push') >= 0 ? aud.push : 0, pushOpened: 0, emailSent: 0, emailOpened: 0, feedViews: 0 };
    pushPostToAnna(p, aud);
    toast(t('toast.published', { n: aud.total }), { icon: 'send' });
    refresh();
  };
  function prodStrip(p, shop) {
    if (!p.products || !p.products.length) return '';
    const showPrice = !isCust() || Dt().org.settings.prices;
    return '<div class="pc-products">' + p.products.map((x) => {
      const v = variant(x.vid), pr = product(v.pid);
      const off = x.offer != null && p.kind === 'offer' ? x.offer : null;
      const was = off != null ? wasPrice(v.id, p.validFrom || Date.now()) : null;
      return '<button class="pc-prod" data-act="' + (isCust() ? 'c-open-product' : 'open-product') + '" data-pid="' + pr.id + '">' + img(pr.img, pname(pr), '', '') + '<div class="n">' + esc(vname(v)) + '</div>' +
        (showPrice ? '<div class="pr">' + esc(money(off != null ? off : v.price)) + (off != null ? '<span class="was">' + esc(money(was)) + '</span>' : '') + '</div>' : '') + '</button>';
    }).join('') + '</div>';
  }

  /* composer with the audience breakdown */
  function postScopes() {
    const out = [];
    if (canOrgWide('posts.create')) out.push({ scope: 'org', id: 'lemoni' });
    Dt().groups.forEach((g) => { if (canOrgWide('posts.create') || me().assign.some((a) => a.scope === 'group' && a.id === g.id && Dt().roles[a.role].perms.has('posts.create'))) out.push({ scope: 'group', id: g.id }); });
    Dt().shops.forEach((s) => { if (can('posts.create', s.id)) out.push({ scope: 'shop', id: s.id }); });
    return out;
  }
  const skey = (sc) => sc.scope + ':' + sc.id;
  function audience(scopes, tags, channels) {
    const shops = Array.from(new Set(scopes.flatMap(shopsOfScope)));
    const by = {};
    let total = 0, push = 0, noPush = 0, capped = 0, email = 0, noEmail = 0, anna = false;
    const cap = Dt().org.settings.pushCap;
    Dt().customers.forEach((c) => {
      if (tags.length && !c.tags.some((x) => tags.indexOf(x) >= 0)) return;
      if (!shops.some((s) => reaches(c, s))) return;
      total += 1;
      if (c.id === 'c-anna') anna = true;
      let reason = null;
      const sh = c.subs.find((s) => s.status === 'subscribed' && s.scope === 'shop' && shops.indexOf(s.id) >= 0);
      if (sh) reason = 'shop:' + sh.id;
      else { const g = c.subs.find((s) => s.status === 'subscribed' && s.scope === 'group'); reason = g ? 'group:' + g.id : 'org:lemoni'; }
      by[reason] = (by[reason] || 0) + 1;
      if (c.hasApp && c.pushOk) { if (c.pushesToday >= cap) capped += 1; else push += 1; } else noPush += 1;
      if (c.emailOk && c.emailVerified) email += 1; else noEmail += 1;
    });
    return { total: total, by: by, push: push, noPush: noPush, capped: capped, email: email, noEmail: noEmail, anna: anna, channels: channels };
  }
  function audienceHtml() {
    const c = S.compose;
    const sc = c.scopes.map((k) => { const p = k.split(':'); return { scope: p[0], id: p[1] }; });
    const ch = ['feed'].concat(c.push ? ['push'] : []).concat(c.email ? ['email'] : []);
    const a = audience(sc, c.tags, ch);
    if (!sc.length) return '<div class="audience">' + T('aud.none') + '</div>';
    const parts = Object.keys(a.by).sort((x, y) => a.by[y] - a.by[x]).map((k) => {
      const p = k.split(':');
      const place = p[0] === 'org' ? t('scope.org.inline') : scopeName({ scope: p[0], id: p[1] });
      return '<li>' + ic('people') + '<span>' + T('aud.follow', { n: a.by[k], place: place }) + '</span></li>';
    });
    const h = new Date().getHours(), s = Dt().org.settings;
    const quiet = h >= s.quietFrom || h < s.quietTo;
    if (c.push) {
      parts.push('<li>' + ic('bell') + '<span>' + T('aud.push', { n: a.push }) + '</span></li>');
      if (a.noPush) parts.push('<li>' + ic('info') + '<span>' + T('aud.nopush', { n: a.noPush }) + '</span></li>');
      if (a.capped) parts.push('<li>' + ic('info') + '<span>' + T('aud.capped', { n: a.capped, cap: s.pushCap }) + '</span></li>');
      parts.push('<li>' + ic('moon') + '<span>' + (quiet ? T('aud.quiet.now', { from: s.quietFrom + ':00', to: '0' + s.quietTo + ':00' }) : T('aud.quiet', { from: s.quietFrom + ':00', to: '0' + s.quietTo + ':00' })) + '</span></li>');
    }
    if (c.email && a.noEmail) parts.push('<li>' + ic('mail') + '<span>' + T('aud.noemail', { n: a.noEmail }) + '</span></li>');
    return '<div class="audience"><div class="a-total">' + tally('aud-total', a.total) + '<small>' + T('aud.people', { n: a.total }) + '</small></div><ul>' + parts.join('') + '</ul></div>';
  }
  PARTS.audience = audienceHtml;
  function newCompose() {
    const scopes = postScopes();
    return { kind: 'news', lang: S.lang, title: { en: '', el: '', ru: '' }, body: { en: '', el: '', ru: '' }, products: [], scopes: scopes.length ? [skey(scopes[scopes.length > 1 ? 1 : 0])] : [], tags: [], push: can('posts.channel.push'), email: false, when: 'now' };
  }
  function langTabs() {
    const c = S.compose;
    return seg('clang', [['en', 'EN' + (c.title.en ? ' ✓' : '')], ['el', 'ΕΛ' + (c.title.el ? ' ✓' : '')], ['ru', 'RU' + (c.title.ru ? ' ✓' : '')]], c.lang);
  }
  PARTS['lang-tabs'] = langTabs;
  function composeProducts() {
    const c = S.compose;
    if (!c.products.length) return '<div class="list">' + cell({ act: 'pick-products', lead: tileI('plus', 1), title: T('cmp.addproducts'), sub: T('cmp.addproducts.sub') }) + '</div>';
    return '<div class="list with-thumbs">' + c.products.map((x) => {
      const v = variant(x.vid), p = product(v.pid);
      const was = wasPrice(v.id, Date.now());
      return '<div class="cell">' + img(p.img, vname(v), 'thumb', '') + '<span class="c-main"><span class="c-title" style="display:block">' + esc(vname(v)) + '</span><span class="c-sub" style="display:block">' +
        (c.kind === 'offer' ? T('cmp.was', { price: money(was) }) + (was !== v.price ? ' ' + T('cmp.was.lower', { now: money(v.price) }) : '') : esc(money(v.price))) + '</span></span>' +
        (c.kind === 'offer' ? '<span class="offer-row"><input inputmode="decimal" aria-label="' + T('cmp.offerprice') + '" data-in="offer-price" data-vid="' + v.id + '" value="' + (x.offer != null ? (x.offer / 100).toFixed(2) : '') + '" placeholder="' + T('cmp.offer.ph') + '"></span>' : '') +
        '<button class="iconbtn" style="width:36px;height:36px;margin-left:4px" data-act="cmp-rm" data-vid="' + v.id + '" aria-label="' + T('a11y.remove') + '">' + ic('x', 'sm') + '</button></div>';
    }).join('') + cell({ act: 'pick-products', lead: tileI('plus', 1), title: T('cmp.addmore') }) + '</div>' + (c.kind === 'offer' ? '<p class="section-f">' + T('cmp.omnibus') + '</p>' : '');
  }
  PARTS['cmp-products'] = composeProducts;
  SCREENS.compose = () => {
    if (!S.compose) S.compose = newCompose();
    const c = S.compose;
    const scopes = postScopes();
    const publish = can('posts.publish');
    const kinds = [['news', t('kind.news')], ['offer', t('kind.offer')], ['new_arrival', t('kind.new_arrival')], ['event', t('kind.event')]];
    const tagsAll = ['regular', 'vip', 'olive oil club', 'tasting'];
    return {
      title: t('cmp.title'), large: false, solid: true, modal: true,
      left: '<button class="navbtn" data-act="cmp-cancel">' + T('cancel') + '</button>',
      right: '<button class="navbtn strong" data-act="cmp-send">' + (publish ? (c.when === 'now' ? T('cmp.publish') : T('cmp.schedule')) : T('cmp.submit')) + '</button>',
      body: '<div style="margin-top:8px">' + seg('ckind', kinds, c.kind) + '</div>' +
        '<div class="section-h">' + T('cmp.text') + '<button class="linkbtn" data-act="cmp-example">' + T('cmp.example') + '</button></div>' +
        '<div class="lang-tabs" data-part="lang-tabs">' + langTabs() + '</div>' +
        '<div class="list"><div class="input-cell"><input style="text-align:left" data-in="cmp-title" placeholder="' + T('cmp.title.ph') + '" value="' + esc(c.title[c.lang]) + '" aria-label="' + T('cmp.title.ph') + '"></div>' +
        '<div style="padding:0"><textarea class="input" style="border-radius:0" data-in="cmp-body" placeholder="' + T('cmp.body.ph') + '" aria-label="' + T('cmp.body.ph') + '">' + esc(c.body[c.lang]) + '</textarea></div></div>' +
        '<p class="section-f">' + T('cmp.lang.note') + '</p>' +
        '<div class="section-h">' + T('cmp.products') + '</div><div data-part="cmp-products">' + composeProducts() + '</div>' +
        '<div class="section-h">' + T('cmp.who') + '</div>' +
        '<div class="chips" style="margin-bottom:8px">' + scopes.map((s) => '<button class="chip" data-act="cmp-scope" data-k="' + skey(s) + '" aria-pressed="' + (c.scopes.indexOf(skey(s)) >= 0) + '">' + esc(s.scope === 'org' ? t('scope.org.short') : scopeName(s)) + '</button>').join('') + '</div>' +
        '<div class="chips" style="margin-bottom:12px">' + tagsAll.map((x) => '<button class="chip" data-act="cmp-tag" data-k="' + esc(x) + '" aria-pressed="' + (c.tags.indexOf(x) >= 0) + '">' + ic('tag', 'xs') + esc(x) + '</button>').join('') + '</div>' +
        '<div data-part="audience">' + audienceHtml() + '</div>' +
        '<div class="section-h">' + T('cmp.channels') + '</div><div class="list with-tiles">' +
        cell({ lead: tileI('home', 5), title: T('ch.feed'), sub: T('cmp.feed.sub'), val: sw('noop', true, true, t('ch.feed')) }) +
        cell({ lead: tileI('bell', 1), title: T('ch.push'), sub: can('posts.channel.push') ? T('cmp.push.sub') : '<span class="lock-note">' + ic('lock') + T('cmp.locked') + '</span>', val: sw('cmp-push', c.push, !can('posts.channel.push'), t('ch.push')) }) +
        cell({ lead: tileI('mail', 2), title: T('ch.email'), sub: can('posts.channel.email') ? T('cmp.email.sub') : '<span class="lock-note">' + ic('lock') + T('cmp.locked') + '</span>', val: sw('cmp-email', c.email, !can('posts.channel.email'), t('ch.email')) }) + '</div>' +
        '<div class="section-h">' + T('cmp.when') + '</div>' + seg('cwhen', [['now', t('cmp.now')], ['tomorrow', t('cmp.tomorrow')]], c.when) +
        (publish ? '' : '<div class="mt12">' + why(T('cmp.needs.approval')) + '</div>') +
        '<div class="mt24"><button class="btn primary block" data-act="cmp-send">' + ic('send') + (publish ? (c.when === 'now' ? T('cmp.publish') : T('cmp.schedule')) : T('cmp.submit')) + '</button></div>'
    };
  };
  ACT.compose = () => { S.compose = newCompose(); go('compose'); };
  ACT['cmp-cancel'] = () => { S.compose = null; back(); };
  SEG.ckind = (v) => { S.compose.kind = v; refreshPart('cmp-products'); };
  SEG.clang = (v) => { S.compose.lang = v; const c = S.compose; const ti = $('[data-in="cmp-title"]'), bo = $('[data-in="cmp-body"]'); if (ti) ti.value = c.title[v]; if (bo) bo.value = c.body[v]; };
  SEG.cwhen = (v) => { S.compose.when = v; refresh(); };
  IN['cmp-title'] = (el) => { S.compose.title[S.compose.lang] = el.value; refreshPart('lang-tabs'); };
  IN['cmp-body'] = (el) => { S.compose.body[S.compose.lang] = el.value; };
  IN['offer-price'] = (el) => { const x = S.compose.products.find((p) => p.vid === el.dataset.vid); const v = parseFloat(el.value.replace(',', '.')); x.offer = isNaN(v) ? null : Math.round(v * 100); };
  ACT['cmp-example'] = () => {
    const c = S.compose;
    c.kind = 'new_arrival';
    c.title = { en: 'New harvest olive oil is in', el: 'Ήρθε το νέο ελαιόλαδο', ru: 'Новое оливковое масло уже здесь' };
    c.body = { en: 'Fresh from Messinia, cold pressed this month. Come taste it.', el: 'Φρέσκο από τη Μεσσηνία, ψυχρής έκθλιψης αυτόν τον μήνα. Ελάτε να το δοκιμάσετε.', ru: 'Свежее из Мессинии, холодный отжим этого месяца. Приходите попробовать.' };
    if (!c.products.some((x) => x.vid === 'olive-oil')) c.products.push({ vid: 'olive-oil', offer: null });
    refresh();
  };
  ACT['cmp-scope'] = (el) => { const c = S.compose, k = el.dataset.k; c.scopes = c.scopes.indexOf(k) >= 0 ? c.scopes.filter((x) => x !== k) : c.scopes.concat([k]); el.setAttribute('aria-pressed', String(c.scopes.indexOf(k) >= 0)); refreshPart('audience'); };
  ACT['cmp-tag'] = (el) => { const c = S.compose, k = el.dataset.k; c.tags = c.tags.indexOf(k) >= 0 ? c.tags.filter((x) => x !== k) : c.tags.concat([k]); el.setAttribute('aria-pressed', String(c.tags.indexOf(k) >= 0)); refreshPart('audience'); };
  ACT['cmp-rm'] = (el) => { S.compose.products = S.compose.products.filter((x) => x.vid !== el.dataset.vid); refreshPart('cmp-products'); };
  CH['cmp-push'] = (el) => { S.compose.push = el.checked; refreshPart('audience'); };
  CH['cmp-email'] = (el) => { S.compose.email = el.checked; refreshPart('audience'); };
  CH.noop = () => {};
  ACT['pick-products'] = () => {
    openSheet({ title: t('cmp.pick'), detent: 'large', render: () => '<div class="list with-thumbs">' + Dt().products.flatMap((p) => p.variants).map((v) => {
      const on = S.compose.products.some((x) => x.vid === v.id);
      return cell({ act: 'cmp-toggle', data: { vid: v.id }, lead: img(product(v.pid).img, vname(v), 'thumb', ''), title: esc(vname(v)), sub: esc(money(v.price)), val: on ? '<span style="color:var(--accent-text)">' + ic('check') + '</span>' : '', chev: false });
    }).join('') + '</div>', onClose: () => refreshPart('cmp-products') });
  };
  ACT['cmp-toggle'] = (el) => { const c = S.compose, vid = el.dataset.vid; c.products = c.products.some((x) => x.vid === vid) ? c.products.filter((x) => x.vid !== vid) : c.products.concat([{ vid: vid, offer: null }]); haptic(6); sheetRefresh(); };
  ACT['cmp-send'] = () => {
    const c = S.compose;
    const lang = ['el', 'en', 'ru'].find((l) => c.title[l]) || null;
    if (!lang) { toast(t('cmp.need.title'), { icon: 'info' }); const i = $('[data-in="cmp-title"]'); if (i) i.focus(); return; }
    if (!c.scopes.length) { toast(t('cmp.need.scope'), { icon: 'info' }); return; }
    ['en', 'el', 'ru'].forEach((l) => { if (!c.title[l]) { c.title[l] = c.title[lang]; c.body[l] = c.body[l] || c.body[lang]; } });
    const scopes = c.scopes.map((k) => { const p = k.split(':'); return { scope: p[0], id: p[1] }; });
    const ch = ['feed'].concat(c.push ? ['push'] : []).concat(c.email ? ['email'] : []);
    const publish = can('posts.publish');
    const p = { id: 'p' + Date.now(), kind: c.kind, author: S.role, scopes: scopes, img: POST_IMG[c.kind], channels: ch, products: c.products.slice(), title: c.title, body: c.body, createdAt: Date.now() };
    if (c.kind === 'offer') { p.validFrom = Date.now(); p.validUntil = Date.now() + 5 * D; }
    const aud = audience(scopes, c.tags, ch);
    if (!publish) { p.status = 'pending'; Dt().posts.unshift(p); toast(t('toast.submitted', { name: firstName('nikos') }), { icon: 'clock' }); }
    else if (c.when === 'tomorrow') { const d = new Date(Date.now() + D); d.setHours(9, 0, 0, 0); p.status = 'scheduled'; p.scheduledAt = d.getTime(); Dt().posts.unshift(p); toast(t('toast.scheduled', { n: aud.total }), { icon: 'calendar' }); }
    else {
      p.status = 'sent'; p.sentAt = Date.now();
      p.stats = { reached: aud.total, pushSent: c.push ? aud.push : 0, pushOpened: 0, emailSent: c.email ? aud.email : 0, emailOpened: 0, feedViews: 0 };
      Dt().posts.unshift(p);
      toast(t('toast.published', { n: aud.total }), { icon: 'send' });
      pushPostToAnna(p, aud);
    }
    S.compose = null;
    back();
  };
  function pushPostToAnna(p, aud) {
    const anna = customerById('c-anna');
    if (p.channels.indexOf('push') < 0 || !aud.anna || !anna.pushOk) return;
    const shop = p.scopes.length === 1 && p.scopes[0].scope === 'shop' ? shopById(p.scopes[0].id) : null;
    deliver('anna', { org: 'lemoni', merchant: shop ? { en: 'Lemoni ' + shop.name.en, el: 'Lemoni ' + shop.name.el, ru: 'Lemoni ' + shop.name.ru } : { en: 'Lemoni', el: 'Lemoni', ru: 'Lemoni' },
      title: p.title, body: p.body, img: p.img, route: { role: 'anna', tab: 'c-home', name: 'c-post', params: { id: p.id } } }, 2200);
  }

  /* ======================= customer app (anna) ======================= */
  const ANNA = () => customerById('c-anna');
  function annaShops() { return Dt().shops.filter((s) => reaches(ANNA(), s.id)).map((s) => s.id); }
  function custMode(shop) { const s = shopById(shop); return s.customerStock || Dt().org.settings.stock; }
  function custAvail(p, vid, shop) {
    const mode = custMode(shop);
    if (mode === 'off' || p.customerStockHidden || !shopById(shop).visible) return null;
    const q = qty(vid, shop), few = Dt().org.settings.fewLeft;
    const st = q <= 0 ? 'out' : q <= few ? 'few' : 'ok';
    if (mode === 'exact') return { st: st, html: st === 'out' ? badge('out') : st === 'few' ? badge('few', t('cs.exact', { n: q })) : '<span class="muted t-foot">' + T('cs.exact', { n: q }) + '</span>' };
    return { st: st, html: st === 'ok' ? '<span class="muted t-foot">' + T('cs.in') + '</span>' : st === 'few' ? badge('few', t('cs.few')) : badge('out', t('cs.out')) };
  }
  function custPostCard(p, org) {
    const merchant = org ? L(org.name) : 'Lemoni';
    const logo = org ? '<span class="logo-tile bakery" style="width:30px;height:30px;font-size:15px;border-radius:8px">' + esc(L(org.letter)) + '</span>' : '<span class="logo-tile" style="width:30px;height:30px;font-size:15px;border-radius:8px">L</span>';
    const off = p.kind === 'offer' && p.validUntil ? '<span class="badge accent">' + ic('tag', 'xs') + T('c.until', { date: dt(p.validUntil, { weekday: 'long' }) }) + '</span>' : '';
    return '<div class="post-card" style="margin-bottom:14px"><div class="pc-body" style="display:flex;align-items:center;gap:10px;padding-bottom:10px">' + logo + '<div class="grow"><div class="t-headline" style="font-size:15px">' + esc(merchant) + '</div><div class="muted t-foot">' + esc(rel(p.sentAt)) + (org ? '' : ' · ' + esc(p.scopes.map((s) => s.scope === 'org' ? t('scope.org.short') : scopeName(s)).join(', '))) + '</div></div>' + off + '</div>' +
      (p.img ? '<button style="all:unset;display:block;cursor:pointer" data-act="c-open-post" data-id="' + p.id + '" aria-label="' + esc(L(p.title)) + '">' + img(p.img, L(p.title), 'cover', '') + '</button>' : '') +
      '<div class="pc-body"><h3>' + esc(L(p.title)) + '</h3><p>' + esc(L(p.body)) + '</p></div>' + (org ? '' : prodStrip(p, null)) + '</div>';
  }
  function annaPosts() {
    const shops = annaShops();
    return Dt().posts.filter((p) => p.status === 'sent' && p.scopes.some((sc) => shopsOfScope(sc).some((s) => shops.indexOf(s) >= 0)));
  }
  SCREENS['c-home'] = () => {
    const notified = Dt().alerts.filter((a) => a.cid === 'c-anna' && a.status === 'notified');
    const items = annaPosts().map((p) => ({ at: p.sentAt, html: custPostCard(p, null) }))
      .concat(Dt().otherOrgs.flatMap((o) => o.posts.map((p) => ({ at: p.sentAt, html: custPostCard(p, o) }))))
      .sort((a, b) => b.at - a.at);
    notified.forEach((a) => { a.seen = true; });
    return {
      title: t('c.home.title'),
      body: tip('c-home', 'tip.chome.t', 'tip.chome.b') +
        notified.map((a) => { const v = variant(a.vid), p = product(v.pid); return '<button class="card row-flex" style="width:100%;border:0;text-align:left;margin-bottom:14px;gap:12px;color:inherit" data-act="c-open-product" data-pid="' + p.id + '">' + img(p.img, pname(p), 'thumb', '') + '<span class="grow"><span class="badge ok">' + ic('check', 'xs') + T('c.back') + '</span><span class="t-headline" style="display:block;margin-top:4px">' + esc(vname(v)) + '</span><span class="muted t-foot">' + T('c.back.sub', { shop: sname(a.shop) }) + '</span></span>' + ic('chev-right', 'chev') + '</button>'; }).join('') +
        items.map((x) => x.html).join('')
    };
  };
  ACT['c-open-post'] = (el) => go('c-post', { id: el.dataset.id });
  SCREENS['c-post'] = (pr) => {
    const p = Dt().posts.find((x) => x.id === pr.id);
    return { title: t('kind.' + p.kind), large: false, body: custPostCard(p, null) + (p.kind === 'offer' && Dt().org.settings.prices ? '<p class="section-f">' + T('c.omnibus') + '</p>' : '') };
  };
  SCREENS['c-offers'] = () => {
    const now = Date.now();
    const offers = annaPosts().filter((p) => p.kind === 'offer' && p.validUntil > now);
    return {
      title: t('c.offers.title'),
      body: offers.length ? offers.map((p) => custPostCard(p, null)).join('') + (Dt().org.settings.prices ? '<p class="section-f">' + T('c.omnibus') + '</p>' : '<p class="section-f">' + T('c.noprices') + '</p>') :
        '<div class="empty"><span class="e-icon">' + ic('tag') + '</span><h3>' + T('c.offers.empty.t') + '</h3><p>' + T('c.offers.empty.b') + '</p></div>'
    };
  };
  SCREENS['c-catalog'] = () => {
    const s = Dt().org.settings;
    const shops = annaShops();
    if (!S.ui.cShop || shops.indexOf(S.ui.cShop) < 0) S.ui.cShop = shops[0];
    const cat = S.ui.cCat || 'all';
    let body = '';
    if (s.catalog === 'off') {
      body = '<div class="empty"><span class="e-icon">' + ic('grid') + '</span><h3>' + T('c.cat.off.t') + '</h3><p>' + T('c.cat.off.b') + '</p><button class="btn tinted" data-act="tab" data-id="c-home">' + T('c.cat.off.cta') + '</button></div>';
    } else {
      const list = Dt().products.filter((p) => !p.id.startsWith('new-') && (cat === 'all' || p.cat === cat));
      body = '<div class="why" style="margin-bottom:12px">' + ic(s.catalog === 'public' ? 'globe' : 'people') + '<span>' + T(s.catalog === 'public' ? 'c.cat.public' : 'c.cat.subs') + '</span></div>' +
        (shops.length > 1 ? '<div class="chips" style="margin-bottom:8px">' + shops.map((x) => '<button class="chip" data-act="c-shop-pick" data-id="' + x + '" aria-pressed="' + (S.ui.cShop === x) + '">' + ic('pin', 'xs') + esc(sname(x)) + '</button>').join('') + '</div>' : '') +
        '<div class="chips" style="margin-bottom:12px">' + [['all', t('f.all')]].concat(Dt().categories.map((c) => [c.id, L(c.name)])).map((x) => '<button class="chip" data-act="c-cat" data-id="' + x[0] + '" aria-pressed="' + (cat === x[0]) + '">' + esc(x[1]) + '</button>').join('') + '</div>' +
        '<div class="grid2">' + list.map((p) => {
          const v = p.variants[0];
          const off = activeOffer(v.id, S.ui.cShop);
          const av = custAvail(p, v.id, S.ui.cShop);
          return '<button class="pgrid-item" data-act="c-open-product" data-pid="' + p.id + '">' + img(p.img, pname(p), '', '') + '<span class="gi" style="display:block"><span class="n" style="display:block">' + esc(pname(p)) + '</span>' +
            (s.prices ? '<span class="p" style="display:block">' + esc(money(off ? off.price : v.price)) + (off ? ' <span class="was">' + esc(money(off.was)) + '</span>' : '') + '</span>' : '') +
            (av ? '<span style="display:block;margin-top:4px">' + av.html + '</span>' : '') + '</span></button>';
        }).join('') + '</div>' + (custMode(S.ui.cShop) === 'off' ? '<p class="section-f">' + T('c.stock.off', { shop: sname(S.ui.cShop) }) + '</p>' : '');
    }
    return { title: t('c.cat.title'), body: (s.catalog === 'off' ? '' : '<div class="lsub">Lemoni</div>') + body };
  };
  ACT['c-shop-pick'] = (el) => { S.ui.cShop = el.dataset.id; refresh(); };
  ACT['c-cat'] = (el) => { S.ui.cCat = el.dataset.id; refresh(); };
  ACT['c-open-product'] = (el) => go('c-product', { pid: el.dataset.pid });
  SCREENS['c-product'] = (pr) => {
    const p = product(pr.pid), s = Dt().org.settings;
    const vi = Math.min((S.ui.cVariant && S.ui.cVariant[p.id]) || 0, p.variants.length - 1);
    const v = p.variants[vi];
    const shops = Dt().shops.filter((x) => x.visible).map((x) => x.id);
    const off = activeOffer(v.id, annaShops()[0]);
    const fav = Dt().favorites.has('c-anna|' + p.id);
    const rows = shops.map((sh) => {
      const av = custAvail(p, v.id, sh);
      if (!av) return null;
      const waiting = Dt().alerts.find((a) => a.cid === 'c-anna' && a.vid === v.id && a.shop === sh && a.status === 'waiting');
      const notify = av.st === 'out' ? (waiting ? '<span class="badge ok">' + ic('check', 'xs') + T('c.notify.on') + '</span>' : '<button class="btn small tinted" data-act="c-notify" data-vid="' + v.id + '" data-shop="' + sh + '">' + ic('bell', 'sm') + T('c.notify') + '</button>') : '';
      return cell({ title: esc(sname(sh)), sub: av.html, val: notify, chev: false });
    }).filter(Boolean);
    return {
      title: pname(p), large: false,
      right: '<button class="navbtn heart' + (fav ? ' on' : '') + '" data-act="c-fav" data-pid="' + p.id + '" aria-pressed="' + fav + '" aria-label="' + T('c.fav') + '">' + ic('heart') + '</button><button class="navbtn" data-act="c-share" aria-label="' + T('c.share') + '">' + ic('share') + '</button>',
      body: img(p.img, pname(p), 'hero-img', '') + '<div class="pd-head"><h1 class="pd-name">' + esc(pname(p)) + '</h1>' +
        (s.prices ? '<div class="price-row"><span class="price">' + esc(money(off ? off.price : v.price)) + '</span>' + (off ? '<span class="was">' + esc(money(off.was)) + '</span><span class="badge accent">' + ic('tag', 'xs') + T('c.offer.until', { date: dt(off.post.validUntil, { weekday: 'long' }) }) + '</span>' : '') + '</div>' + (off ? '<p class="section-f" style="margin:6px 0 0">' + T('c.omnibus') + '</p>' : '') : '<p class="muted mt8">' + T('c.noprice') + '</p>') +
        '<p class="t-callout muted" style="margin:10px 0 0">' + esc(L(p.desc)) + '</p></div>' +
        (p.variants.length > 1 ? '<div class="chips" style="margin-bottom:10px">' + p.variants.map((x, i) => '<button class="chip" data-act="c-variant" data-pid="' + p.id + '" data-i="' + i + '" aria-pressed="' + (i === vi) + '">' + esc(L(x.opt)) + '</button>').join('') + '</div>' : '') +
        (rows.length ? '<div class="section-h">' + T('c.where') + '</div><div class="list">' + rows.join('') + '</div><p class="section-f">' + T(s.stock === 'exact' ? 'c.where.exact' : 'c.where.note') + '</p>' :
          '<div class="mt12">' + why(T('c.stock.hidden')) + '</div>')
    };
  };
  ACT['c-variant'] = (el) => { S.ui.cVariant = S.ui.cVariant || {}; S.ui.cVariant[el.dataset.pid] = +el.dataset.i; refresh(); };
  ACT['c-fav'] = (el) => { const k = 'c-anna|' + el.dataset.pid; if (Dt().favorites.has(k)) Dt().favorites.delete(k); else { Dt().favorites.add(k); haptic(8); } refresh(); };
  ACT['c-share'] = () => toast(t('c.shared'), { icon: 'share' });
  ACT['c-notify'] = (el) => {
    Dt().alerts.push({ id: 'a' + Date.now(), cid: 'c-anna', vid: el.dataset.vid, shop: el.dataset.shop, status: 'waiting', at: Date.now() });
    haptic(10); toast(t('c.notify.done', { shop: sname(el.dataset.shop) }), { icon: 'bell' }); refresh();
  };
  SCREENS['c-shops'] = () => {
    const a = ANNA();
    const shops = annaShops();
    const via = a.subs.find((s) => s.scope === 'group' && s.status === 'subscribed');
    return {
      title: t('c.shops.title'),
      body: '<div class="section-h">Lemoni</div><div class="list with-thumbs">' + shops.map((s) => { const sh = shopById(s); return cell({ act: 'c-open-shop', data: { id: s }, lead: img(sh.img, sname(s), 'thumb', ''), title: esc(sname(s)), sub: esc(L(sh.addr)) + ' · ' + esc(sh.hours) }); }).join('') + '</div>' +
        (via ? '<p class="section-f">' + T('c.shops.via', { group: L(groupById(via.id).name) }) + '</p>' : '') +
        Dt().otherOrgs.map((o) => '<div class="section-h">' + esc(L(o.name)) + '</div><div class="list with-thumbs">' + cell({ lead: '<span class="logo-tile bakery" style="width:44px;height:44px;font-size:20px;border-radius:9px">' + esc(L(o.letter)) + '</span>', title: esc(L(o.shop)), sub: T('c.shops.other') }) + '</div>').join('') +
        '<p class="section-f">' + T('c.shops.private') + '</p>'
    };
  };
  ACT['c-open-shop'] = (el) => go('c-shop', { id: el.dataset.id });
  SCREENS['c-shop'] = (pr) => {
    const sh = shopById(pr.id);
    return { title: sname(sh.id), large: false, body: img(sh.img, sname(sh.id), 'hero-img', '') + '<div class="pd-head"><h1 class="pd-name">Lemoni ' + esc(sname(sh.id)) + '</h1><p class="muted t-callout" style="margin:6px 0 0">' + esc(L(sh.addr)) + '</p></div>' +
      '<div class="list with-tiles">' + cell({ lead: tileI('clock', 3), title: esc(sh.hours), sub: T('c.shop.hours') }) + cell({ lead: tileI('box', 2), title: T('c.shop.stock.' + custMode(sh.id)), sub: T('c.shop.stock.sub') }) + '</div>' +
      '<div class="mt16"><button class="btn tinted block" data-act="tab" data-id="c-catalog">' + ic('grid') + T('c.shop.browse') + '</button></div>' };
  };

  /* ---------------- swipe rows ---------------- */
  function closeSwipes(except) { $$('.swipe.open').forEach((r) => { if (r !== except) { r.classList.remove('open'); $('.cell', r).style.transform = ''; } }); }
  function swipedRecently(el) { const r = el.closest('.swipe'); return !!(r && r.dataset.swiped && Date.now() - +r.dataset.swiped < 350); }
  document.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.swipe');
    if (!row || e.button > 0 || e.target.closest('.sw-actions')) { if (!e.target.closest('.swipe')) closeSwipes(); return; }
    const c = $('.cell', row), w = $('.sw-actions', row).offsetWidth;
    const x0 = e.clientX, y0 = e.clientY, base = row.classList.contains('open') ? -w : 0;
    let drag = false, x = base;
    const mv = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!drag && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { drag = true; row.classList.add('dragging'); closeSwipes(row); }
      if (!drag) return;
      x = Math.max(-w - 40, Math.min(0, base + dx));
      c.style.transform = 'translateX(' + x + 'px)';
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (!drag) return;
      row.classList.remove('dragging');
      row.dataset.swiped = String(Date.now());
      const open = x < -w / 2;
      row.classList.toggle('open', open);
      c.style.transform = open ? 'translateX(' + (-w) + 'px)' : '';
      if (open) haptic(6);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }, { passive: true });

  /* ---------------- roles, chrome ---------------- */
  function firstTab() { return tabs()[0].id; }
  function setRole(id, silent) {
    S.role = id; save();
    S.stacks = {}; S.tab = firstTab(); S.compose = null;
    S.ui = { stockFilter: 'all' };
    S.previews = S.previews.filter((p) => p.persona !== id);
    closeSheet(true);
    hideToast();
    if (!silent) renderApp('fade');
    renderPanel();
    if (S.pendingAccess[id]) { delete S.pendingAccess[id]; setTimeout(() => toast(t('toast.access'), { icon: 'shield' }), 700); }
  }
  function applyChrome() {
    const root = document.documentElement;
    root.dataset.theme = S.theme;
    root.lang = S.lang;
    root.classList.toggle('reduce-motion', !!S.reduce);
    const meta = $('meta[name="theme-color"]#tc');
    if (meta) meta.setAttribute('content', S.theme === 'dark' ? '#0F0F12' : '#F3F3F0');
    document.title = t('doc.title');
    const foot = $('.demo-foot');
    if (foot) foot.innerHTML = T('foot.demo') + ' <a href="https://github.com/orestislef/custock" target="_blank" rel="noopener">GitHub</a> · <a href="https://github.com/orestislef/custock/tree/main/thinking" target="_blank" rel="noopener">' + T('foot.thinking') + '</a>';
    const pill = $('#demo-pill');
    if (pill) { pill.lastChild.textContent = t('panel.pill'); pill.setAttribute('aria-label', t('a11y.panel')); }
    const panel = $('#panel');
    if (panel) panel.setAttribute('aria-label', t('a11y.panel'));
  }

  /* ---------------- control panel ---------------- */
  const PERSONAS = ['eleni', 'nikos', 'maria', 'dimitris', 'sofia', 'anna'];
  function personaSub(id) {
    if (id === 'anna') return t('persona.anna');
    const m = memberById(id);
    return assignLabel(m.assign[0]);
  }
  const HIDE = {
    home: [['reports.financial.view', 'hid.money'], ['posts.publish', 'hid.approve'], ['products.create', 'hid.unknown']],
    stock: [['stock.sell', 'hid.swipe.sell'], ['stock.receive', 'hid.swipe.recv']],
    product: [['products.cost.view', 'hid.cost'], ['products.price.edit', 'hid.price'], ['stock.history.view', 'hid.history'], ['stock.sell', 'hid.sell'], ['stock.receive', 'hid.recv']],
    scan: [['stock.receive', 'hid.mode.recv'], ['stock.sell', 'hid.mode.sell'], ['products.create', 'hid.create']],
    customers: [['customers.contact.view', 'hid.contact'], ['customers.export', 'hid.export']],
    customer: [['customers.contact.view', 'hid.contact'], ['customers.edit', 'hid.edit']],
    posts: [['posts.create', 'hid.compose'], ['posts.publish', 'hid.publish']],
    post: [['posts.publish', 'hid.publish']],
    compose: [['posts.publish', 'hid.publish'], ['posts.channel.push', 'hid.push'], ['posts.channel.email', 'hid.email']]
  };
  function renderNarration() {
    const box = $('#narr'); if (!box) return;
    const r = cur(); if (!r) return;
    const name = r.name;
    const shop = isCust() ? null : actionShop();
    const hid = (HIDE[name] || []).filter((x) => !can(x[0], shop));
    let extra = '';
    if (isCust() && (name === 'c-product' || name === 'c-catalog')) { const s = Dt().org.settings; extra = '<li>' + ic('sliders') + '<span>' + T('nar.cust.settings', { catalog: t('set.cat.' + s.catalog), stock: t('set.stock.' + s.stock), prices: s.prices ? t('on') : t('off') }) + '</span></li>'; }
    box.innerHTML = '<h3>' + T('nar.' + name + '.t') + '</h3><p>' + T('nar.' + name + '.b') + '</p>' +
      ((hid.length || extra) ? '<ul>' + hid.map((x) => '<li>' + ic('lock') + '<span>' + T(x[1]) + ' <code>' + esc(x[0]) + '</code></span></li>').join('') + extra + '</ul>' : '');
  }
  function renderPanel() {
    const p = $('#panel'); if (!p) return;
    const s = Dt().org.settings;
    const gly = shopById('gly');
    const pv = S.previews;
    p.innerHTML = '<button class="panel-close" data-act="panel-close" aria-label="' + T('a11y.close') + '">' + ic('x') + '</button>' +
      '<div class="p-brand"><img class="mark" src="' + APP_ICON + '" alt=""><div><h1>' + T('panel.title') + '</h1><p>' + T('panel.sub') + '</p></div></div>' +
      '<div class="p-sec"><h2>' + T('panel.screen') + '</h2><div class="p-box narr" id="narr"></div></div>' +
      '<div class="p-sec"><h2>' + T('panel.viewas') + '</h2><div class="p-box roles">' + PERSONAS.map((id) => '<button class="role-opt" data-act="role" data-id="' + id + '" aria-pressed="' + (S.role === id) + '">' + avatar(personName(id)) + '<span class="grow"><span class="r-name" style="display:block">' + esc(personName(id)) + '</span><span class="r-sub" style="display:block">' + esc(personaSub(id)) + '</span></span></button>').join('') + '</div></div>' +
      (pv.length ? '<div class="p-sec"><h2>' + T('panel.phones') + '</h2><div class="p-box">' + Object.keys(pv.reduce((m, x) => { m[x.persona] = 1; return m; }, {})).map((who) => {
        const items = pv.filter((x) => x.persona === who);
        return '<div class="phone-prev"><div class="pp-h"><span>' + T('panel.phone.of', { name: firstName(who) }) + '</span><button class="btn small tinted" data-act="role-open" data-id="' + who + '">' + T('panel.switch', { name: firstName(who) }) + '</button></div>' +
          items.slice(0, 3).map((x) => { const n = nText(x.n); return '<div class="pp-item"><b>' + esc(n.merchant) + '</b><span class="muted">' + esc(n.title) + '. ' + esc(n.body) + '</span></div>'; }).join('') + '</div>';
      }).join('') + '</div></div>' : '') +
      '<div class="p-sec"><h2>' + T('panel.look') + '</h2><div class="p-box">' +
      '<div class="p-stack"><span class="p-l">' + T('panel.lang') + '</span>' + seg('lang', [['en', 'English'], ['el', 'Ελληνικά'], ['ru', 'Русский']], S.lang) + '</div>' +
      '<div class="p-stack"><span class="p-l">' + T('panel.appearance') + '</span>' + seg('theme', [['light', t('panel.light')], ['dark', t('panel.dark')]], S.theme) + '</div>' +
      '<div class="p-row"><span class="p-l">' + T('panel.motion') + '</span>' + sw('p-reduce', S.reduce, false, t('panel.motion')) + '</div>' +
      '<div class="p-row"><span class="p-l">' + T('panel.sound') + '</span>' + sw('p-sound', S.sound, false, t('panel.sound')) + '</div></div></div>' +
      '<div class="p-sec"><h2>' + T('panel.custpage') + '</h2><div class="p-box">' +
      '<div class="p-stack"><span class="p-l">' + T('set.catalog') + '</span>' + seg('s-cat', [['off', t('set.cat.off')], ['subscribers', t('set.cat.subscribers')], ['public', t('set.cat.public')]], s.catalog) + '</div>' +
      '<div class="p-row"><span class="p-l">' + T('set.prices') + '</span>' + sw('s-prices', s.prices, false, t('set.prices')) + '</div>' +
      '<div class="p-stack"><span class="p-l">' + T('set.stock') + '</span>' + seg('s-stock', [['off', t('set.stock.off')], ['availability', t('set.stock.availability')], ['exact', t('set.stock.exact')]], s.stock) + '</div>' +
      '<div class="p-stack"><span class="p-l">' + T('set.override', { shop: sname('gly') }) + '</span>' + seg('s-gly', [['', t('set.same')], ['off', t('set.stock.off')], ['availability', t('set.stock.availability')], ['exact', t('set.stock.exact')]], gly.customerStock || '') + '</div>' +
      '</div><p class="section-f" style="margin:6px 6px 0">' + T('panel.custpage.note') + '</p></div>' +
      '<div class="p-sec"><h2>' + T('panel.push') + '</h2><div class="p-box"><div class="preset-list">' +
      '<button class="preset" data-act="preset" data-id="post">' + ic('megaphone') + T('preset.post') + '</button>' +
      '<button class="preset" data-act="preset" data-id="back">' + ic('bell') + T('preset.back') + '</button>' +
      '<button class="preset" data-act="preset" data-id="low">' + ic('few') + T('preset.low') + '</button>' +
      '</div></div><p class="section-f" style="margin:6px 6px 0">' + T('panel.push.note') + '</p></div>' +
      '<div class="p-sec"><div class="p-actions"><button class="btn gray" data-act="reset">' + ic('undo') + T('panel.reset') + '</button></div></div>' +
      '<p class="p-links">' + T('panel.foot') + ' <a href="https://github.com/orestislef/custock" target="_blank" rel="noopener">GitHub</a> · <a href="https://github.com/orestislef/custock/tree/main/thinking" target="_blank" rel="noopener">' + T('panel.thinking') + '</a></p>';
    renderNarration();
  }
  function pulsePanel() {
    const pill = $('#demo-pill');
    if (pill) { pill.dataset.badge = '1'; pill.classList.remove('ping'); void pill.offsetWidth; pill.classList.add('ping'); }
  }
  ACT.role = (el) => { setRole(el.dataset.id); };
  ACT['role-open'] = (el) => {
    const who = el.dataset.id;
    const last = S.previews.find((x) => x.persona === who);
    setRole(who);
    closePanel();
    if (last && last.n.route) setTimeout(() => openRoute(last.n.route), 250);
  };
  SEG.lang = (v) => { S.lang = v; save(); applyChrome(); renderPanel(); refresh(); renderTabs(); };
  SEG.theme = (v) => { S.theme = v; save(); applyChrome(); };
  CH['p-reduce'] = (el) => { S.reduce = el.checked; save(); applyChrome(); };
  CH['p-sound'] = (el) => { S.sound = el.checked; save(); };
  SEG['s-cat'] = (v) => { Dt().org.settings.catalog = v; refresh(); renderNarration(); };
  CH['s-prices'] = (el) => { Dt().org.settings.prices = el.checked; refresh(); renderNarration(); };
  SEG['s-stock'] = (v) => { Dt().org.settings.stock = v; refresh(); renderNarration(); };
  SEG['s-gly'] = (v) => { shopById('gly').customerStock = v || null; refresh(); };
  ACT.preset = (el) => {
    const id = el.dataset.id;
    if (id === 'post') { const p = Dt().posts[0]; deliver('anna', { org: 'lemoni', merchant: { en: 'Lemoni Kifisia', el: 'Lemoni Κηφισιά', ru: 'Lemoni Кифисия' }, title: p.title, body: p.body, img: p.img, route: { role: 'anna', tab: 'c-home', name: 'c-post', params: { id: p.id } } }, 400); }
    if (id === 'back') deliver('anna', { org: 'lemoni', merchant: { en: 'Lemoni Kifisia', el: 'Lemoni Κηφισιά', ru: 'Lemoni Кифисия' }, tk: 'push.back.title', bk: 'push.back.body', v: { vid: 'mountain-tea', shop: 'kif' }, img: 'p-mountain-tea', route: { role: 'anna', tab: 'c-catalog', name: 'c-product', params: { pid: 'mountain-tea' } } }, 400);
    if (id === 'low') deliver('maria', { org: 'lemoni', merchant: { en: 'Lemoni Kifisia', el: 'Lemoni Κηφισιά', ru: 'Lemoni Кифисия' }, tk: 'push.low.title', bk: 'push.low.body', v: { vid: 'thyme-honey', shop: 'kif', n: 4, rp: 5 }, img: 'p-thyme-honey', route: { role: 'maria', tab: 'stock', name: 'product', params: { pid: 'thyme-honey' } } }, 400);
    if (window.matchMedia('(max-width: 1060px)').matches) closePanel();
  };
  ACT.reset = () => {
    S.data = window.CSData.makeData(); S.tips = {}; S.previews = []; S.shop = {}; S.ui = {}; S.compose = null; save();
    Object.keys(TPREV).forEach((k) => delete TPREV[k]);
    S.stacks = {}; S.tab = firstTab(); closeSheet(true); renderPanel(); renderApp('fade'); toast(t('toast.reset'), { icon: 'undo' });
  };
  ACT['sheet-close'] = () => closeSheet();
  function openPanel() { $('#panel').classList.add('open'); $('#panel-scrim').classList.add('show'); const pill = $('#demo-pill'); if (pill) delete pill.dataset.badge; }
  function closePanel() { $('#panel').classList.remove('open'); $('#panel-scrim').classList.remove('show'); }
  ACT['panel-open'] = openPanel;
  ACT['panel-close'] = closePanel;

  /* ---------------- events ---------------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('input', (e) => { const el = e.target.closest('[data-in]'); if (el && IN[el.dataset.in]) IN[el.dataset.in](el, e); });
  document.addEventListener('change', (e) => { const el = e.target.closest('[data-ch]'); if (el && CH[el.dataset.ch]) CH[el.dataset.ch](el, e); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (SHEET) closeSheet(); else if ($('#panel.open')) closePanel(); }
  });
  if (mqDark && mqDark.addEventListener) mqDark.addEventListener('change', (e) => { if (!loadPrefs().theme) { S.theme = e.matches ? 'dark' : 'light'; applyChrome(); } });

  /* ---------------- clock in the fake status bar ---------------- */
  function clock() { const el = $('#sb-time'); if (el) el.textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(Date.now()); }

  /* ---------------- boot ---------------- */
  function boot() {
    if (PERSONAS.indexOf(S.role) < 0) S.role = 'eleni';
    S.tab = firstTab();
    applyChrome();
    renderPanel();
    renderApp('none');
    clock(); setInterval(clock, 20000);
    $('#panel-scrim').addEventListener('click', closePanel);
  }
  window.CSApp = { S: S, t: t, can: can };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
