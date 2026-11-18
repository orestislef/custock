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
    // automatic follows the system, light and dark are a choice in the panel. older saved themes
    // count as automatic, so everyone starts on the system setting
    appearance: prefs.appearance === 'light' || prefs.appearance === 'dark' ? prefs.appearance : 'auto',
    theme: 'light',
    reduce: prefs.reduce != null ? prefs.reduce : !!(mqReduce && mqReduce.matches),
    sound: prefs.sound != null ? prefs.sound : true,
    role: prefs.role || 'eleni',
    tips: prefs.tips || {},
    data: window.CSData.makeData(),
    shop: {}, tab: null, stacks: {}, previews: [], ui: {}, compose: null, pendingAccess: {}
  };
  function systemTheme() { return mqDark && mqDark.matches ? 'dark' : 'light'; }
  S.theme = S.appearance === 'auto' ? systemTheme() : S.appearance;
  function save() { try { localStorage.setItem(PREF, JSON.stringify({ lang: S.lang, appearance: S.appearance, reduce: S.reduce, sound: S.sound, role: S.role, tips: S.tips })); } catch (e) { /* private mode */ } }

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

  /* the desktop phone frame keeps its real size and scales as one piece */
  let SCALE = 1;
  const scale = () => SCALE;
  function fitDevice() {
    const dev = document.querySelector('.device');
    if (!dev) return;
    if (window.innerWidth <= 600) { SCALE = 1; dev.style.transform = ''; dev.style.marginBottom = ''; return; }
    SCALE = Math.max(0.62, Math.min(1, (window.innerHeight - 74) / 852));
    dev.style.transform = SCALE < 1 ? 'scale(' + SCALE + ')' : '';
    dev.style.marginBottom = SCALE < 1 ? (852 * SCALE - 852) + 'px' : '';
  }
  window.addEventListener('resize', fitDevice);
  function cover() { const r = S.tab && S.stacks[S.tab] ? cur() : null; document.body.classList.toggle('covered', !!(SHEET || TOAST || document.getElementById('lock') || (r && r.modal))); }

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
    'user-f': '<circle class="f" cx="12" cy="7.8" r="4.4"/><path class="f" d="M3.4 20.3C4.3 15.8 7.7 13.6 12 13.6s7.7 2.2 8.6 6.7a.8.8 0 0 1-.8 1H4.2a.8.8 0 0 1-.8-1Z"/>',
    'scan-f': '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 8.5v7M11 8.5v7M13.5 8.5v7M16 8.5v7"/>',
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
    few: '<circle cx="12" cy="12" r="8.5"/><path class="f" d="M12 3.5a8.5 8.5 0 0 0 0 17Z"/>',
    more: '<circle cx="12" cy="12" r="8.5"/><circle class="f" cx="8" cy="12" r="1.25"/><circle class="f" cx="12" cy="12" r="1.25"/><circle class="f" cx="16" cy="12" r="1.25"/>',
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
  function avatar(name, cls) { return '<span class="avatar ' + (cls || '') + '" style="background:var(--tile-' + (2 + hash(name) % 5) + ')" aria-hidden="true">' + esc(initials(name)) + '</span>'; }
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
        s.style.transitionDelay = ((strips.length - 1 - j) * 25 + Math.min(i, 4) * 15) + 'ms';
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
    { id: 'c-catalog', icon: 'grid', label: 'tab.catalog' },
    { id: 'c-shops', icon: 'store', label: 'tab.shops' },
    { id: 'c-profile', icon: 'user', label: 'tab.profile' }
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
      const pt = prev.title && prev.title.length <= 9 ? prev.title : '';
      left = '<button class="navbtn back" data-act="back" aria-label="' + T('nav.back') + (pt ? ', ' + esc(pt) : '') + '">' + ic('chev-left') + (pt ? '<span>' + esc(pt) + '</span>' : '') + '</button>';
    }
    const el = document.createElement('section');
    el.className = 'screen ' + (spec.cls || '');
    el.dataset.route = route.name;
    el.innerHTML = '<div class="body">' + (large ? '<h1 class="ltitle t-large">' + esc(spec.title) + '</h1>' : '') + spec.body + '</div>' +
      '<header class="nav' + (spec.solid ? ' solid' : '') + (large || spec.anchor ? '' : ' always') + (spec.navCls ? ' ' + spec.navCls : '') + '"><div class="nav-left">' + left + '</div><div class="nav-title">' + esc(spec.navTitle || spec.title || '') + '</div><div class="nav-right">' + (spec.right || '') + '</div></header>';
    el._spec = spec;
    el._large = large;
    return el;
  }
  function afterRender(el, route) {
    const body = $('.body', el), nav = $('.nav', el);
    let lim = el._large ? 38 : 4;
    if (el._spec.anchor) { const a = $(el._spec.anchor, el); if (a) lim = Math.max(4, a.offsetTop + a.offsetHeight - nav.offsetHeight); }
    const onScroll = () => { nav.classList.toggle('scrolled', body.scrollTop > lim); };
    body.addEventListener('scroll', onScroll, { passive: true });
    if (route.scroll) body.scrollTop = route.scroll;
    onScroll();
    const bl = $('.navbtn.back span', el);
    if (bl && bl.scrollWidth > bl.clientWidth + 1) bl.remove();
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
    if (kind === 'push' && route.modal) kind = 'modal-in';
    if (kind === 'pop' && old && old._route && old._route.modal) kind = 'modal-out';
    if ((kind === 'pop' || kind === 'modal-out') && old) host.insertBefore(el, old); else host.appendChild(el);
    afterRender(el, route);
    renderTabs();
    if (old) swap(old, el, kind);
    renderNarration();
    cover();
  }
  function swap(old, el, kind) {
    if (kind === 'tab' || kind === 'none' || !kind) { old.remove(); return; }
    const dur = 380, ease = 'cubic-bezier(0.32, 0.72, 0, 1)';
    if (S.reduce || kind === 'fade') {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out' }).finished.then(() => old.remove()).catch(() => old.remove());
      return;
    }
    if (kind === 'modal-in') {
      el.style.boxShadow = '0 -8px 30px rgba(0,0,0,.14)';
      el.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 440, easing: ease }).finished.then(() => { old.remove(); el.style.boxShadow = ''; }).catch(() => old.remove());
      return;
    }
    if (kind === 'modal-out') {
      old.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { duration: 380, easing: ease, fill: 'forwards' }).finished.then(() => old.remove()).catch(() => old.remove());
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

  function recvCount() { return S.ui && S.ui.scanMode === 'receive' ? (S.ui.recvList || []).reduce((a, x) => a + x.n, 0) : 0; }
  function renderTabs() {
    const bar = $('#bottom-bar');
    const list = tabs();
    const acc = isCust() ? { id: 'c-qr', icon: 'qr', label: 'tab.qr' } : hasScan() ? { id: 'scan', icon: 'scan', label: 'tab.scan' } : null;
    bar.innerHTML = '<nav class="tabbar" aria-label="' + T('a11y.tabs') + '">' + list.map((x) => {
      const on = S.tab === x.id;
      const badgeN = x.id === 'c-home' ? Dt().alerts.filter((a) => a.cid === 'c-anna' && a.status === 'notified' && !a.seen).length : 0;
      return '<button class="tab" data-act="tab" data-id="' + x.id + '"' + (on ? ' aria-current="page"' : '') + '>' + ic(on ? x.icon + '-f' : x.icon) +
        '<span class="tl">' + T(x.label) + '</span>' + (badgeN ? '<span class="tbadge">' + badgeN + '</span>' : '') + '</button>';
    }).join('') + '</nav>' + (acc ? '<button class="accessory" data-act="tab" data-id="' + acc.id + '" aria-label="' + T(acc.label) + '"' + (S.tab === acc.id ? ' aria-current="page"' : '') + '>' + ic(acc.icon) + (acc.id === 'scan' && recvCount() ? '<span class="abadge" aria-label="' + T('a11y.scanned', { n: recvCount() }) + '">' + tally('acc-recv', recvCount()) + '</span>' : '') + '</button>' : '');
    bar.hidden = !!(cur() && cur().modal);
    syncTallies(bar);
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
    cover();
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
    const fin = () => { s.el.remove(); s.scrim.remove(); cover(); if (s.o.onClose) s.o.onClose(); };
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
        const dy = (ev.clientY - y0) / scale();
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
    cover();
  }
  function hideToast() { if (!TOAST) return; const x = TOAST; TOAST = null; cover(); clearTimeout(x.tm); x.el.classList.remove('show'); setTimeout(() => x.el.remove(), 300); }
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
      const mv = (ev) => { const dy = Math.min(0, (ev.clientY - y0) / scale()); if (Math.abs(dy) > 6) dragged = true; el.style.transition = 'none'; el.style.transform = 'translateY(' + dy + 'px)'; };
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
      options.map((o) => '<button data-act="seg" data-name="' + name + '" data-val="' + esc(o[0]) + '" aria-pressed="' + (o[0] === value) + '"><span class="seg-l">' + esc(o[1]) + (o[2] || '') + '</span></button>').join('') + '</div>';
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
    if (me().status !== 'active') return { title: t('home.title'), body: '<div class="empty"><span class="e-icon">' + ic('lock') + '</span><h3>' + T('paused.t') + '</h3><p>' + T('paused.b', { name: 'Eleni' }) + '</p></div>' };
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
    pend.forEach((p) => { att += cell({ act: 'open-post', data: { id: p.id }, lead: tileI('megaphone', 5), title: T('home.approve', { name: firstName(p.author) }), sub: esc(L(p.title)) }); });
    if (neg.length) att += cell({ act: 'stock-filter', data: { f: 'neg' }, lead: tileI('neg', 5), title: T('home.neg', { n: neg.length }), sub: T('home.neg.sub') });
    unk.forEach((u) => { att += cell({ act: 'unknown-code', data: { code: u.code }, lead: tileI('scan', 4), title: T('home.unknown', { n: u.times }), sub: T('home.unknown.sub', { name: firstName(u.by), code: u.code }) }); });
    Dt().transfers.filter((x) => x.status === 'sent' && shops.indexOf(x.to) >= 0 && can('stock.transfer.receive', x.to)).forEach((x) => { att += cell({ act: 'open-transfer', data: { id: x.id }, lead: tileI('truck', 2), title: T('home.tr', { n: x.lines.reduce((a, l) => a + l.sent, 0), from: sname(x.from) }), sub: T('home.tr.sub') }); });
    Dt().counts.filter((c) => c.status === 'review' && shops.indexOf(c.shop) >= 0 && can('stock.count.approve', c.shop)).forEach((c) => { att += cell({ act: 'open-count', data: { id: c.id }, lead: tileI('count', 4), title: T('home.cnt', { shop: sname(c.shop) }), sub: T('home.cnt.sub', { name: firstName(c.submittedBy || c.by) }) }); });
    let manage = '';
    if (can('reports.view')) manage += cell({ act: 'go', data: { r: 'reports' }, lead: tileI('chart', 6), title: T('rep.title') });
    if (can('stock.count')) manage += cell({ act: 'go', data: { r: 'counts' }, lead: tileI('count', 2), title: T('cnt.title') });
    if (can('members.view')) manage += cell({ act: 'go', data: { r: 'team' }, lead: tileI('people', 3), title: T('team.title') });
    if (canOrgWide('roles.manage')) manage += cell({ act: 'go', data: { r: 'roles' }, lead: tileI('shield', 5), title: T('roles.title') });
    const staffQuick = !can('stock.adjust') && (can('stock.sell') || can('stock.receive'));
    const row = (n, act, data, icon, title, sub) => (n ? cell({ act: act, data: data, lead: tileI(icon, 5), title: T(title), sub: T(sub), val: '<span class="c-tally">' + tally('home-' + title + '-' + S.role, n) + '</span>' }) : '');
    const glance = row(low, 'stock-filter', { f: 'low' }, 'few', 'kpi.low', 'kpi.low.note') +
      (can('customers.view') ? row(fresh, 'tab', { id: 'customers' }, 'people', 'kpi.new', 'kpi.new.note') : '') +
      (can('posts.view') ? row(posts, 'tab', { id: 'posts' }, 'calendar', 'kpi.posts', 'kpi.posts.note') : '');
    return {
      title: t('home.title'),
      right: '<button class="navbtn avatar-btn" data-act="account" aria-label="' + T('a11y.account') + '">' + avatar(personName(S.role), 'md') + '</button>',
      body: shopChips() + tip('home', 'tip.home.t', 'tip.home.b') +
        (waiting ? '<button class="hero-line" data-act="stock-filter" data-f="wanted"><span class="hl-n">' + tally('home-wait-' + S.role, waiting) + '</span><span class="grow"><span class="hl-t">' + T('home.hero', { n: waiting }) + '</span><span class="hl-s">' + T('home.hero.sub') + '</span></span>' + ic('chev-right', 'chev') + '</button>' : '') +
        (glance ? '<div class="list with-tiles">' + glance + '</div>' : '') +
        (staffQuick ? '<div class="section-h">' + T('home.quick') + '</div><div class="btn-row">' +
          (can('stock.count', actionShop()) ? '<button class="btn tinted" data-act="go" data-r="counts">' + ic('count') + T('mode.count') + '</button>' : '') +
          (can('stock.sell', actionShop()) ? '<button class="btn tinted" data-act="scan-mode" data-mode="sell">' + ic('bag') + T('mode.sell') + '</button>' : '') +
          (can('stock.receive', actionShop()) ? '<button class="btn tinted" data-act="scan-mode" data-mode="receive">' + ic('receive') + T('mode.receive') + '</button>' : '') + '</div>' : '') +
        (att ? '<div class="section-h">' + T('home.attention') + '</div><div class="list with-tiles">' + att + '</div>' : '') +
        '<div class="section-h">' + T('home.today') + '</div><div class="list with-tiles">' +
        cell({ lead: tileI('bag', 3), title: T('home.sold', { n: soldQty }), val: can('reports.financial.view') ? esc(money(soldVal)) : null, sub: can('reports.financial.view') ? '' : T('home.sold.nomoney') }) +
        cell({ lead: tileI('people', 2), title: T('home.visible', { n: custs.length }), sub: canOrgWide('customers.view') ? T('home.visible.all') : T('home.visible.some') }) +
        '</div>' + (manage ? '<div class="section-h">' + T('home.manage') + '</div><div class="list with-tiles">' + manage + '</div>' : '') + '<p class="section-f free">' + T('home.foot') + '</p>'
    };
  };
  ACT.go = (el) => go(el.dataset.r);
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
      '<div class="list with-tiles mt16">' + (can('members.view') ? cell({ act: 'acc-go', data: { r: 'team' }, lead: tileI('people', 3), title: T('team.title') }) : '') +
      (canOrgWide('roles.manage') ? cell({ act: 'acc-go', data: { r: 'roles' }, lead: tileI('shield', 5), title: T('roles.title') }) : '') +
      (can('reports.view') ? cell({ act: 'acc-go', data: { r: 'reports' }, lead: tileI('chart', 6), title: T('rep.title') }) : '') +
      cell({ act: 'lock-show', lead: tileI('phone', 5), title: T('lock.title') }) + '</div>' +
      '<div class="section-h">' + T('account.can') + '</div><div class="list">' + window.CSData.PERM_GROUPS.map((g) => {
        const have = g[1].filter((p) => mine.indexOf(p) >= 0).length;
        return cell({ title: T('pg.' + g[0]), val: have + ' / ' + g[1].length });
      }).join('') + '</div><p class="section-f">' + T('account.foot') + '</p>' });
  };

  ACT['acc-go'] = (el) => { closeSheet(true); go(el.dataset.r); };

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
    if (!list.length) return '<div class="empty"><span class="e-icon">' + ic('search') + '</span><h3>' + T('stock.empty.t') + '</h3><p>' + T('stock.empty.b') + '</p><button class="btn tinted" data-act="stock-reset">' + T('stock.showall') + '</button></div>';
    const single = shops.length === 1;
    return '<div class="list with-thumbs">' + list.map((p) => {
      const total = p.variants.reduce((s, v) => s + qtyIn(v.id, shops), 0);
      const st = pState(p, shops);
      const w = p.variants.reduce((s, v) => s + waitingFor(v.id, shops).length, 0);
      const sub = (p.variants.length > 1 ? T('stock.variants', { n: p.variants.length }) : esc(L(Dt().categories.find((c) => c.id === p.cat).name))) + (w ? ' · ' + T('stock.waiting', { n: w }) : '');
      const rowInner = cell({ act: 'open-product', data: { pid: p.id }, lead: img(p.img, pname(p), 'thumb', ''), title: esc(pname(p)), sub: sub + (st !== 'ok' ? '<span style="display:block;margin-top:4px">' + badge(st) + '</span>' : ''), val: '<span class="qty' + (total < 0 ? ' neg' : '') + '">' + tally('q-' + p.id + '-' + shops.join(''), total) + '</span>', chev: false });
      const sellAt = shops.filter((x) => can('stock.sell', x)), recvAt = shops.filter((x) => can('stock.receive', x));
      const swipeOk = p.variants.length === 1 && (sellAt.length || recvAt.length);
      if (!swipeOk) return rowInner;
      return '<div class="swipe"><div class="sw-actions">' + (recvAt.length ? '<button class="sw-a1" data-act="quick" data-k="receive" data-vid="' + p.variants[0].id + '">' + ic('plus') + T('swipe.plus1') + '</button>' : '') +
        (sellAt.length ? '<button class="sw-a2" data-act="quick" data-k="sale" data-vid="' + p.variants[0].id + '">' + ic('bag') + T('swipe.sell1') + '</button>' : '') + '</div>' + rowInner + '</div>';
    }).join('') + '</div>';
  }
  PARTS['stock-list'] = stockRows;
  SCREENS.stock = () => {
    const f = S.ui.stockFilter || 'all';
    const fs = [['all', t('f.all')], ['low', t('f.low')], ['out', t('f.out')], ['neg', t('f.neg')], ['wanted', t('f.wanted')]];
    const hasMore = can('stock.count', actionShop()) || scopesWith('stock.transfer.send').some((x) => x.scope === 'shop');
    const navR = hasMore ? '<button class="navbtn" data-act="stock-more" aria-label="' + T('a11y.moreactions') + '">' + ic('more') + '</button>' : '';
    return {
      title: t('stock.title'), right: navR,
      body: shopChips() +
        '<label class="search">' + ic('search') + '<input type="search" inputmode="search" enterkeyhint="search" placeholder="' + T('stock.search') + '" value="' + esc(S.ui.stockQ || '') + '" data-in="stock-q" aria-label="' + T('stock.search') + '"></label>' +
        '<div class="chips" style="margin-bottom:12px">' + fs.map((x) => '<button class="chip" data-act="stock-f" data-f="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + esc(x[1]) + '</button>').join('') + '</div>' +
        tip('stock', 'tip.stock.t', 'tip.stock.b') +
        '<div data-part="stock-list">' + stockRows() + '</div>' +
        '<p class="section-f">' + T('stock.swipe.hint') + '</p>'
    };
  };
  ACT['stock-more'] = () => {
    openSheet({ title: t('stock.more'), render: () => '<div class="list with-tiles">' +
      (can('stock.count', actionShop()) ? cell({ act: 'stock-more-go', data: { r: 'counts' }, lead: tileI('count', 2), title: T('cnt.title'), sub: T('stock.more.count') }) : '') +
      (scopesWith('stock.transfer.send').some((x) => x.scope === 'shop') ? cell({ act: 'stock-more-go', data: { r: 'transfer' }, lead: tileI('truck', 3), title: T('tr.new'), sub: T('stock.more.tr') }) : '') + '</div>' });
  };
  ACT['stock-more-go'] = (el) => { closeSheet(true); if (el.dataset.r === 'transfer') ACT['transfer-new'](); else go('counts'); };
  ACT['stock-reset'] = () => { S.ui.stockQ = ''; S.ui.stockFilter = 'all'; refresh(); };
  IN['stock-q'] = (el) => { S.ui.stockQ = el.value; refreshPart('stock-list'); };
  ACT['stock-f'] = (el) => { S.ui.stockFilter = el.dataset.f; $$('[data-act="stock-f"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el))); refreshPart('stock-list'); };
  ACT['open-product'] = (el) => { if (swipedRecently(el)) return; go('product', { pid: el.dataset.pid }); };
  ACT.quick = (el) => {
    const k = el.dataset.k, vid = el.dataset.vid;
    const at = ctxShops().filter((x) => can(k === 'sale' ? 'stock.sell' : 'stock.receive', x));
    closeSwipes();
    if (at.length > 1) {
      openSheet({ title: t(k === 'sale' ? 'quick.where.sell' : 'quick.where.recv'), render: () => '<div class="list">' + at.map((x) => cell({ act: 'quick-at', data: { vid: vid, k: k, shop: x }, title: esc(sname(x)), val: T('scan.instock', { n: qty(vid, x) }), chev: false })).join('') + '</div>' });
      return;
    }
    quickAt(vid, k, at[0]);
  };
  ACT['quick-at'] = (el) => { closeSheet(true); quickAt(el.dataset.vid, el.dataset.k, el.dataset.shop); };
  function quickAt(vid, k, shop) {
    const res = applyMove({ vid: vid, shop: shop, delta: k === 'sale' ? -1 : 1, kind: k, price: variant(vid).price });
    tick();
    refreshPart('stock-list');
    afterMoveToast(res, k, 1);
  }
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
      const otw = inTransit(v.id, sh);
      return cell({ title: esc(sname(sh)), sub: (rp != null ? T('pd.rp', { n: rp }) : '') + (st !== 'ok' ? ' ' + badge(st) : '') + (otw ? ' <span class="badge info">' + ic('truck', 'xs') + T('pd.otw', { n: otw }) + '</span>' : ''), val: '<span class="bigqty' + (q < 0 ? ' qty neg' : '') + '">' + tally('pq-' + v.id + '-' + sh, q) + '</span>' });
    }).join('');
    const hist = can('stock.history.view', ash) ? Dt().ledger.filter((m) => m.vid === v.id && ctxS.indexOf(m.shop) >= 0).slice(0, 8) : null;
    const KI = { sale: 'bag', receive: 'receive', return: 'undo', adjust: 'plusminus', damage: 'alert', reversal: 'undo', count: 'count', transfer_in: 'truck', transfer_out: 'truck' };
    const acts = [];
    if (can('stock.sell', ash)) acts.push('<button class="btn tinted" data-act="pd-sell" data-vid="' + v.id + '">' + ic('bag') + T('pd.sell1') + '</button>');
    if (can('stock.receive', ash)) acts.push('<button class="btn tinted" data-act="pd-receive" data-vid="' + v.id + '">' + ic('receive') + T('pd.receive') + '</button>');
    return {
      title: pname(p), large: false, anchor: '.pd-name',
      body: img(p.img, pname(p), 'hero-img wide', '') +
        '<div class="pd-head"><div class="muted t-foot">' + esc(catName) + ' · ' + T('pd.vat', { n: p.vat }) + '</div><h1 class="pd-name">' + esc(pname(p)) + '</h1>' + price + '</div>' +
        (p.variants.length > 1 ? '<div class="chips" style="margin-bottom:10px">' + p.variants.map((x, i) => '<button class="chip" data-act="variant" data-pid="' + p.id + '" data-i="' + i + '" aria-pressed="' + (i === vi) + '">' + esc(L(x.opt)) + '</button>').join('') + '</div>' : '') +
        '<div class="list">' + stockRowsH + '</div>' +
        (hidden ? '<p class="section-f">' + T('pd.hidden.shops', { n: hidden }) + '</p>' : '') +
        (w.length ? '<div class="row-flex" style="margin:16px 0 0"><span class="waiting">' + ic('bell', 'sm') + T('pd.waiting', { n: w.length }) + '</span></div><p class="section-f free">' + T('pd.waiting.why') + '</p>' : '') +
        (acts.length ? '<div class="btn-row mt16">' + acts.join('') + '</div>' + (ctx() === 'all' ? '<p class="section-f free">' + T('pd.actshop', { shop: sname(ash) }) + '</p>' : '') : '') +
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
    else if (el.dataset.id.indexOf('cl:') === 0) { const p = el.dataset.id.split(':'); const c = Dt().counts.find((x) => x.id === p[1]); countLine(c, p[2], d); if (cur().name === 'count') refresh(); else refreshPart('scan-list'); }
    else if (el.dataset.id.indexOf('tr:') === 0) { const vid = el.dataset.id.slice(3); const v = S.ui.trn; v.lines[vid] = Math.max(0, Math.min(qty(vid, v.from), (v.lines[vid] || 0) + d)); sheetRefresh(); }
    else if (el.dataset.id.indexOf('trr:') === 0) { const p = el.dataset.id.split(':'); const tr = Dt().transfers.find((x) => x.id === p[1]); const l = tr.lines.find((x) => x.vid === p[2]); l.received = Math.max(0, Math.min(l.sent, l.received + d)); refresh(); }
    else if (el.dataset.id.indexOf('line:') === 0) { const vid = el.dataset.id.slice(5); const l = S.ui.recvList.find((x) => x.vid === vid); if (l) { l.n = Math.max(0, l.n + d); if (!l.n) S.ui.recvList = S.ui.recvList.filter((x) => x !== l); } refreshPart('scan-list'); renderTabs(); }
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
    openSheet({ title: t('moment.title'), render: () => '<div class="moment">' + img(p.img, pname(p), 'm-thumb', '') +
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
      const k = scale();
      d.style.left = ((pr.left - app.left + pr.width / 2) / k - 4) + 'px';
      d.style.top = ((pr.top - app.top + pr.height / 2) / k - 4) + 'px';
      $('#overlays').appendChild(d);
      const dx = (ar.left - pr.left + ar.width / 2 - pr.width / 2) / k, dy = (ar.top - pr.top + ar.height / 2 - pr.height / 2) / k;
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
    if (can('stock.count', sh)) m.push(['count', t('mode.count')]);
    return m;
  }
  function scanList() {
    const mode = S.ui.scanMode;
    if (mode === 'receive') {
      const l = S.ui.recvList || [];
      if (!l.length) return '<p class="section-f free">' + T('scan.recv.empty') + '</p>';
      const total = l.reduce((s, x) => s + x.n, 0);
      return '<div class="list with-thumbs scanlist">' + l.map((x) => cell({ cls: 'line-' + x.vid, lead: img(product(variant(x.vid).pid).img, vname(variant(x.vid)), 'thumb', ''), title: esc(vname(variant(x.vid))), sub: T('scan.instock', { n: qty(x.vid, S.ui.scanShop || actionShop()) }), val: stepper('line:' + x.vid, x.n), chev: false })).join('') + '</div>' +
        '<div class="sticky-cta"><button class="btn primary block" data-act="scan-recv">' + ic('receive') + T('scan.recv.confirm', { n: total }) + '</button></div>';
    }
    if (mode === 'sell') {
      const l = S.ui.sold || [];
      if (!l.length) return '<p class="section-f free">' + T('scan.sell.empty') + '</p>';
      return '<div class="list with-thumbs scanlist">' + l.slice(0, 6).map((x) => cell({ cls: 'line-' + x.vid, lead: img(product(variant(x.vid).pid).img, vname(variant(x.vid)), 'thumb', ''), title: esc(vname(variant(x.vid))), sub: T('scan.sold.n', { n: x.n }), val: '<span class="qty">' + tally('sq-' + x.vid + '-' + x.shop, qty(x.vid, x.shop)) + '</span>', chev: false })).join('') + '</div><p class="section-f">' + T('scan.sell.note') + '</p>';
    }
    if (mode === 'count') {
      const c = openCount(S.ui.scanShop || actionShop());
      if (!c) return '<p class="section-f free">' + T('scan.count.empty') + '</p>';
      const lines = Object.keys(c.lines);
      return (lines.length ? '<div class="list with-thumbs scanlist">' + lines.map((vid) => cell({ cls: 'line-' + vid, lead: img(product(variant(vid).pid).img, vname(variant(vid)), 'thumb', ''), title: esc(vname(variant(vid))), sub: T('cnt.counted'), val: stepper('cl:' + c.id + ':' + vid, c.lines[vid].counted), chev: false })).join('') + '</div>' : '<p class="section-f free">' + T('scan.count.go') + '</p>') +
        '<div class="mt16"><button class="btn tinted block" data-act="open-count" data-id="' + c.id + '">' + ic('count') + T('scan.count.open', { a: lines.length, b: countScope(c).length }) + '</button></div>';
    }
    return '<p class="section-f free">' + T('scan.lookup.note') + '</p>';
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
        '<span class="vf-pill static">' + T('scan.continuous') + '</span></div>' +
        '<div class="vf-frame"><span class="vf-c tl"></span><span class="vf-c tr"></span><span class="vf-c bl"></span><span class="vf-c br"></span><span class="vf-line"></span></div>' +
        '<div class="vf-hint">' + T('scan.hint') + '</div></div>' +
        '<div class="scan-pad">' + seg('scanmode', ms, S.ui.scanMode) + '<div class="mt12" data-part="scan-list">' + scanList() + '</div></div>' +
        '<div class="section-h">' + T('scan.shelf') + '</div>' +
        '<div class="shelf" role="list">' + items.map((v) => '<button class="shelf-item" role="listitem" data-act="scan-item" data-vid="' + v.id + '" aria-label="' + T('a11y.scanitem', { name: vname(v) }) + '">' + img(product(v.pid).img, vname(v), '', '') + '<div class="si-name">' + esc(vname(v)) + '</div></button>').join('') +
        '<button class="shelf-item" data-act="scan-unknown" aria-label="' + T('scan.unknown') + '"><div class="si-unknown">' + ic('scan') + '</div><div class="si-name">' + T('scan.unknown') + '</div></button></div>' +
        '<div class="scan-pad">' + tip('scan', 'tip.scan.t', 'tip.scan.b') + '</div>'
    };
  };
  SEG.scanmode = (v) => { S.ui.scanMode = v; refreshPart('scan-list'); renderTabs(); renderNarration(); };
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
    const k = scale();
    const app = $('#app').getBoundingClientRect(), a = im.getBoundingClientRect(), b = target.getBoundingClientRect();
    const f = document.createElement('img'); f.className = 'fly'; f.src = im.src; f.alt = '';
    f.style.left = (a.left - app.left) / k + 'px'; f.style.top = (a.top - app.top) / k + 'px'; f.style.width = a.width / k + 'px'; f.style.height = a.height / k + 'px';
    $('#overlays').appendChild(f);
    const dx = (b.left - a.left + (b.width - a.width) / 2) / k, dy = (b.top - a.top + (b.height - a.height) / 2) / k, sc = Math.max(0.3, b.width / a.width);
    f.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')', opacity: 0.9 }], { duration: 480, easing: 'cubic-bezier(.3,.7,.2,1)' })
      .finished.then(() => { f.remove(); const row = $('.line-' + vid); if (row) { row.classList.remove('pulse'); void row.offsetWidth; row.classList.add('pulse'); } }).catch(() => f.remove());
  }
  ACT['scan-item'] = (el) => {
    const vid = el.dataset.vid, mode = S.ui.scanMode, sh = S.ui.scanShop || actionShop();
    if (mode === 'lookup') { tick(); go('product', { pid: variant(vid).pid }); return; }
    if (mode === 'count') {
      let c = openCount(sh);
      if (!c) { c = startCount(sh, 'full'); toast(t('scan.count.started', { shop: sname(sh) }), { icon: 'count' }); }
      countLine(c, vid, 1);
      refreshPart('scan-list'); scanFx(el, vid); return;
    }
    if (mode === 'receive') {
      S.ui.recvList = S.ui.recvList || [];
      const l = S.ui.recvList.find((x) => x.vid === vid);
      if (l) l.n += 1; else S.ui.recvList.unshift({ vid: vid, n: 1 });
      refreshPart('scan-list'); renderTabs(); scanFx(el, vid); return;
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
    refreshPart('scan-list'); renderTabs();
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
      '<div class="input-cell"><label for="np-name">' + T('np.name') + '</label><input id="np-name" data-in="np-name" placeholder="' + T('np.name.ph') + '" autocomplete="off" autocapitalize="sentences" enterkeyhint="next" maxlength="200"></div>' +
      '<div class="input-cell"><label for="np-price">' + T('np.price') + '</label><input id="np-price" data-in="np-price" inputmode="decimal" autocomplete="off" enterkeyhint="done" maxlength="20" placeholder="0,00"></div>' +
      '<div class="input-cell"><label>' + T('np.code') + '</label><input value="' + esc(code) + '" readonly></div></div>' +
      '<p class="section-f">' + T('np.note') + '</p><div class="mt16"><button class="btn primary block" data-act="np-save" data-code="' + esc(code) + '">' + T('np.save') + '</button></div>',
      after: (sh) => { const i = $('#np-name', sh); if (i) setTimeout(() => i.focus(), 350); } });
  };
  // the error line under a field, gone again as soon as the field changes
  function fieldErr(el, key) {
    if (!el) return;
    el.setAttribute('aria-invalid', 'true');
    const host = el.closest('.input-cell') || el.parentElement;
    let m = host && host.nextElementSibling && host.nextElementSibling.classList.contains('field-msg') ? host.nextElementSibling : null;
    if (!m && host) { m = document.createElement('p'); m.className = 'field-msg'; m.setAttribute('role', 'alert'); host.insertAdjacentElement('afterend', m); }
    if (m) m.textContent = t(key);
    el.focus();
  }
  function fieldOk(el) {
    if (!el) return;
    el.removeAttribute('aria-invalid');
    const host = el.closest('.input-cell') || el.parentElement;
    const m = host && host.nextElementSibling;
    if (m && m.classList.contains('field-msg')) m.remove();
  }
  const moneyKey = (e) => (e === 'tooManyDecimals' ? 'field.tooManyDecimals' : e === 'negative' ? 'field.negative' : e === 'tooLarge' ? 'field.tooLarge' : 'field.money');
  IN['np-name'] = (el) => { S.ui.np.name = el.value; };
  IN['np-price'] = (el) => { S.ui.np.price = el.value; fieldOk(el); };
  ACT['np-save'] = (el) => {
    const name = CV.line(S.ui.np.name, 200) || t('np.default');
    // the price with the same rules as the real app: 9,90 and 9.90 work, 9,,90 does not
    const raw = String(S.ui.np.price || '').trim();
    const r = raw ? CV.money(raw) : { ok: true, value: 0 };
    if (!r.ok) { fieldErr($('#np-price'), moneyKey(r.error)); return; }
    const price = r.value;
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
  const tagLabel = (x) => t('tag.' + x.replace(/ (\w)/g, (_, ch) => ch.toUpperCase()));
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
    const fs = [['all', t('f.all')], ['new', t('f.new')], ['push', t('f.push')], ['vip', tagLabel('vip')]];
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
        (c.tags.length ? '<div class="section-h">' + T('cust.tags') + '</div><div class="tagrow" style="padding:0 4px">' + c.tags.map((x) => '<span class="chip static">' + esc(tagLabel(x)) + '</span>').join('') + '</div>' : '') +
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
        (canApprove ? '<div class="mt24"><button class="btn primary block" data-act="approve" data-id="' + p.id + '">' + ic('send') + T('post.approve') + '</button></div><p class="section-f free">' + T('post.approve.note') + '</p>' :
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
    if (c.tags.length) { const all = audience(sc, [], ch); parts.unshift('<li>' + ic('tag') + '<span>' + T('aud.tagged', { tags: c.tags.map(tagLabel).join(', '), n: a.total, of: all.total }) + '</span></li>'); }
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
    const ok = (x) => (x ? ' ' + ic('check', 'xs') : '');
    return seg('clang', [['en', 'EN', ok(c.title.en)], ['el', '\u0395\u039b', ok(c.title.el)], ['ru', 'RU', ok(c.title.ru)]], c.lang);
  }
  PARTS['lang-tabs'] = langTabs;
  function composeProducts() {
    const c = S.compose;
    if (!c.products.length) return '<div class="list">' + cell({ act: 'pick-products', lead: tileI('plus', 5), title: T('cmp.addproducts'), sub: T('cmp.addproducts.sub') }) + '</div>';
    return '<div class="list with-thumbs">' + c.products.map((x) => {
      const v = variant(x.vid), p = product(v.pid);
      const was = wasPrice(v.id, Date.now());
      return '<div class="cell">' + img(p.img, vname(v), 'thumb', '') + '<span class="c-main"><span class="c-title" style="display:block">' + esc(vname(v)) + '</span><span class="c-sub" style="display:block">' +
        (c.kind === 'offer' ? T('cmp.was', { price: money(was) }) + (was !== v.price ? ' ' + T('cmp.was.lower', { now: money(v.price) }) : '') : esc(money(v.price))) + '</span></span>' +
        (c.kind === 'offer' ? '<span class="offer-row"><input inputmode="decimal" aria-label="' + T('cmp.offerprice') + '" data-in="offer-price" data-vid="' + v.id + '" value="' + (x.offer != null ? (x.offer / 100).toFixed(2) : '') + '" placeholder="' + T('cmp.offer.ph') + '"></span>' : '') +
        '<button class="iconbtn" style="width:36px;height:36px;margin-left:4px" data-act="cmp-rm" data-vid="' + v.id + '" aria-label="' + T('a11y.remove') + '">' + ic('x', 'sm') + '</button></div>';
    }).join('') + cell({ act: 'pick-products', lead: tileI('plus', 5), title: T('cmp.addmore') }) + '</div>' + (c.kind === 'offer' ? '<p class="section-f">' + T('cmp.omnibus') + '</p>' : '');
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
      body: '<div class="list" style="margin-top:8px">' + cell({ act: 'cmp-kind', title: T('cmp.kind'), val: esc(t('kind.' + c.kind)) }) + '</div>' +
        '<div class="section-h">' + T('cmp.text') + '<button class="linkbtn" data-act="cmp-example">' + T('cmp.example') + '</button></div>' +
        '<div class="lang-tabs" data-part="lang-tabs">' + langTabs() + '</div>' +
        '<div class="list"><div class="input-cell"><input style="text-align:left" data-in="cmp-title" placeholder="' + T('cmp.title.ph') + '" value="' + esc(c.title[c.lang]) + '" aria-label="' + T('cmp.title.ph') + '"></div>' +
        '<div style="padding:0"><textarea class="input" style="border-radius:0" data-in="cmp-body" placeholder="' + T('cmp.body.ph') + '" aria-label="' + T('cmp.body.ph') + '">' + esc(c.body[c.lang]) + '</textarea></div></div>' +
        '<p class="section-f">' + T('cmp.lang.note') + '</p>' +
        '<div class="section-h">' + T('cmp.products') + '</div><div data-part="cmp-products">' + composeProducts() + '</div>' +
        '<div class="section-h">' + T('cmp.who') + '</div>' +
        '<div class="chips" style="margin-bottom:8px">' + scopes.map((s) => '<button class="chip" data-act="cmp-scope" data-k="' + skey(s) + '" aria-pressed="' + (c.scopes.indexOf(skey(s)) >= 0) + '">' + esc(s.scope === 'org' ? t('scope.org.short') : scopeName(s)) + '</button>').join('') + '</div>' +
        '<div class="section-h">' + T('cmp.tagged') + '</div><div class="chips" style="margin-bottom:12px">' + tagsAll.map((x) => '<button class="chip" data-act="cmp-tag" data-k="' + esc(x) + '" aria-pressed="' + (c.tags.indexOf(x) >= 0) + '">' + ic('tag', 'xs') + esc(tagLabel(x)) + '</button>').join('') + '</div>' +
        '<div data-part="audience">' + audienceHtml() + '</div>' +
        '<div class="section-h">' + T('cmp.channels') + '</div><div class="list with-tiles">' +
        cell({ lead: tileI('home', 5), title: T('ch.feed'), sub: T('cmp.feed.sub'), val: sw('noop', true, true, t('ch.feed')) }) +
        cell({ lead: tileI('bell', 5), title: T('ch.push'), sub: can('posts.channel.push') ? T('cmp.push.sub') : '<span class="lock-note">' + ic('lock') + T('cmp.locked') + '</span>', val: sw('cmp-push', c.push, !can('posts.channel.push'), t('ch.push')) }) +
        cell({ lead: tileI('mail', 2), title: T('ch.email'), sub: can('posts.channel.email') ? T('cmp.email.sub') : '<span class="lock-note">' + ic('lock') + T('cmp.locked') + '</span>', val: sw('cmp-email', c.email, !can('posts.channel.email'), t('ch.email')) }) + '</div>' +
        '<div class="section-h">' + T('cmp.when') + '</div>' + seg('cwhen', [['now', t('cmp.now')], ['tomorrow', t('cmp.tomorrow')]], c.when) +
        (publish ? '' : '<div class="mt12">' + why(T('cmp.needs.approval')) + '</div>')
    };
  };
  ACT.compose = () => { S.compose = newCompose(); go('compose'); };
  ACT['cmp-cancel'] = () => {
    const c = S.compose;
    const dirty = c && (['en', 'el', 'ru'].some((l) => c.title[l] || c.body[l]) || c.products.length);
    if (!dirty) { S.compose = null; back(); return; }
    openSheet({ title: t('cmp.discard.t'), render: () => '<p class="section-f" style="text-align:center;margin:4px 0 16px">' + T('cmp.discard.b') + '</p><button class="btn danger block" data-act="cmp-discard">' + T('cmp.discard') + '</button><div class="mt8"><button class="btn gray block" data-act="sheet-close">' + T('cmp.keep') + '</button></div>' });
  };
  ACT['cmp-discard'] = () => { closeSheet(true); S.compose = null; back(); };
  ACT['cmp-kind'] = () => {
    const kinds = ['news', 'offer', 'new_arrival', 'event'];
    openSheet({ title: t('cmp.kind'), render: () => '<div class="list">' + kinds.map((k) => cell({ act: 'cmp-kind-set', data: { k: k }, title: T('kind.' + k), val: S.compose.kind === k ? '<span style="color:var(--accent-text)">' + ic('check') + '</span>' : '', chev: false })).join('') + '</div>' });
  };
  ACT['cmp-kind-set'] = (el) => { S.compose.kind = el.dataset.k; closeSheet(); refresh(); };
  SEG.ckind = (v) => { S.compose.kind = v; refreshPart('cmp-products'); };
  SEG.clang = (v) => { S.compose.lang = v; const c = S.compose; const ti = $('[data-in="cmp-title"]'), bo = $('[data-in="cmp-body"]'); if (ti) ti.value = c.title[v]; if (bo) bo.value = c.body[v]; };
  SEG.cwhen = (v) => { S.compose.when = v; refresh(); };
  IN['cmp-title'] = (el) => { S.compose.title[S.compose.lang] = el.value; refreshPart('lang-tabs'); };
  IN['cmp-body'] = (el) => { S.compose.body[S.compose.lang] = el.value; };
  IN['offer-price'] = (el) => {
    const x = S.compose.products.find((p) => p.vid === el.dataset.vid);
    const r = el.value.trim() ? CV.money(el.value) : { ok: true, value: null };
    x.offer = r.ok ? r.value : null;
    x.offerBad = r.ok ? null : r.error;
    if (r.ok) el.removeAttribute('aria-invalid');
  };
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
    const bad = c.products.find((x) => x.offerBad);
    if (c.kind === 'offer' && bad) {
      const i = $('[data-in="offer-price"][data-vid="' + bad.vid + '"]');
      if (i) i.setAttribute('aria-invalid', 'true');
      toast(t(moneyKey(bad.offerBad)), { icon: 'info' });
      if (i) i.focus();
      return;
    }
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
    const f = S.ui.cFeed || 'all';
    if (f === 'offers') {
      const offers = annaPosts().filter((p) => p.kind === 'offer' && p.validUntil > Date.now());
      return {
        title: t('c.home.title'),
        body: '<div style="margin-bottom:14px">' + seg('cfeed', [['all', t('c.feed.all')], ['offers', t('c.feed.offers')]], f) + '</div>' +
          (offers.length ? offers.map((p) => custPostCard(p, null)).join('') + '<p class="section-f free">' + T(Dt().org.settings.prices ? 'c.omnibus' : 'c.noprices') + '</p>' :
            '<div class="empty"><span class="e-icon">' + ic('tag') + '</span><h3>' + T('c.offers.empty.t') + '</h3><p>' + T('c.offers.empty.b') + '</p></div>')
      };
    }
    return {
      title: t('c.home.title'),
      body: '<div style="margin-bottom:14px">' + seg('cfeed', [['all', t('c.feed.all')], ['offers', t('c.feed.offers')]], f) + '</div>' + tip('c-home', 'tip.chome.t', 'tip.chome.b') +
        notified.map((a) => { const v = variant(a.vid), p = product(v.pid); return '<button class="card row-flex" style="width:100%;border:0;text-align:left;margin-bottom:14px;gap:12px;color:inherit" data-act="c-open-product" data-pid="' + p.id + '">' + img(p.img, pname(p), 'thumb', '') + '<span class="grow"><span class="badge ok">' + ic('check', 'xs') + T('c.back') + '</span><span class="t-headline" style="display:block;margin-top:4px">' + esc(vname(v)) + '</span><span class="muted t-foot">' + T('c.back.sub', { shop: sname(a.shop) }) + '</span></span>' + ic('chev-right', 'chev') + '</button>'; }).join('') +
        items.map((x) => x.html).join('')
    };
  };
  SEG.cfeed = (v) => { S.ui.cFeed = v; refresh(); };
  ACT['c-open-post'] = (el) => go('c-post', { id: el.dataset.id });
  SCREENS['c-post'] = (pr) => {
    const p = Dt().posts.find((x) => x.id === pr.id);
    return { title: t('kind.' + p.kind), large: false, body: custPostCard(p, null) + (p.kind === 'offer' && Dt().org.settings.prices ? '<p class="section-f free">' + T('c.omnibus') + '</p>' : '') };
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
      const notify = av.st === 'out' ? (waiting ? '<button class="btn small gray" data-act="c-alert-stop" data-id="' + waiting.id + '">' + T('c.notify.stop') + '</button>' : '<button class="btn small tinted" data-act="c-notify" data-vid="' + v.id + '" data-shop="' + sh + '">' + ic('bell', 'sm') + T('c.notify') + '</button>') : '';
      return cell({ title: esc(sname(sh)), sub: av.html + (waiting ? ' <span class="badge ok">' + ic('check', 'xs') + T('c.notify.on') + '</span>' : ''), val: notify, chev: false });
    }).filter(Boolean);
    return {
      title: pname(p), large: false, anchor: '.pd-name',
      right: '<button class="navbtn heart' + (fav ? ' on' : '') + '" data-act="c-fav" data-pid="' + p.id + '" aria-pressed="' + fav + '" aria-label="' + T('c.fav') + '">' + ic('heart') + '</button><button class="navbtn" data-act="c-share" aria-label="' + T('c.share') + '">' + ic('share') + '</button>',
      body: img(p.img, pname(p), 'hero-img', '') + '<div class="pd-head"><h1 class="pd-name">' + esc(pname(p)) + '</h1>' +
        (s.prices ? '<div class="price-row"><span class="price">' + esc(money(off ? off.price : v.price)) + '</span>' + (off ? '<span class="was">' + esc(money(off.was)) + '</span><span class="badge accent">' + ic('tag', 'xs') + T('c.offer.until', { date: dt(off.post.validUntil, { weekday: 'long' }) }) + '</span>' : '') + '</div>' + (off ? '<p class="section-f" style="margin:6px 0 0">' + T('c.omnibus') + '</p>' : '') : '<p class="muted mt8">' + T('c.noprice') + '</p>') +
        '<p class="t-callout muted" style="margin:10px 0 0">' + esc(L(p.desc)) + '</p></div>' +
        (p.variants.length > 1 ? '<div class="chips" style="margin-bottom:10px">' + p.variants.map((x, i) => '<button class="chip" data-act="c-variant" data-pid="' + p.id + '" data-i="' + i + '" aria-pressed="' + (i === vi) + '">' + esc(L(x.opt)) + '</button>').join('') + '</div>' : '') +
        (rows.length ? '<div class="section-h">' + T('c.where') + '</div><div class="list">' + rows.join('') + '</div><p class="section-f">' + T(s.stock === 'exact' ? 'c.where.exact' : 'c.where.note') + '</p>' :
          '<div class="mt12">' + why(T('c.stock.hidden')) + '</div>')
    };
  };
  ACT['c-alert-stop'] = (el) => { const x = Dt().alerts.find((y) => y.id === el.dataset.id); if (x) x.status = 'cancelled'; haptic(8); toast(t('prof.alert.cancelled'), { icon: 'bell' }); refresh(); };
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
        '<p class="section-f">' + T('c.shops.private') + '</p>' +
        '<div class="mt16"><button class="btn tinted block" data-act="tab" data-id="c-qr">' + ic('qr') + T('c.shops.scan') + '</button></div>'
    };
  };
  ACT['c-open-shop'] = (el) => go('c-shop', { id: el.dataset.id });
  SCREENS['c-shop'] = (pr) => {
    const sh = shopById(pr.id);
    return { title: sname(sh.id), large: false, body: img(sh.img, sname(sh.id), 'hero-img', '') + '<div class="pd-head"><h1 class="pd-name">Lemoni ' + esc(sname(sh.id)) + '</h1><p class="muted t-callout" style="margin:6px 0 0">' + esc(L(sh.addr)) + '</p></div>' +
      '<div class="list with-tiles">' + cell({ lead: tileI('clock', 3), title: esc(sh.hours), sub: T('c.shop.hours') }) + cell({ lead: tileI('box', 2), title: T('c.shop.stock.' + custMode(sh.id)), sub: T('c.shop.stock.sub') }) + '</div>' +
      '<div class="mt16"><button class="btn tinted block" data-act="tab" data-id="c-catalog">' + ic('grid') + T('c.shop.browse') + '</button></div>' };
  };

  /* ======================= stage 2: team, roles, reports, counts, transfers, lock screen, join, profile ======================= */

  /* ---------- delegation rules (thinking/02): scope, ceiling, rank ---------- */
  function rankFor(memberId, sc) {
    const m = memberById(memberId);
    let best = 0;
    m.assign.forEach((a) => {
      const r = Dt().roles[a.role];
      const ok = sc.scope === 'org' ? a.scope === 'org' : shopsOfScope(sc).every((s) => covers(a, s));
      if (ok && r.rank > best) best = r.rank;
    });
    return best;
  }
  const myRankFor = (sc) => rankFor(S.role, sc);
  function rankText(rank, selfId) {
    const rs = Object.values(Dt().roles).filter((r) => r.id !== selfId);
    const below = rs.filter((r) => r.rank < rank).sort((a, b) => b.rank - a.rank)[0];
    const above = rs.filter((r) => r.rank > rank).sort((a, b) => a.rank - b.rank)[0];
    if (below && above) return t('rank.between', { below: roleName(below), above: roleName(above) });
    if (below) return t('rank.above', { below: roleName(below) });
    if (above) return t('rank.below', { above: roleName(above) });
    return t('rank.top');
  }
  function holds(perm, sc) {
    const lv = level(perm);
    if (lv === 'org') return canOrgWide(perm);
    if (lv === 'any') return can(perm);
    if (sc.scope === 'org') return canOrgWide(perm);
    return shopsOfScope(sc).every((s) => can(perm, s));
  }
  function grantCheck(roleId, sc) {
    const r = Dt().roles[roleId];
    if (r.locked) return { ok: false, why: t('grant.owner') };
    const mine = myRankFor(sc);
    if (r.rank >= mine) return { ok: false, why: t('grant.rank', { r: r.rank, mine: mine }) };
    const missing = Array.from(r.perms).filter((p) => !holds(p, sc));
    if (missing.length) return { ok: false, why: t('grant.ceiling', { n: missing.length, list: missing.slice(0, 2).map((p) => t('perm.' + p)).join(', ') }) };
    return { ok: true };
  }
  function scopesWith(perm) {
    const out = [];
    if (canOrgWide(perm)) out.push({ scope: 'org', id: 'lemoni' });
    Dt().groups.forEach((g) => { if (canOrgWide(perm) || me().assign.some((a) => a.scope === 'group' && a.id === g.id && Dt().roles[a.role].perms.has(perm))) out.push({ scope: 'group', id: g.id }); });
    Dt().shops.forEach((s) => { if (can(perm, s.id)) out.push({ scope: 'shop', id: s.id }); });
    return out;
  }
  function visibleMembers() {
    if (canOrgWide('members.view')) return Dt().members;
    const shops = myShops('members.view');
    return Dt().members.filter((m) => m.assign.some((a) => shopsOfScope(a).some((s) => shops.indexOf(s) >= 0)));
  }
  function manageCheck(target) {
    if (target.id === S.role) return { ok: false, why: t('mng.self') };
    for (const a of target.assign) {
      if (!holds('members.manage', a)) return { ok: false, why: t('mng.scope', { place: scopeName(a) }) };
      const mine = myRankFor(a), theirs = Dt().roles[a.role].rank;
      if (theirs >= mine) return { ok: false, why: t('mng.rank', { r: theirs, mine: mine }) };
    }
    return { ok: true };
  }
  function accessChanged(id) {
    Dt().permsVersion[id] = (Dt().permsVersion[id] || 1) + 1;
    if (PERSONAS.indexOf(id) >= 0 && id !== S.role) {
      S.pendingAccess[id] = true;
      S.previews.unshift({ persona: id, silent: true, n: { at: Date.now() } });
      renderPanel(); pulsePanel();
    }
  }

  /* ---------- team ---------- */
  SCREENS.team = () => {
    const list = visibleMembers();
    const canInv = scopesWith('members.invite').length > 0;
    const row = (m) => cell({
      act: 'open-member', data: { id: m.id }, lead: avatar(m.name, 'md'),
      title: esc(m.name) + (m.id === S.role ? ' <span class="muted">' + T('team.you') + '</span>' : ''),
      sub: esc(m.assign.map(assignLabel).join(', ')),
      val: m.status !== 'active' ? '<span class="badge ' + (m.status === 'suspended' ? 'few' : 'info') + '">' + T('mstatus.' + m.status) + '</span>' : ''
    });
    const act = list.filter((m) => m.status === 'active'), rest = list.filter((m) => m.status !== 'active');
    return {
      title: t('team.title'),
      right: canInv ? '<button class="navbtn" data-act="invite" aria-label="' + T('team.invite') + '">' + ic('plus') + '</button>' : '',
      body: tip('team', 'tip.team.t', 'tip.team.b') + '<div class="list with-thumbs">' + act.map(row).join('') + '</div>' +
        (rest.length ? '<div class="section-h">' + T('team.other') + '</div><div class="list with-thumbs">' + rest.map(row).join('') + '</div>' : '') +
        '<p class="section-f">' + T('team.foot') + '</p>'
    };
  };
  ACT['open-member'] = (el) => go('member', { id: el.dataset.id });
  SCREENS.member = (pr) => {
    const m = memberById(pr.id);
    const chk = manageCheck(m);
    return {
      title: m.name, large: false,
      body: '<div style="text-align:center;margin:8px 0 18px">' + avatar(m.name, 'lg') + '<div class="t-title2 mt12">' + esc(m.name) + '</div><div class="muted t-sub">' + esc(m.email) + (m.status !== 'active' ? ' · ' + T('mstatus.' + m.status) : '') + '</div></div>' +
        '<div class="section-h">' + T('mem.access') + '</div><div class="list">' + m.assign.map((a, i) => {
          const r = Dt().roles[a.role];
          return cell({ act: chk.ok ? 'change-role' : null, data: { id: m.id, i: i }, title: esc(roleName(r)), sub: esc(scopeName(a)) + ' · ' + esc(rankText(r.rank, r.id)) });
        }).join('') + '</div>' +
        (chk.ok ? '<p class="section-f">' + T('mem.tapchange') + '</p><div class="mt16"><button class="btn gray block" data-act="toggle-suspend" data-id="' + m.id + '">' + (m.status === 'suspended' ? T('mem.reactivate') : T('mem.suspend')) + '</button></div>'
          : '<div class="mt12">' + why(esc(chk.why)) + '</div>') +
        '<p class="section-f">' + T('mem.silent') + '</p>'
    };
  };
  function roleChoices(sc, current, act, data) {
    return '<div class="list">' + Object.values(Dt().roles).sort((x, y) => y.rank - x.rank).map((r) => {
      const g = grantCheck(r.id, sc);
      if (!g.ok) return '<div class="cell" aria-disabled="true"><span class="c-main"><span class="c-title muted" style="display:block">' + esc(roleName(r)) + '</span><span class="lock-note">' + ic('lock') + esc(g.why) + '</span></span></div>';
      return cell({ act: act, data: Object.assign({ role: r.id }, data), title: esc(roleName(r)), sub: esc(rankText(r.rank, r.id)) + ' · ' + T('role.nperms', { n: r.perms.size }), val: r.id === current ? '<span style="color:var(--accent-text)">' + ic('check') + '</span>' : '', chev: false });
    }).join('') + '</div>';
  }
  ACT['change-role'] = (el) => {
    const m = memberById(el.dataset.id), i = +el.dataset.i, a = m.assign[i];
    openSheet({ title: t('mem.change'), detent: 'medium', render: () => '<p class="section-f" style="margin:0 4px 10px">' + T('mem.change.sub', { name: m.name, place: scopeName(a) }) + '</p>' + roleChoices(a, m.assign[i].role, 'apply-role', { id: m.id, i: i }) });
  };
  ACT['apply-role'] = (el) => {
    const m = memberById(el.dataset.id), a = m.assign[+el.dataset.i];
    if (a.role === el.dataset.role) { closeSheet(); return; }
    a.role = el.dataset.role;
    accessChanged(m.id);
    closeSheet(); toast(t('mem.changed', { name: firstName(m.id) }), { icon: 'shield' }); refresh();
  };
  ACT['toggle-suspend'] = (el) => {
    const m = memberById(el.dataset.id);
    m.status = m.status === 'suspended' ? 'active' : 'suspended';
    accessChanged(m.id);
    toast(t(m.status === 'suspended' ? 'mem.suspended' : 'mem.reactivated', { name: firstName(m.id) }), { icon: 'shield' }); refresh();
  };
  ACT.invite = () => {
    const scopes = scopesWith('members.invite');
    S.ui.inv = { email: '', sc: skey(scopes[scopes.length - 1]), role: null };
    openSheet({ title: t('inv.title'), detent: 'large', noFocus: true, render: inviteHtml });
  };
  function inviteHtml() {
    const v = S.ui.inv, scopes = scopesWith('members.invite');
    const p = v.sc.split(':'), sc = { scope: p[0], id: p[1] };
    return '<div class="list"><div class="input-cell"><label for="inv-email">' + T('inv.email') + '</label><input id="inv-email" type="email" inputmode="email" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done" maxlength="254" data-in="inv-email" value="' + esc(v.email) + '" placeholder="name@example.com"></div></div>' +
      '<div class="section-h">' + T('inv.where') + '</div><div class="chips">' + scopes.map((s) => '<button class="chip" data-act="inv-sc" data-k="' + skey(s) + '" aria-pressed="' + (v.sc === skey(s)) + '">' + esc(s.scope === 'org' ? t('scope.org.short') : scopeName(s)) + '</button>').join('') + '</div>' +
      '<div class="section-h">' + T('inv.role') + '</div>' + roleChoices(sc, v.role, 'inv-role', {}) +
      '<p class="section-f">' + T('inv.rules') + '</p>' +
      '<div class="mt16"><button class="btn primary block" data-act="inv-send"' + (v.role ? '' : ' disabled') + '>' + ic('send') + T('inv.send') + '</button></div>';
  }
  IN['inv-email'] = (el) => { S.ui.inv.email = el.value; fieldOk(el); };
  ACT['inv-sc'] = (el) => { S.ui.inv.sc = el.dataset.k; S.ui.inv.role = null; sheetRefresh(); };
  ACT['inv-role'] = (el) => { S.ui.inv.role = el.dataset.role; sheetRefresh(); };
  ACT['inv-send'] = () => {
    const v = S.ui.inv, typed = CV.normalizeEmail(v.email);
    if (typed) { const p = CV.emailProblem(typed); if (p) { fieldErr($('#inv-email'), p === 'spaces' ? 'field.spaces' : 'field.email'); return; } }
    const email = typed || 'new.person@example.com';
    const p = v.sc.split(':');
    Dt().members.push({ id: 'inv' + Date.now(), name: email, email: email, tile: 5, status: 'invited', assign: [{ role: v.role, scope: p[0], id: p[1] }] });
    closeSheet(); toast(t('inv.sent', { email: email }), { icon: 'mail' }); refresh();
  };

  /* ---------- roles ---------- */
  const roleCount = (rid) => Dt().members.filter((m) => m.status !== 'removed' && m.assign.some((a) => a.role === rid));
  SCREENS.roles = () => {
    const roles = Object.values(Dt().roles).sort((a, b) => b.rank - a.rank);
    return {
      title: t('roles.title'),
      right: canOrgWide('roles.manage') ? '<button class="navbtn" data-act="role-new" aria-label="' + T('roles.new') + '">' + ic('plus') + '</button>' : '',
      body: tip('roles', 'tip.roles.t', 'tip.roles.b') + '<div class="list">' + roles.map((r) => cell({
        act: 'open-role', data: { id: r.id },
        title: esc(roleName(r)) + (r.custom ? ' <span class="badge plain">' + T('roles.custom') + '</span>' : '') + (r.locked ? ' <span class="lock-note">' + ic('lock') + '</span>' : ''),
        sub: esc(rankText(r.rank, r.id)) + ' · ' + T('role.nperms', { n: r.perms.size }) + ' · ' + T('roles.people', { n: roleCount(r.id).length })
      })).join('') + '</div><p class="section-f">' + T('roles.foot') + '</p>'
    };
  };
  ACT['open-role'] = (el) => { S.ui.rd = null; go('role', { id: el.dataset.id }); };
  ACT['role-new'] = () => {
    const id = 'custom' + Date.now();
    const mine = myRankFor({ scope: 'org', id: 'lemoni' });
    Dt().roles[id] = { id: id, tpl: null, custom: true, rank: Math.max(1, Math.min(35, mine - 1)), locked: false, createdBy: S.role,
      name: { en: window.I18N.en['roles.newname'], el: window.I18N.el['roles.newname'], ru: window.I18N.ru['roles.newname'] }, perms: new Set(['products.view', 'stock.view']) };
    S.ui.rd = null; go('role', { id: id });
  };
  function roleState(r) {
    const mine = myRankFor({ scope: 'org', id: 'lemoni' });
    const reason = r.locked ? t('re.owner') : !canOrgWide('roles.manage') ? t('re.noperm') : r.rank >= mine ? t('re.rankwhy', { r: r.rank, mine: mine }) : '';
    return { mine: mine, ro: !!reason, reason: reason };
  }
  function rankLine() { const d = S.ui.rd; return T('re.rankline', { text: rankText(d.rank, d.id) }); }
  PARTS['re-rank'] = rankLine;
  SCREENS.role = (pr) => {
    const r = Dt().roles[pr.id];
    if (!S.ui.rd || S.ui.rd.id !== r.id) S.ui.rd = { id: r.id, rank: r.rank, perms: new Set(r.perms) };
    const d = S.ui.rd, st = roleState(r);
    const groups = window.CSData.PERM_GROUPS.map((g) => '<div class="section-h">' + T('pg.' + g[0]) + '</div><div class="list">' + g[1].map((p) => {
      const have = holds(p, { scope: 'org', id: 'lemoni' });
      const on = d.perms.has(p);
      const lock = st.ro || !have;
      return '<div class="perm-row"><div class="grow"><div class="t-callout">' + T('perm.' + p) + '</div>' +
        (!have && !st.ro ? '<div class="locked">' + ic('lock') + T('re.nothave') + '</div>' : '') + '</div>' +
        '<label class="switch"><input type="checkbox" role="switch" data-ch="re-perm" data-p="' + p + '"' + (on ? ' checked' : '') + (lock ? ' disabled' : '') + ' aria-label="' + T('perm.' + p) + '"><span class="track"></span><span class="knob"></span></label></div>';
    }).join('') + '</div>').join('');
    return {
      title: roleName(r), large: false,
      right: st.ro ? '' : '<button class="navbtn strong" data-act="role-save">' + T('re.save') + '</button>',
      body: (st.ro ? '<div class="mt8">' + why(esc(st.reason)) + '</div>' : '') +
        '<div class="section-h">' + T('re.rank') + '</div><div class="list"><div class="cell" style="flex-direction:column;align-items:stretch;gap:4px"><span class="c-title" data-part="re-rank">' + rankLine() + '</span>' +
        '<input class="range" type="range" min="1" max="' + Math.max(1, st.mine - 1) + '" value="' + Math.min(d.rank, Math.max(1, st.mine - 1)) + '" data-in="re-rank"' + (st.ro ? ' disabled' : '') + ' aria-label="' + T('re.rank') + '"></div></div>' +
        '<p class="section-f">' + T('re.rank.note') + '</p>' + groups +
        ''
    };
  };
  IN['re-rank'] = (el) => { S.ui.rd.rank = +el.value; refreshPart('re-rank'); };
  CH['re-perm'] = (el) => { const d = S.ui.rd; if (el.checked) d.perms.add(el.dataset.p); else d.perms.delete(el.dataset.p); haptic(6); };
  ACT['role-save'] = () => {
    const d = S.ui.rd, r = Dt().roles[d.id];
    const people = roleCount(r.id);
    const apply = () => {
      r.perms = new Set(d.perms); r.rank = d.rank;
      people.forEach((m) => accessChanged(m.id));
      closeSheet(); toast(t('re.saved', { n: people.length }), { icon: 'shield' }); back();
    };
    if (!people.length) return apply();
    S.ui.roleApply = apply;
    openSheet({ title: t('re.confirm.t'), render: () => '<div class="t-title3" style="text-align:center;margin:6px 0 6px">' + T('re.confirm', { n: people.length }) + '</div>' +
      '<p class="section-f" style="text-align:center;margin:0 0 14px">' + T('re.confirm.b') + '</p><div class="list with-thumbs">' + people.map((m) => cell({ lead: avatar(m.name, 'md'), title: esc(m.name), sub: esc(m.assign.map(assignLabel).join(', ')) })).join('') + '</div>' +
      '<div class="btn-row mt16"><button class="btn gray" data-act="sheet-close">' + T('cancel') + '</button><button class="btn primary" data-act="role-apply">' + T('re.save') + '</button></div>' });
  };
  ACT['role-apply'] = () => { if (S.ui.roleApply) S.ui.roleApply(); };

  /* ---------- reports (dataviz rules: one hue, thin marks, 4px data ends, legend only for 2+ series, table view) ---------- */
  function days14() { const d0 = new Date(); d0.setHours(0, 0, 0, 0); const out = []; for (let i = 13; i >= 0; i--) out.push(d0.getTime() - i * D); return out; }
  function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; const st = [1, 1.2, 1.5, 2, 2.5, 5, 8, 10]; return st.find((x) => f <= x) * p; }
  function barPathV(x, y, w, h) { const r = Math.min(4, w / 2, h); return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z'; }
  function barPathH(x, y, w, h) { const r = Math.min(4, h / 2, w); return 'M' + x + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h - r) + 'Q' + (x + w) + ',' + (y + h) + ' ' + (x + w - r) + ',' + (y + h) + 'H' + x + 'Z'; }
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  function tableView(head, rows) {
    return '<details class="tableview"><summary>' + T('rep.table') + '</summary><table class="chart-table"><thead><tr>' + head.map((h, i) => '<th' + (i ? ' class="n"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="n"' : '') + '>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></details>';
  }
  function columnsChart(vals, labels, fmt) {
    const W = 340, Hh = 170, pl = 40, pb = 22, pt = 18;
    const max = niceMax(Math.max.apply(null, vals));
    const ih = Hh - pb - pt, slot = (W - pl) / vals.length, bw = Math.min(24, slot * 0.62);
    let g = '';
    [0, 0.5, 1].forEach((f) => { const y = pt + ih - ih * f; g += '<line class="gridl" x1="' + pl + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/><text x="' + (pl - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + esc(fmt(max * f, true)) + '</text>'; });
    const iMax = vals.indexOf(Math.max.apply(null, vals)), iLast = vals.length - 1;
    vals.forEach((v, i) => {
      const h = max ? (v / max) * ih : 0, x = pl + i * slot + (slot - bw) / 2, y = pt + ih - h;
      g += '<g class="hitbar" tabindex="0" data-tip="' + esc(fmt(v) + '|' + labels[i].full) + '"><rect class="hitrect" x="' + (pl + i * slot) + '" y="' + pt + '" width="' + slot + '" height="' + ih + '" fill="transparent"/>' + (h > 0 ? '<path class="bar" d="' + barPathV(x, y, bw, h) + '"/>' : '') + '</g>';
      if ((i === iMax || i === iLast) && v > 0) g += '<text class="v" x="' + (x + bw / 2) + '" y="' + (y - 5) + '" text-anchor="middle">' + esc(fmt(v, true)) + '</text>';
      if (i === 0 || i === iLast || (i % 3 === 0 && i < iLast - 1)) g += '<text x="' + (i === 0 ? x : x + bw / 2) + '" y="' + (Hh - 5) + '" text-anchor="' + (i === 0 ? 'start' : 'middle') + '">' + esc(labels[i].tick) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img">' + g + '</svg>';
  }
  function barsChart(rows, fmt, two) {
    const max = Math.max.apply(null, rows.map((r) => Math.max(r.a, two ? r.b : 0))) || 1;
    const line = (v, cls) => '<div class="hline"><div class="hbar ' + cls + '" style="width:calc((100% - 52px) * ' + (v / max).toFixed(4) + ')"></div><span class="hval">' + esc(fmt(v, true)) + '</span></div>';
    return '<div class="hbars" role="list">' + rows.map((r) => {
      const tipText = fmt(two ? r.b : r.a) + '|' + r.label + (two ? ' \u00b7 ' + t('rep.opens') + ': ' + fmt(r.a) : '') + (r.tipExtra ? ' \u00b7 ' + r.tipExtra : '');
      return '<div class="hrow hitbar" role="listitem" tabindex="0" data-tip="' + esc(tipText) + '"><div class="hlabel">' + esc(r.label) + '</div><div class="htrack">' + (two ? line(r.a, 'outline') + line(r.b, 'thin') : line(r.a, '')) + '</div></div>';
    }).join('') + '</div>';
  }
  function chartCard(title, sub, svg, table, legend) {
    return '<section class="chart-card"><h3>' + esc(title) + '</h3><div class="c-sub">' + esc(sub) + '</div>' + (legend || '') + svg + table + '</section>';
  }
  SCREENS.reports = () => {
    const shops = ctxShops().filter((s) => can('reports.view', s));
    const fin = shops.every((s) => can('reports.financial.view', s));
    const days = days14(), qtyD = days.map(() => 0), valD = days.map(() => 0);
    const byProd = {}, shrink = {};
    Dt().ledger.forEach((m) => {
      if (shops.indexOf(m.shop) < 0) return;
      if (m.kind === 'sale') {
        const i = Math.floor((m.at - days[0]) / D);
        if (i >= 0 && i < 14) { qtyD[i] += -m.delta; valD[i] += -m.delta * (m.price || 0); const pid = variant(m.vid).pid; byProd[pid] = (byProd[pid] || 0) + -m.delta; }
      }
      if ((m.kind === 'damage' || (m.kind === 'adjust' && m.delta < 0)) && m.at > Date.now() - 30 * D) {
        const k = m.reason || 'lost'; shrink[k] = shrink[k] || { q: 0, v: 0 }; shrink[k].q += -m.delta; shrink[k].v += -m.delta * (m.cost || variant(m.vid).cost);
      }
    });
    const totalQ = qtyD.reduce((a, b) => a + b, 0), totalV = valD.reduce((a, b) => a + b, 0);
    const stockVal = Dt().products.reduce((s, p) => s + p.variants.reduce((x, v) => x + Math.max(0, qtyIn(v.id, shops)) * v.cost, 0), 0);
    const fmtQ = (v) => num(Math.round(v));
    const fmtM = (v, tick) => (tick ? new Intl.NumberFormat(LOC[S.lang], { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v / 100) : money(v));
    const labels = days.map((d, i) => ({ tick: i === 0 ? dt(d, { day: 'numeric', month: 'short' }) : String(new Date(d).getDate()), full: dt(d, { weekday: 'short', day: 'numeric', month: 'short' }) }));
    const sales = chartCard(t(fin ? 'rep.sales.v' : 'rep.sales.q'), t(fin ? 'rep.sales.v.sub' : 'rep.sales.q.sub'), columnsChart(fin ? valD : qtyD, labels, fin ? fmtM : fmtQ),
      tableView([t('rep.day'), fin ? t('rep.revenue') : t('rep.items')], days.map((d, i) => [labels[i].full, fin ? money(valD[i]) : num(qtyD[i])])));
    const top = Object.keys(byProd).sort((a, b) => byProd[b] - byProd[a]).slice(0, 6).map((pid) => ({ label: pname(product(pid)), a: byProd[pid] }));
    const topC = chartCard(t('rep.top'), t('rep.top.sub'), barsChart(top, fmtQ), tableView([t('rep.product'), t('rep.items')], top.map((r) => [r.label, num(r.a)])));
    const wantMap = {};
    Dt().alerts.filter((a) => a.status === 'waiting' && (a.shop === null || shops.indexOf(a.shop) >= 0)).forEach((a) => { wantMap[a.vid] = (wantMap[a.vid] || 0) + 1; });
    const want = Object.keys(wantMap).sort((a, b) => wantMap[b] - wantMap[a]).slice(0, 6).map((vid) => ({ label: vname(variant(vid)), a: wantMap[vid], tipExtra: t('st.' + (vState(vid, shops) === 'ok' ? 'ok' : vState(vid, shops))) }));
    const wantC = want.length ? chartCard(t('rep.want'), t('rep.want.sub'), barsChart(want, fmtQ), tableView([t('rep.product'), t('rep.waiting')], want.map((r) => [r.label, num(r.a)])))
      : chartCard(t('rep.want'), t('rep.want.none'), '', '');
    const links = Dt().links.filter((l) => shopsOfScope({ scope: l.scope, id: l.sid }).some((s) => shops.indexOf(s) >= 0));
    const lrows = links.map((l) => ({ label: L(l.label) + (l.scope === 'shop' ? ', ' + sname(l.sid) : ''), a: l.opens, b: l.signups }));
    const legend = '<div class="legend"><span><i class="outline"></i>' + T('rep.opens') + '</span><span><i style="background:var(--data-1)"></i>' + T('rep.signups') + '</span></div>';
    const linkC = chartCard(t('rep.links'), t('rep.links.sub'), barsChart(lrows, fmtQ, true), tableView([t('rep.link'), t('rep.opens'), t('rep.signups'), t('rep.conv')], links.map((l) => [L(l.label) + (l.scope === 'shop' ? ', ' + sname(l.sid) : ''), num(l.opens), num(l.signups), pct(l.signups / l.opens)])), legend);
    const srows = Object.keys(shrink).sort((a, b) => (fin ? shrink[b].v - shrink[a].v : shrink[b].q - shrink[a].q)).map((k) => { const lb = t('r.' + k); return { label: lb.charAt(0).toUpperCase() + lb.slice(1), a: fin ? shrink[k].v : shrink[k].q }; });
    const shrinkC = chartCard(t('rep.shrink'), t(fin ? 'rep.shrink.v' : 'rep.shrink.q'), barsChart(srows, fin ? fmtM : fmtQ), tableView([t('rep.reason'), fin ? t('rep.cost') : t('rep.items')], srows.map((r) => [r.label, fin ? money(r.a) : num(r.a)])));
    const tiles = '<div class="kpis" style="margin-bottom:14px">' +
      kpi('c3', 'bag', t('rep.k.sold'), totalQ, t('rep.k.14')) +
      (fin ? '<div class="kpi c4"><span class="k-label">' + ic('chart') + T('rep.k.rev') + '</span><span class="k-value" style="font-size:24px">' + esc(money(totalV)) + '</span><span class="k-note">' + T('rep.k.14') + '</span></div>' +
        '<div class="kpi c2"><span class="k-label">' + ic('box') + T('rep.k.value') + '</span><span class="k-value" style="font-size:24px">' + esc(money(stockVal)) + '</span><span class="k-note">' + T('rep.k.atcost') + '</span></div>' : '') +
      kpi('c1', 'bell', t('kpi.waiting'), Object.values(wantMap).reduce((a, b) => a + b, 0), t('kpi.waiting.note')) + '</div>';
    return {
      title: t('rep.title'),
      body: shopChips() + (fin ? '' : '<div class="why" style="margin-bottom:12px">' + ic('lock') + '<span>' + T('rep.nofin') + '</span></div>') + tiles + sales + topC + wantC + linkC + shrinkC + '<p class="section-f free">' + T('rep.foot') + '</p>'
    };
  };
  function chartTip(target) {
    const card = target.closest('.chart-card'); if (!card) return;
    let tipEl = card.querySelector('.chart-tip');
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'chart-tip'; tipEl.setAttribute('role', 'status'); card.appendChild(tipEl); }
    const parts = (target.dataset.tip || '').split('|');
    tipEl.textContent = '';
    const b = document.createElement('b'); b.textContent = parts[0]; tipEl.appendChild(b);
    tipEl.appendChild(document.createTextNode(parts.slice(1).join('|')));
    const k = scale();
    const cr = card.getBoundingClientRect(), r = (target.querySelector('.bar, .hbar:last-child, .hbar') || target).getBoundingClientRect();
    tipEl.style.opacity = '1';
    const x = Math.min(cr.width / k - tipEl.offsetWidth - 6, Math.max(6, (r.left - cr.left + r.width / 2) / k - tipEl.offsetWidth / 2));
    tipEl.style.left = x + 'px';
    tipEl.style.top = Math.max(4, (r.top - cr.top) / k - tipEl.offsetHeight - 8) + 'px';
  }
  function chartTipHide(target) { const card = target.closest('.chart-card'); const tp = card && card.querySelector('.chart-tip'); if (tp) tp.style.opacity = '0'; }
  document.addEventListener('pointerover', (e) => { const h = e.target.closest && e.target.closest('.hitbar'); if (h) chartTip(h); });
  document.addEventListener('pointerout', (e) => { const h = e.target.closest && e.target.closest('.hitbar'); if (h && !h.contains(e.relatedTarget)) chartTipHide(h); });
  document.addEventListener('focusin', (e) => { const h = e.target.closest && e.target.closest('.hitbar'); if (h) chartTip(h); });
  document.addEventListener('focusout', (e) => { const h = e.target.closest && e.target.closest('.hitbar'); if (h) chartTipHide(h); });

  /* ---------- stock counts ---------- */
  function countScope(c) { return Dt().products.filter((p) => c.kind === 'full' || p.cat === c.cat).flatMap((p) => p.variants.map((v) => v.id)); }
  function openCount(shop) { return Dt().counts.find((c) => c.shop === shop && c.status === 'open'); }
  function startCount(shop, kind, cat) {
    const c = { id: 'cnt' + Date.now(), shop: shop, kind: kind, cat: cat || null, status: 'open', lines: {}, by: S.role, at: Date.now() };
    Dt().counts.unshift(c); return c;
  }
  function countLine(c, vid, d) {
    const l = c.lines[vid] || (c.lines[vid] = { counted: 0, expected: qty(vid, c.shop), by: S.role, at: Date.now() });
    l.counted = Math.max(0, l.counted + d); l.by = S.role; l.at = Date.now();
  }
  SCREENS.counts = () => {
    const sh = actionShop();
    const list = Dt().counts.filter((c) => ctxShops().indexOf(c.shop) >= 0);
    return {
      title: t('cnt.title'),
      body: tip('counts', 'tip.counts.t', 'tip.counts.b') +
        (can('stock.count', sh) ? '<button class="btn primary block" data-act="count-start">' + ic('count') + T('cnt.start', { shop: sname(sh) }) + '</button>' : why(T('cnt.cannot'))) +
        (list.length ? '<div class="section-h">' + T('cnt.list') + '</div><div class="list with-tiles">' + list.map((c) => cell({ act: 'open-count', data: { id: c.id }, lead: tileI('count', c.status === 'applied' ? 3 : c.status === 'review' ? 4 : 2), title: esc(sname(c.shop)) + ' · ' + (c.kind === 'full' ? T('cnt.full') : esc(L(Dt().categories.find((x) => x.id === c.cat).name))), sub: T('cnt.status.' + c.status) + ' · ' + esc(rel(c.at)) })).join('') + '</div>' : '')
    };
  };
  ACT['count-start'] = () => {
    const sh = actionShop();
    if (openCount(sh)) { go('count', { id: openCount(sh).id }); return; }
    openSheet({ title: t('cnt.new'), render: () => '<p class="section-f" style="margin:0 4px 10px">' + T('cnt.new.sub', { shop: sname(sh) }) + '</p><div class="list with-tiles">' +
      cell({ act: 'count-go', data: { kind: 'full' }, lead: tileI('box', 2), title: T('cnt.full'), sub: T('cnt.full.sub') }) +
      Dt().categories.map((c) => cell({ act: 'count-go', data: { kind: 'cat', cat: c.id }, lead: tileI('grid', 6), title: esc(L(c.name)), sub: T('cnt.cat.sub') })).join('') + '</div>' });
  };
  ACT['count-go'] = (el) => { const c = startCount(actionShop(), el.dataset.kind, el.dataset.cat); closeSheet(true); go('count', { id: c.id }); };
  ACT['open-count'] = (el) => go('count', { id: el.dataset.id });
  SCREENS.count = (pr) => {
    const c = Dt().counts.find((x) => x.id === pr.id);
    const vids = countScope(c);
    const counted = vids.filter((v) => c.lines[v]).length;
    const approve = can('stock.count.approve', c.shop);
    const head = '<div class="lsub" style="margin-top:0">' + esc(sname(c.shop)) + ' · ' + (c.kind === 'full' ? T('cnt.full') : esc(L(Dt().categories.find((x) => x.id === c.cat).name))) + ' · ' + T('cnt.status.' + c.status) + '</div>';
    if (c.status === 'open') {
      return {
        title: t('cnt.one'), large: false,
        body: head + '<div class="card" style="margin-bottom:12px"><div class="t-headline">' + T('cnt.progress', { a: counted, b: vids.length }) + '</div><p class="muted t-sub" style="margin:4px 0 12px">' + T('cnt.blind') + '</p>' +
          '<button class="btn tinted block" data-act="count-scan" data-id="' + c.id + '">' + ic('scan') + T('cnt.byscan') + '</button></div>' +
          '<div class="list with-thumbs">' + vids.map((vid) => { const v = variant(vid), l = c.lines[vid]; return cell({ cls: 'cl-' + vid, lead: img(product(v.pid).img, vname(v), 'thumb', ''), title: esc(vname(v)), sub: l ? T('cnt.countedby', { name: firstName(l.by) }) : T('cnt.notyet'), val: l ? stepper('cl:' + c.id + ':' + vid, l.counted) : '<button class="btn small tinted" data-act="step" data-id="cl:' + c.id + ':' + vid + '" data-d="1">' + T('cnt.count1') + '</button>', chev: false }); }).join('') + '</div>' +
          '<div class="mt16"><button class="btn primary block" data-act="count-submit" data-id="' + c.id + '"' + (counted ? '' : ' disabled') + '>' + (approve ? T('cnt.review') : T('cnt.submit')) + '</button></div>'
      };
    }
    const lines = vids.filter((v) => c.lines[v]);
    const unc = vids.filter((v) => !c.lines[v] && qty(v, c.shop) !== 0);
    const fin = can('products.cost.view');
    let totalV = 0;
    const rows = lines.map((vid) => {
      const l = c.lines[vid], d = l.counted - l.expected, v = variant(vid);
      totalV += d * v.cost;
      return cell({ title: esc(vname(v)), sub: T('cnt.expcount', { e: l.expected, c: l.counted }) + (fin && d ? ' · ' + esc(money(d * v.cost)) : ''), val: d === 0 ? '<span class="muted">' + T('cnt.match') + '</span>' : '<span class="badge ' + (d < 0 ? 'neg' : 'info') + '">' + (d > 0 ? '+' : '−') + Math.abs(d) + '</span>', chev: false });
    }).join('');
    return {
      title: t('cnt.one'), large: false,
      body: head + '<div class="section-h">' + T('cnt.diffs') + '</div><div class="list">' + rows + '</div>' +
        (fin ? '<p class="section-f">' + T('cnt.total', { v: money(totalV) }) + '</p>' : '') +
        '<p class="section-f">' + T('cnt.expected.note') + '</p>' +
        (c.status === 'review' && c.kind === 'full' && unc.length ? '<p class="section-f">' + T('cnt.unc', { n: unc.length }) + '</p>' : '') +
        (c.status === 'review' ? (approve ? '<div class="mt16"><button class="btn primary block" data-act="count-apply" data-id="' + c.id + '">' + T('cnt.apply') + '</button></div>' : '<div class="mt16">' + why(T('cnt.waiting')) + '</div>')
          : '<div class="mt16"><div class="why">' + ic('check') + '<span>' + T('cnt.applied', { n: c.diffs || 0, name: firstName(c.appliedBy) }) + '</span></div></div>')
    };
  };
  ACT['count-scan'] = (el) => { const c = Dt().counts.find((x) => x.id === el.dataset.id); S.ui.scanMode = 'count'; S.ui.scanShop = c.shop; S.tab = 'scan'; S.stacks.scan = [{ name: 'scan', params: {} }]; renderApp('tab'); };
  ACT['count-submit'] = (el) => {
    const c = Dt().counts.find((x) => x.id === el.dataset.id);
    c.status = 'review'; c.submittedBy = S.role;
    if (!can('stock.count.approve', c.shop)) toast(t('cnt.sent', { name: 'Maria' }), { icon: 'send' });
    refresh();
  };
  ACT['count-apply'] = (el) => {
    const c = Dt().counts.find((x) => x.id === el.dataset.id);
    const unc = countScope(c).filter((v) => !c.lines[v] && qty(v, c.shop) !== 0);
    if (c.kind === 'full' && unc.length) {
      openSheet({ title: t('cnt.q.t'), render: () => '<div class="t-title3" style="text-align:center;margin:8px 0">' + T('cnt.q', { n: unc.length }) + '</div><p class="section-f" style="text-align:center;margin:0 0 16px">' + T('cnt.q.b') + '</p>' +
        '<button class="btn gray block" data-act="count-do" data-id="' + c.id + '" data-p="ignore">' + T('cnt.q.leave') + '</button><div class="mt8"><button class="btn danger block" data-act="count-do" data-id="' + c.id + '" data-p="zero">' + T('cnt.q.zero') + '</button></div>' });
      return;
    }
    applyCount(c, 'ignore');
  };
  ACT['count-do'] = (el) => { closeSheet(true); applyCount(Dt().counts.find((x) => x.id === el.dataset.id), el.dataset.p); };
  function applyCount(c, policy) {
    let diffs = 0;
    Object.keys(c.lines).forEach((vid) => { const l = c.lines[vid], d = l.counted - l.expected; if (d) { applyMove({ vid: vid, shop: c.shop, delta: d, kind: 'count', reason: 'correction', ref: c.id, cost: variant(vid).cost }); diffs += 1; } });
    if (policy === 'zero') countScope(c).forEach((vid) => { if (!c.lines[vid]) { const q = qty(vid, c.shop); if (q) { applyMove({ vid: vid, shop: c.shop, delta: -q, kind: 'count', reason: 'correction', ref: c.id, cost: variant(vid).cost }); diffs += 1; } } });
    c.status = 'applied'; c.policy = policy; c.appliedBy = S.role; c.diffs = diffs;
    tick(); toast(t('cnt.done', { n: diffs }), { icon: 'check' }); refresh();
  }

  /* ---------- transfers ---------- */
  function inTransit(vid, shop) { return Dt().transfers.filter((x) => x.status === 'sent' && x.to === shop).reduce((s, x) => s + x.lines.filter((l) => l.vid === vid).reduce((a, l) => a + l.sent, 0), 0); }
  function createTransfer(from, to, lines, by) {
    const tr = { id: 'tr' + Date.now(), from: from, to: to, status: 'sent', by: by, at: Date.now(), lines: lines.map((l) => ({ vid: l.vid, sent: l.n, received: l.n })) };
    tr.lines.forEach((l) => applyMove({ vid: l.vid, shop: from, delta: -l.sent, kind: 'transfer_out', ref: tr.id, by: by }));
    Dt().transfers.unshift(tr);
    const n = tr.lines.reduce((s, l) => s + l.sent, 0);
    if (to === 'kif') ['dimitris', 'maria'].forEach((who, i) => deliver(who, { org: 'lemoni', merchant: { en: 'Lemoni Kifisia', el: 'Lemoni Κηφισιά', ru: 'Lemoni Кифисия' }, tk: 'push.tr.title', bk: 'push.tr.body', v: { n: n, from: from }, img: null, route: { role: who, tab: 'home', name: 'transfer', params: { id: tr.id } } }, 900 + i * 300));
    return tr;
  }
  const TR_DEFAULT = [{ vid: 'olive-oil', n: 5 }, { vid: 'greek-coffee', n: 4 }, { vid: 'tahini', n: 3 }];
  ACT['transfer-new'] = () => {
    const from = scopesWith('stock.transfer.send').filter((s) => s.scope === 'shop').map((s) => s.id);
    const f = from.indexOf('mar') >= 0 ? 'mar' : from[0];
    S.ui.trn = { from: f, to: f === 'kif' ? 'mar' : 'kif', lines: {} };
    TR_DEFAULT.forEach((l) => { if (qty(l.vid, f) >= l.n) S.ui.trn.lines[l.vid] = l.n; });
    openSheet({ title: t('tr.new'), detent: 'large', render: trnHtml });
  };
  function trnHtml() {
    const v = S.ui.trn;
    const from = scopesWith('stock.transfer.send').filter((s) => s.scope === 'shop').map((s) => s.id);
    const total = Object.values(v.lines).reduce((a, b) => a + b, 0);
    const items = Dt().products.flatMap((p) => p.variants).filter((x) => qty(x.id, v.from) > 0);
    return '<div class="section-h" style="margin-top:4px">' + T('tr.from') + '</div><div class="chips">' + from.map((s) => '<button class="chip" data-act="trn-from" data-id="' + s + '" aria-pressed="' + (v.from === s) + '">' + esc(sname(s)) + '</button>').join('') + '</div>' +
      '<div class="section-h">' + T('tr.to') + '</div><div class="chips">' + Dt().shops.filter((s) => s.id !== v.from).map((s) => '<button class="chip" data-act="trn-to" data-id="' + s.id + '" aria-pressed="' + (v.to === s.id) + '">' + esc(sname(s.id)) + '</button>').join('') + '</div>' +
      '<div class="section-h">' + T('tr.items') + '</div><div class="list with-thumbs">' + items.map((x) => cell({ lead: img(product(x.pid).img, vname(x), 'thumb', ''), title: esc(vname(x)), sub: T('tr.have', { n: qty(x.id, v.from) }), val: stepper('tr:' + x.id, v.lines[x.id] || 0), chev: false })).join('') + '</div>' +
      '<div class="mt16"><button class="btn primary block" data-act="trn-send"' + (total ? '' : ' disabled') + '>' + ic('truck') + T('tr.send', { n: total }) + '</button></div><p class="section-f free">' + T('tr.note') + '</p>';
  }
  ACT['trn-from'] = (el) => { S.ui.trn.from = el.dataset.id; if (S.ui.trn.to === el.dataset.id) S.ui.trn.to = Dt().shops.find((s) => s.id !== el.dataset.id).id; S.ui.trn.lines = {}; sheetRefresh(); };
  ACT['trn-to'] = (el) => { S.ui.trn.to = el.dataset.id; sheetRefresh(); };
  ACT['trn-send'] = () => {
    const v = S.ui.trn;
    const lines = Object.keys(v.lines).filter((k) => v.lines[k] > 0).map((k) => ({ vid: k, n: v.lines[k] }));
    const tr = createTransfer(v.from, v.to, lines, S.role);
    closeSheet(); tick(); toast(t('tr.sent', { n: lines.reduce((s, l) => s + l.n, 0), to: sname(v.to) }), { icon: 'truck' }); refresh();
    return tr;
  };
  ACT['open-transfer'] = (el) => go('transfer', { id: el.dataset.id });
  SCREENS.transfer = (pr) => {
    const tr = Dt().transfers.find((x) => x.id === pr.id);
    const canRecv = tr.status === 'sent' && can('stock.transfer.receive', tr.to);
    const sent = tr.lines.reduce((s, l) => s + l.sent, 0), got = tr.lines.reduce((s, l) => s + l.received, 0);
    return {
      title: t('tr.one'), large: false,
      body: '<div class="card" style="margin-bottom:14px"><div class="row-flex" style="gap:10px">' + tileI('truck', 2) + '<div class="grow"><div class="t-headline">' + T('tr.route', { from: sname(tr.from), to: sname(tr.to) }) + '</div><div class="muted t-foot">' + T('tr.by', { name: firstName(tr.by), when: rel(tr.at) }) + '</div></div>' +
        '<span class="badge ' + (tr.status === 'sent' ? 'info' : 'ok') + '">' + T('tr.status.' + tr.status) + '</span></div></div>' +
        (canRecv ? tip('trrecv', 'tip.tr.t', 'tip.tr.b') : '') +
        '<div class="list with-thumbs">' + tr.lines.map((l) => { const v = variant(l.vid); return cell({ lead: img(product(v.pid).img, vname(v), 'thumb', ''), title: esc(vname(v)), sub: T('tr.sentn', { n: l.sent }) + (tr.status === 'received' && l.received < l.sent ? ' · ' + badge('neg', t('tr.lost', { n: l.sent - l.received })) : ''), val: canRecv ? stepper('trr:' + tr.id + ':' + l.vid, l.received) : '<span class="qty">' + num(l.received) + '</span>', chev: false }); }).join('') + '</div>' +
        (canRecv ? '<div class="mt16"><button class="btn primary block" data-act="tr-receive" data-id="' + tr.id + '">' + ic('receive') + T('tr.receive', { n: got }) + '</button></div>' :
          tr.status === 'sent' ? '<div class="mt12">' + why(T('tr.cannot', { shop: sname(tr.to) })) + '</div>' :
            '<p class="section-f">' + (got < sent ? T('tr.short', { n: sent - got }) : T('tr.allgood')) + '</p>')
    };
  };
  ACT['tr-receive'] = (el) => {
    const tr = Dt().transfers.find((x) => x.id === el.dataset.id);
    let told = null;
    tr.lines.forEach((l) => { if (l.received > 0) { const r = applyMove({ vid: l.vid, shop: tr.to, delta: l.received, kind: 'transfer_in', ref: tr.id }); if (r.told.length && !told) told = r; } });
    tr.status = 'received'; tr.receivedBy = S.role; tr.receivedAt = Date.now();
    const lost = tr.lines.reduce((s, l) => s + (l.sent - l.received), 0);
    tick(); refresh();
    if (told) moment(told.m.vid, tr.to, told.told);
    else toast(lost ? t('tr.done.short', { n: lost }) : t('tr.done'), { icon: lost ? 'alert' : 'check' });
  };

  /* ---------- lock screen ---------- */
  function orgName(k) { if (k === 'lemoni') return 'Lemoni'; const o = Dt().otherOrgs.find((x) => x.id === k); return o ? L(o.name) : k; }
  function notifCard(n, act) {
    const x = nText(n);
    return '<button class="notif" data-act="' + act + '" data-nid="' + esc(n.id) + '" data-k="' + esc(n.org || 'lemoni') + '"><img class="p-icon" src="' + APP_ICON + '" alt=""><span class="p-main"><span class="p-head"><span>Custock</span><span>' + esc(rel(n.at)) + '</span></span><span class="p-title" style="display:block">' + esc(x.merchant) + '</span><span class="p-body"><b>' + esc(x.title) + '</b> ' + esc(x.body) + '</span></span>' + (n.img ? img(n.img, x.title, 'p-thumb', '') : '') + '</button>';
  }
  function lockHtml() {
    const list = (Dt().notifs[S.role] || []).slice().sort((a, b) => b.at - a.at);
    const groups = {}; const order = [];
    list.forEach((n) => { const k = n.org || 'lemoni'; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(n); });
    const now = new Date();
    const g = order.map((k) => {
      const items = groups[k], open = S.ui.lockOpen === k;
      return '<div class="l-group"><div class="l-group-h"><span>' + esc(orgName(k)) + '</span>' + (items.length > 1 ? '<button data-act="lock-toggle" data-k="' + k + '">' + (open ? T('lock.less') : T('lock.count', { n: items.length })) + '</button>' : '') + '</div>' +
        (open ? items.map((n) => notifCard(n, 'lock-open')).join('') : '<div class="l-stack">' + notifCard(items[0], items.length > 1 ? 'lock-toggle' : 'lock-open') + (items.length > 1 ? '<span class="l-behind"></span>' : '') + (items.length > 2 ? '<span class="l-behind two"></span>' : '') + '</div>') + '</div>';
    }).join('');
    return '<div class="l-date">' + esc(dt(now, { weekday: 'long', day: 'numeric', month: 'long' })) + '</div><div class="l-time">' + esc(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(now)) + '</div>' +
      (list.length ? '<div class="l-list">' + g + '</div>' : '<div class="l-empty">' + T('lock.empty') + '</div>') +
      '<button class="l-unlock" data-act="lock-close">' + T('lock.open') + '</button>';
  }
  function openLock() {
    let el = $('#lock');
    if (!el) {
      el = document.createElement('div'); el.className = 'lock'; el.id = 'lock';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', t('lock.title'));
      el.style.backgroundImage = 'url("' + imgSrc('hero-shop', 'shop') + '")';
      $('#overlays').appendChild(el); void el.offsetWidth;
      requestAnimationFrame(() => el.classList.add('show'));
    }
    el.innerHTML = lockHtml();
    $('#statusbar').classList.add('on-dark');
    cover();
  }
  function closeLock() {
    const el = $('#lock'); if (!el) return;
    el.classList.remove('show'); setTimeout(() => { el.remove(); cover(); }, 360);
    const scr = $$('.screen').pop();
    $('#statusbar').classList.toggle('on-dark', !!(scr && scr._spec && scr._spec.dark));
  }
  ACT['lock-show'] = () => { closePanel(); S.ui.lockOpen = null; openLock(); };
  ACT['lock-close'] = () => closeLock();
  ACT['lock-toggle'] = (el) => { S.ui.lockOpen = S.ui.lockOpen === el.dataset.k ? null : el.dataset.k; openLock(); };
  ACT['lock-open'] = (el) => {
    const n = (Dt().notifs[S.role] || []).find((x) => x.id === el.dataset.nid);
    closeLock();
    if (n && n.route) setTimeout(() => openRoute(n.route), 200);
  };

  /* ---------- customer: join from a qr poster ---------- */
  function qrSvg(seed) {
    let h = hash(seed) || 7;
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
    let r = '';
    for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
      const inF = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
      if (!inF && rnd() > 0.5) r += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    }
    const f = (x, y) => '<rect x="' + x + '" y="' + y + '" width="7" height="7" fill="#111"/><rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" fill="#fff"/><rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" fill="#111"/>';
    return '<svg viewBox="0 0 21 21" aria-hidden="true" shape-rendering="crispEdges"><g fill="#111">' + r + '</g>' + f(0, 0) + f(14, 0) + f(0, 14) + '</svg>';
  }
  SCREENS['c-qr'] = () => ({
    title: t('qr.title'), large: false, cls: 'scan-screen', navCls: 'on-camera', dark: true,
    body: '<div class="viewfinder" id="vf" style="background-image:url(\'' + esc(imgSrc('hero-shop', 'shop')) + '\')"><div class="vf-frame"><span class="vf-c tl"></span><span class="vf-c tr"></span><span class="vf-c bl"></span><span class="vf-c br"></span><span class="vf-line"></span></div><div class="vf-hint">' + T('qr.hint') + '</div></div>' +
      '<div class="scan-pad"><button class="qr-poster" data-act="qr-scan" aria-label="' + T('qr.poster.a') + '">' + qrSvg('gly-window') + '<span><span class="qp-t" style="display:block">Lemoni ' + esc(sname('gly')) + '</span><span style="display:block;margin-top:4px">' + T('qr.poster') + '</span></span></button>' +
      '<p class="section-f free">' + T('qr.note') + '</p></div>'
  });
  ACT['qr-scan'] = () => {
    const vf = $('#vf'); if (vf) { vf.classList.remove('flash'); void vf.offsetWidth; vf.classList.add('flash'); }
    tick();
    S.ui.join = { name: 'Anna Sokolova', email: 'anna.sokolova@example.com', email_ok: false, push_ok: false, age: false, interests: [] };
    setTimeout(() => go('c-join', { code: 'gly-window' }), S.reduce ? 0 : 260);
  };
  function joinCta() { const j = S.ui.join; return '<button class="btn primary block" data-act="join-go"' + (j.age && j.name.trim() && j.email.trim() ? '' : ' disabled') + '>' + T('join.cta') + '</button>' + (j.age ? '' : '<p class="section-f" style="text-align:center">' + T('join.age.need') + '</p>'); }
  PARTS['join-cta'] = joinCta;
  SCREENS['c-join'] = () => {
    const j = S.ui.join;
    const already = ANNA().subs.some((s) => s.scope === 'shop' && s.id === 'gly' && s.status === 'subscribed');
    return {
      title: t('join.title'), large: false,
      body: '<div class="browser"><div class="b-bar"><span class="b-url">' + ic('lock', 'xs') + 'custock.app/j/gly-window</span></div><div class="b-body">' +
        '<div class="brand-head"><span class="logo-tile">L</span><div><div class="t-title3">Lemoni ' + esc(sname('gly')) + '</div><div class="muted t-foot">' + esc(L(shopById('gly').addr)) + '</div></div></div>' +
        (already ? '<div class="why">' + ic('check') + '<span>' + T('join.already') + '</span></div>' :
          '<p class="t-callout" style="margin:0 0 12px">' + T('join.lead') + '</p>' +
          '<label class="t-foot muted" for="j-name">' + T('join.name') + '</label><input class="join-input" id="j-name" data-in="j-name" value="' + esc(j.name) + '" autocomplete="name" autocapitalize="words" enterkeyhint="next" maxlength="40">' +
          '<label class="t-foot muted" for="j-email" style="display:block;margin-top:10px">' + T('join.email') + '</label><input class="join-input" id="j-email" type="email" inputmode="email" data-in="j-email" value="' + esc(j.email) + '" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done" maxlength="254">' +
          '<div class="t-foot muted" style="margin:14px 0 6px">' + T('join.interests') + '</div><div class="chips" style="margin:0 -16px 6px">' + Dt().categories.map((c) => '<button class="chip" data-act="j-int" data-id="' + c.id + '" aria-pressed="' + (j.interests.indexOf(c.id) >= 0) + '">' + esc(L(c.name)) + '</button>').join('') + '</div>' +
          '<div class="checkrow"><input type="checkbox" id="j-em" data-ch="j-em"' + (j.email_ok ? ' checked' : '') + '><label for="j-em">' + T('join.c.email') + '</label></div>' +
          '<div class="checkrow"><input type="checkbox" id="j-pu" data-ch="j-pu"' + (j.push_ok ? ' checked' : '') + '><label for="j-pu">' + T('join.c.push') + '</label></div>' +
          '<div class="checkrow"><input type="checkbox" id="j-age" data-ch="j-age"' + (j.age ? ' checked' : '') + '><label for="j-age">' + T('join.c.age') + '</label></div>' +
          '<p class="section-f" style="margin:4px 0 14px">' + T('join.none') + '</p>' +
          '<div data-part="join-cta">' + joinCta() + '</div>' +
          '<p class="section-f" style="margin:14px 0 0">' + T('join.privacy') + '</p>') +
        '<div class="mt16">' + seg('lang', [['en', 'English'], ['el', 'Ελληνικά'], ['ru', 'Русский']], S.lang) + '</div><p class="section-f" style="margin:6px 0 0">' + T('join.lang') + '</p>' +
        '</div></div>'
    };
  };
  IN['j-name'] = (el) => { S.ui.join.name = el.value; refreshPart('join-cta'); };
  IN['j-email'] = (el) => { S.ui.join.email = el.value; fieldOk(el); refreshPart('join-cta'); };
  CH['j-em'] = (el) => { S.ui.join.email_ok = el.checked; };
  CH['j-pu'] = (el) => { S.ui.join.push_ok = el.checked; };
  CH['j-age'] = (el) => { S.ui.join.age = el.checked; refreshPart('join-cta'); };
  ACT['j-int'] = (el) => { const j = S.ui.join, k = el.dataset.id; j.interests = j.interests.indexOf(k) >= 0 ? j.interests.filter((x) => x !== k) : j.interests.concat([k]); el.setAttribute('aria-pressed', String(j.interests.indexOf(k) >= 0)); };
  ACT['join-go'] = () => {
    const j = S.ui.join;
    j.name = CV.line(j.name, 40);
    j.email = CV.normalizeEmail(j.email);
    const p = CV.emailProblem(j.email);
    if (p) { fieldErr($('#j-email'), p === 'spaces' ? 'field.spaces' : 'field.email'); return; }
    if (j.email_ok) go('c-email'); else { finishJoin(false); go('c-welcome'); }
  };
  function finishJoin(confirmed) {
    const a = ANNA(), j = S.ui.join, now = Date.now();
    if (!a.subs.some((s) => s.scope === 'shop' && s.id === 'gly')) a.subs.push({ scope: 'shop', id: 'gly', status: 'subscribed', at: now });
    if (j.email_ok && confirmed) a.consents.push({ ch: 'email', granted: true, at: now, src: 'double_opt_in', text: S.lang + '-2026-09' });
    if (j.push_ok) a.consents.push({ ch: 'push', granted: true, at: now, src: 'join_page', text: S.lang + '-2026-09' });
    j.interests.forEach((c) => { a.interests = a.interests || []; if (a.interests.indexOf(c) < 0) a.interests.push(c); });
    const l = Dt().links.find((x) => x.id === 'jl-gly-window'); if (l) { l.opens += 1; l.signups += 1; if (confirmed) l.confirmed += 1; }
  }
  SCREENS['c-email'] = () => ({
    title: t('mail.title'), large: false,
    body: '<p class="t-callout muted" style="margin:6px 4px 14px">' + T('mail.lead', { email: S.ui.join.email }) + '</p>' +
      '<div class="email-card"><div class="e-head"><b>Lemoni ' + esc(sname('gly')) + ' via Custock</b>' + T('mail.subject', { shop: 'Lemoni ' + sname('gly') }) + '</div><div class="e-body"><p style="margin:0 0 12px">' + T('mail.hi', { name: S.ui.join.name.split(' ')[0] }) + '</p><p style="margin:0 0 16px">' + T('mail.body') + '</p>' +
      '<button class="btn primary block" data-act="join-confirm">' + T('mail.cta') + '</button><p class="section-f" style="margin:14px 0 0">' + T('mail.foot') + '</p></div></div>'
  });
  ACT['join-confirm'] = () => { finishJoin(true); go('c-welcome'); };
  SCREENS['c-welcome'] = () => {
    const j = S.ui.join;
    const items = ['<li>' + ic('home') + '<span>' + T('wel.feed') + '</span></li>'].concat(j.push_ok ? ['<li>' + ic('bell') + '<span>' + T('wel.push') + '</span></li>'] : []).concat(j.email_ok ? ['<li>' + ic('mail') + '<span>' + T('wel.email') + '</span></li>'] : []);
    return {
      title: t('wel.title'), large: false, left: '<span></span>',
      body: '<div class="welcome-check"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg></div><div class="t-title2" style="text-align:center">' + T('wel.head', { shop: 'Lemoni ' + sname('gly') }) + '</div>' +
        '<div class="audience" style="margin-top:18px"><ul style="margin:0">' + items.join('') + '</ul></div><p class="section-f free">' + T('wel.note') + '</p>' +
        '<div class="mt24"><button class="btn primary block" data-act="wel-done">' + T('wel.done') + '</button></div>'
    };
  };
  ACT['wel-done'] = () => { S.stacks['c-qr'] = null; S.stacks['c-shops'] = null; S.tab = 'c-shops'; renderApp('fade'); };

  /* ---------- customer: profile ---------- */
  function annaFlags(org) {
    const a = ANNA();
    if (org === 'lemoni') return { push: a.pushOk, email: a.emailOk };
    const o = Dt().otherOrgs.find((x) => x.id === org);
    if (o.annaPush == null) { o.annaPush = true; o.annaEmail = false; }
    return { push: o.annaPush, email: o.annaEmail };
  }
  SCREENS['c-profile'] = () => {
    const a = ANNA();
    const alerts = Dt().alerts.filter((x) => x.cid === 'c-anna' && x.status !== 'cancelled');
    const favs = Array.from(Dt().favorites).filter((k) => k.indexOf('c-anna|') === 0).map((k) => product(k.split('|')[1])).filter(Boolean);
    const orgs = [['lemoni', 'Lemoni']].concat(Dt().otherOrgs.map((o) => [o.id, L(o.name)]));
    return {
      title: t('prof.title'),
      body: '<div class="list with-thumbs">' + cell({ lead: avatar(a.name, 'md'), title: esc(a.name), sub: esc(a.email) }) + '</div>' +
        '<div class="section-h">' + T('prof.lang') + '</div>' + seg('lang', [['en', 'English'], ['el', 'Ελληνικά'], ['ru', 'Русский']], S.lang) +
        '<p class="section-f">' + T('prof.lang.note') + '</p>' +
        orgs.map((o) => { const f = annaFlags(o[0]); return '<div class="section-h">' + esc(o[1]) + '</div><div class="list with-tiles">' +
          cell({ lead: tileI('bell', 5), title: T('ch.push'), val: '<label class="switch"><input type="checkbox" role="switch" data-ch="c-ch" data-org="' + o[0] + '" data-c="push"' + (f.push ? ' checked' : '') + ' aria-label="' + T('ch.push') + ', ' + esc(o[1]) + '"><span class="track"></span><span class="knob"></span></label>' }) +
          cell({ lead: tileI('mail', 2), title: T('ch.email'), val: '<label class="switch"><input type="checkbox" role="switch" data-ch="c-ch" data-org="' + o[0] + '" data-c="email"' + (f.email ? ' checked' : '') + ' aria-label="' + T('ch.email') + ', ' + esc(o[1]) + '"><span class="track"></span><span class="knob"></span></label>' }) + '</div>'; }).join('') +
        '<p class="section-f">' + T('prof.ch.note') + '</p>' +
        '<div class="section-h">' + T('prof.alerts') + '</div>' + (alerts.length ? '<div class="list with-thumbs">' + alerts.map((x) => { const v = variant(x.vid); return '<div class="swipe"><div class="sw-actions"><button class="sw-a2" data-act="c-alert-cancel" data-id="' + x.id + '">' + ic('x') + T('prof.alert.cancel') + '</button></div>' +
          cell({ lead: img(product(v.pid).img, vname(v), 'thumb', ''), title: esc(vname(v)), sub: esc(x.shop ? sname(x.shop) : t('shop.any')) + ' · ' + T('alert.' + x.status), val: '<button class="btn small gray" data-act="c-alert-cancel" data-id="' + x.id + '">' + T('prof.alert.cancel') + '</button>', chev: false }) + '</div>'; }).join('') + '</div><p class="section-f">' + T('prof.alerts.note') + '</p>' : '<p class="section-f">' + T('prof.alerts.none') + '</p>') +
        '<div class="section-h">' + T('prof.saved') + '</div>' + (favs.length ? '<div class="list with-thumbs">' + favs.map((p) => cell({ act: 'c-open-product', data: { pid: p.id }, lead: img(p.img, pname(p), 'thumb', ''), title: esc(pname(p)) })).join('') + '</div>' : '<p class="section-f">' + T('prof.saved.none') + '</p>') +
        '<div class="section-h">' + T('prof.data') + '</div><div class="list with-tiles">' +
        cell({ act: 'c-export', lead: tileI('receive', 2), title: T('prof.export'), sub: T('prof.export.sub') }) +
        cell({ act: 'c-delete', cls: 'danger', lead: '<span class="tile" style="background:var(--danger-fill)">' + ic('x') + '</span>', title: T('prof.delete'), chev: false }) + '</div><p class="section-f">' + T('prof.data.note') + '</p>'
    };
  };
  CH['c-ch'] = (el) => {
    const org = el.dataset.org, c = el.dataset.c, on = el.checked, a = ANNA();
    if (org === 'lemoni') { if (c === 'push') a.pushOk = on; else a.emailOk = on; a.consents.push({ ch: c, granted: on, at: Date.now(), src: 'app', text: S.lang + '-2026-09' }); }
    else { const o = Dt().otherOrgs.find((x) => x.id === org); if (c === 'push') o.annaPush = on; else o.annaEmail = on; }
    haptic(6); toast(t('prof.saved.toast'), { icon: 'check' });
  };
  ACT['c-alert-cancel'] = (el) => { const x = Dt().alerts.find((y) => y.id === el.dataset.id); if (x) x.status = 'cancelled'; toast(t('prof.alert.cancelled'), { icon: 'bell' }); refresh(); };
  ACT['c-export'] = () => toast(t('prof.export.toast'), { icon: 'mail', ms: 4200 });
  ACT['c-delete'] = () => openSheet({ title: t('del.title'), render: () => '<div class="t-title3" style="text-align:center;margin:6px 0 8px">' + T('del.head') + '</div><p class="section-f" style="text-align:center;margin:0 0 16px">' + T('del.body') + '</p>' +
    '<button class="btn danger block" data-act="c-delete-do">' + T('del.cta') + '</button><div class="mt8"><button class="btn gray block" data-act="sheet-close">' + T('cancel') + '</button></div>' });
  ACT['c-delete-do'] = () => { closeSheet(); toast(t('del.demo'), { icon: 'info', ms: 4200 }); };

  /* ---------------- edge swipe back ---------------- */
  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || SHEET || document.getElementById('lock')) return;
    if (!e.target.closest || !e.target.closest('#screens')) return;
    if (stack().length < 2 || cur().modal) return;
    const ar = $('#app').getBoundingClientRect();
    if (e.clientX - ar.left > 22 * scale()) return;
    const host = $('#screens'), top = $$('.screen', host).pop();
    if (!top) return;
    const prevRoute = stack()[stack().length - 2];
    const x0 = e.clientX, W = top.offsetWidth;
    let under = null, started = false, dx = 0;
    const mv = (ev) => {
      dx = Math.max(0, (ev.clientX - x0) / scale());
      if (!started) {
        if (dx < 8) return;
        started = true; SWALLOW = Date.now() + 100000;
        prevRoute.scroll = prevRoute.scroll || 0;
        under = buildScreen(prevRoute); under._route = prevRoute;
        host.insertBefore(under, top); afterRender(under, prevRoute); under.classList.add('dim');
        top.style.boxShadow = '-8px 0 30px rgba(0,0,0,.12)';
      }
      top.style.transform = 'translateX(' + dx + 'px)';
      under.style.transform = 'translateX(' + (-30 + 30 * Math.min(1, dx / W)) + '%)';
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (!started) return;
      SWALLOW = Date.now();
      const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';
      if (dx > W * 0.35) {
        const a = top.animate([{ transform: top.style.transform }, { transform: 'translateX(100%)' }], { duration: 220, easing: ease, fill: 'forwards' });
        const b = under.animate([{ transform: under.style.transform }, { transform: 'translateX(0)' }], { duration: 220, easing: ease, fill: 'forwards' });
        a.finished.then(() => { top.remove(); stack().pop(); b.cancel(); under.style.transform = ''; under.classList.remove('dim'); renderTabs(); renderNarration(); }).catch(() => {});
      } else {
        const a = top.animate([{ transform: top.style.transform }, { transform: 'translateX(0)' }], { duration: 220, easing: ease });
        a.finished.then(() => { top.style.transform = ''; top.style.boxShadow = ''; if (under) under.remove(); }).catch(() => {});
      }
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }, { passive: true });

  /* ---------------- swipe rows ---------------- */
  function closeSwipes(except) { $$('.swipe.open').forEach((r) => { if (r !== except) { r.classList.remove('open'); $('.cell', r).style.transform = ''; } }); }
  let SWALLOW = 0;
  function swipedRecently(el) { const r = el.closest('.swipe'); return Date.now() - SWALLOW < 400 || !!(r && r.dataset.swiped && Date.now() - +r.dataset.swiped < 350); }
  document.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.swipe');
    const openRows = $$('.swipe.open');
    if (openRows.length && !(row && e.target.closest('.sw-actions'))) {
      if (!row || row.classList.contains('open') || openRows.indexOf(row) < 0) { closeSwipes(); SWALLOW = Date.now(); return; }
    }
    if (!row || e.button > 0 || e.target.closest('.sw-actions')) return;
    const c = $('.cell', row), w = $('.sw-actions', row).offsetWidth;
    const x0 = e.clientX, y0 = e.clientY, base = row.classList.contains('open') ? -w : 0;
    let drag = false, x = base;
    const mv = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!drag && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { drag = true; row.classList.add('dragging'); closeSwipes(row); }
      if (!drag) return;
      x = Math.max(-w - 40, Math.min(0, base + dx / scale()));
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
    closeLock();
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
    if (foot) foot.innerHTML = T('foot.demo') + ' <a href="https://github.com/orestislef/custock" target="_blank" rel="noopener">GitHub</a> · <a href="https://github.com/orestislef/custock/tree/main/thinking" target="_blank" rel="noopener">' + T('foot.thinking') + '</a> · <a href="../status/">' + T('foot.progress') + '</a>';
    const pill = $('#demo-pill');
    if (pill) { const pt = pill.querySelector('.pill-t'); if (pt) pt.textContent = t('panel.pill'); pill.setAttribute('aria-label', t('a11y.panel')); }
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
    compose: [['posts.publish', 'hid.publish'], ['posts.channel.push', 'hid.push'], ['posts.channel.email', 'hid.email']],
    team: [['members.invite', 'hid.invite'], ['members.manage', 'hid.manage']],
    member: [['members.manage', 'hid.manage']],
    roles: [['roles.manage', 'hid.roles']],
    role: [['roles.manage', 'hid.roles']],
    reports: [['reports.financial.view', 'hid.money'], ['reports.staff.view', 'hid.staff']],
    counts: [['stock.count', 'hid.count'], ['stock.count.approve', 'hid.approvecount']],
    count: [['stock.count.approve', 'hid.approvecount'], ['products.cost.view', 'hid.cost']],
    transfer: [['stock.transfer.receive', 'hid.trrecv'], ['stock.transfer.send', 'hid.trsend']]
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
          items.slice(0, 3).map((x) => { if (x.silent) return '<div class="pp-item"><b>' + T('panel.silent.t') + '</b><span class="muted">' + T('panel.silent.b') + '</span></div>'; const n = nText(x.n); return '<div class="pp-item"><b>' + esc(n.merchant) + '</b><span class="muted">' + esc(n.title) + '. ' + esc(n.body) + '</span></div>'; }).join('') + '</div>';
      }).join('') + '</div></div>' : '') +
      '<div class="p-sec"><h2>' + T('panel.look') + '</h2><div class="p-box">' +
      '<div class="p-stack"><span class="p-l">' + T('panel.lang') + '</span>' + seg('lang', [['en', 'English'], ['el', 'Ελληνικά'], ['ru', 'Русский']], S.lang) + '</div>' +
      '<div class="p-stack"><span class="p-l">' + T('panel.appearance') + '</span>' + seg('theme', [['auto', t('panel.auto')], ['light', t('panel.light')], ['dark', t('panel.dark')]], S.appearance) + '</div>' +
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
      '<button class="preset" data-act="preset" data-id="transfer">' + ic('truck') + T('preset.transfer') + '</button>' +
      '<button class="preset" data-act="lock-show">' + ic('phone') + T('preset.lock') + '</button>' +
      '</div></div><p class="section-f" style="margin:6px 6px 0">' + T('panel.push.note') + '</p></div>' +
      '<div class="p-sec"><div class="p-actions"><button class="btn gray" data-act="reset">' + ic('undo') + T('panel.reset') + '</button></div></div>' +
      '<p class="p-links">' + T('panel.foot') + ' <a href="https://github.com/orestislef/custock" target="_blank" rel="noopener">GitHub</a> · <a href="https://github.com/orestislef/custock/tree/main/thinking" target="_blank" rel="noopener">' + T('panel.thinking') + '</a> · <a href="../status/">' + T('foot.progress') + '</a></p>';
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
  SEG.theme = (v) => { S.appearance = v; S.theme = v === 'auto' ? systemTheme() : v; save(); applyChrome(); };
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
    if (id === 'transfer') createTransfer('mar', 'kif', TR_DEFAULT.filter((l) => qty(l.vid, 'mar') >= l.n), 'petros');
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
    if (Date.now() - SWALLOW < 400 && el.closest('#screens')) { e.preventDefault(); return; }
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('input', (e) => { const el = e.target.closest('[data-in]'); if (el && IN[el.dataset.in]) IN[el.dataset.in](el, e); });
  document.addEventListener('change', (e) => { const el = e.target.closest('[data-ch]'); if (el && CH[el.dataset.ch]) CH[el.dataset.ch](el, e); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (SHEET) closeSheet(); else if ($('#panel.open')) closePanel(); }
  });
  if (mqDark && mqDark.addEventListener) mqDark.addEventListener('change', (e) => { if (S.appearance === 'auto') { S.theme = e.matches ? 'dark' : 'light'; applyChrome(); } });

  /* ---------------- clock in the fake status bar ---------------- */
  function clock() { const el = $('#sb-time'); if (el) el.textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(Date.now()); }

  /* ---------------- boot ---------------- */
  function boot() {
    if (PERSONAS.indexOf(S.role) < 0) S.role = 'eleni';
    S.tab = firstTab();
    applyChrome();
    renderPanel();
    fitDevice();
    renderApp('none');
    clock(); setInterval(clock, 20000);
    $('#panel-scrim').addEventListener('click', closePanel);
  }
  window.CSApp = { S: S, t: t, can: can };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
