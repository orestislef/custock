// every email has html that looks like the app and a plain text twin, in the reader's language.
// the first owner gets an invite instead of a mailed password. nothing is sent: messages land in
// the outbox and nodemailer only builds them in memory.

import { beforeAll, describe, expect, it } from 'vitest';
import nodemailer from 'nodemailer';
import { LOCALES } from '@custock/i18n';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { createApp, type App } from '../src/app';
import { runCli, type CliIo } from '../src/cli';
import { esc, renderEmail } from '../src/email/layout';
import { EMAIL_KINDS, joinConfirmEmail, postEmail } from '../src/email/messages';
import { sampleEmail } from '../src/email/samples';
import { buildEmail, type OutboxRow } from '../src/lib/live';
import { runJobs } from '../src/worker';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'email-test-secret-that-is-long-enough-1';
const WEB = 'https://orestislef.gr/custock';
const clock = Date.now();

function caller(app: () => App) {
  return async (method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app().request(path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Json = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // html or text
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
}

const io = (env: Record<string, string | undefined> = {}): CliIo & { lines: string[] } => {
  const lines: string[] = [];
  return { env, readStdin: async () => '', out: (l) => lines.push(l), lines };
};

async function rawMail(row: OutboxRow): Promise<string> {
  const info = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(buildEmail(row, 'hello@custock.example'));
  return info.message.toString();
}

// mail a business sends its customers
const BUSINESS_KINDS = new Set<string>(['joinConfirm', 'backInStock', 'post']);

describe('templates', () => {
  it('every kind in every language: html and text, nothing left untranslated, no tracking', () => {
    for (const kind of EMAIL_KINDS) {
      for (const locale of LOCALES) {
        const m = sampleEmail(kind, locale, WEB);
        const where = `${kind}/${locale}`;
        expect(m.subject, where).toBeTruthy();
        expect(m.html, where).toContain(`<html lang="${locale}"`);
        expect(m.html, where).toContain('max-width:600px');
        // account mail carries the Custock mark, a business's mail to its customers its own logo
        // or name, with Custock in the footer
        if (BUSINESS_KINDS.has(kind)) {
          expect(m.html, where).not.toContain('/email/mark.png');
          expect(m.text, where).toMatch(/Custock/);
        } else {
          expect(m.html, where).toContain('http://localhost:8787/email/mark.png');
          expect(m.html, where).toContain('alt="Custock"');
        }
        expect(m.html, where).toContain('@media (prefers-color-scheme: dark)');
        expect(m.html, where).toContain('name="color-scheme" content="light dark"');
        expect(m.html, where).toContain('display:none;max-height:0');
        expect(m.html, where).not.toMatch(/\{\{|\}\}|email\.\w+\.\w+/);
        expect(m.text, where).not.toMatch(/\{\{|\}\}|email\.\w+\.\w+/);
        expect(m.html, where).not.toMatch(/<script|width="1"|height="1"/i);
        // the text twin carries the same message
        expect(m.text.length, where).toBeGreaterThan(60);
      }
    }
  });

  it('codes are big, spaced, one selectable block, and in the text too', () => {
    const m = sampleEmail('otp', 'el', WEB);
    expect(m.subject).toBe('Ο κωδικός σας για το Custock: 482913');
    expect(m.html).toMatch(/font-size:38px;[^"]*letter-spacing:10px;[^"]*user-select:all;">482913<\/span>/);
    expect(m.text).toContain('    482913');
  });

  it('a button is a 50 px pomegranate link with the link again in words', () => {
    const m = sampleEmail('invite', 'en', WEB);
    expect(m.html).toContain('bgcolor="#B0234F"');
    expect(m.html).toMatch(/height:50px;line-height:50px;[^"]*color:#FFFFFF/);
    expect(m.html).toContain(`href="${WEB}/invite/sample-token"`);
    expect(m.html).toContain('If the button does not work, copy this link into your browser:');
    expect(m.text).toContain(`Accept the invite: ${WEB}/invite/sample-token`);
  });

  it('escapes what people typed and drops links that are not web links', () => {
    // the person's name is not in the email any more (pre launch review), the business name is typed by people too
    const m = joinConfirmEmail('en', { name: 'Zoe', scope: 'A & B "shop" <img src=x onerror=alert(1)>', url: 'javascript:alert(1)' });
    expect(m.html).not.toContain('<img src=x');
    expect(m.html).toContain(esc('<img src=x onerror=alert(1)>'));
    expect(m.html).toContain('A &amp; B &quot;shop&quot;');
    expect(m.html).not.toContain('Zoe');
    expect(m.html).not.toContain('javascript:');
    expect(m.text).not.toContain('javascript:');
  });

  it('an offer shows the offer price and the lowest price of 30 days, only when it is really higher', () => {
    const m = postEmail('en', {
      sender: 'Lemoni Kifisia', kind: 'offer', title: 'Oil week', body: 'First paragraph.\n\nSecond one.', coverUrl: 'https://img.example.com/c.jpg', url: `${WEB}/s/lemoni?post=1`,
      products: [
        { name: 'Olive oil', url: `${WEB}/s/lemoni/p/a`, imageUrl: 'https://img.example.com/a.jpg', priceMinor: 1290, offerPriceMinor: 1030, wasMinor: 1190 },
        { name: 'Tea', url: null, imageUrl: null, priceMinor: 450, offerPriceMinor: 450, wasMinor: 400 },
        { name: 'Honey', url: null, imageUrl: null, priceMinor: 1290, offerPriceMinor: null, wasMinor: null },
      ],
      currency: 'EUR', timezone: 'Europe/Athens', validUntil: Date.UTC(2026, 10, 30, 12), unsubscribeUrl: `${WEB}/unsubscribe/t`,
    });
    expect(m.html).toContain('Lowest price in the last 30 days: €11.90');
    expect(m.html.match(/Lowest price in the last 30 days/g)).toHaveLength(1);
    expect(m.html).toContain('€10.30');
    expect(m.html).toContain('Offer until 30 November');
    expect(m.html).toContain('See the offer');
    expect(m.html).toContain(`href="${WEB}/unsubscribe/t"`);
    expect(m.html).toContain('<p class="ink" style="margin:0 0 16px;font-family:-apple-system');
    expect(m.html).toMatch(/opacity:0;mso-hide:all;[^>]*>First paragraph./);
    expect(m.text).toContain('- Olive oil: €10.30 (Lowest price in the last 30 days: €11.90)');
    expect(m.text).toContain(`Stop these emails: ${WEB}/unsubscribe/t`);
  });

  it('the business logo sits on top in place of the mark, its name when it has none, never a non web link', () => {
    const base = { sender: 'Lemoni', kind: 'news', title: 'Hi', body: 'Body.', coverUrl: null, url: null, products: [], currency: 'EUR', timezone: 'Europe/Athens', validUntil: null, unsubscribeUrl: `${WEB}/u/t` };
    const withLogo = postEmail('en', { ...base, senderLogo: 'https://img.example.com/orgs/x/logo/y.png' });
    expect(withLogo.html).toContain('<img src="https://img.example.com/orgs/x/logo/y.png" width="48" height="48" alt="Lemoni"');
    expect(withLogo.html).not.toContain('width="24" height="24"');
    expect(postEmail('en', base).html).toMatch(/font-size:22px[^>]*>Lemoni<\/p>/);
    expect(postEmail('en', { ...base, senderLogo: 'javascript:alert(1)' }).html).not.toContain('javascript:');
    expect(joinConfirmEmail('en', { name: 'Anna', scope: 'Lemoni', url: `${WEB}/confirm/t`, logoUrl: 'https://img.example.com/l.png' }).html).toContain('src="https://img.example.com/l.png"');
  });

  it('the dark preview turns the dark rules on without the media query', () => {
    const m = sampleEmail('post', 'ru', WEB, { forceDark: true });
    expect(m.html).not.toContain('@media (prefers-color-scheme: dark)');
    expect(m.html).toContain('.card { background-color: #1A1A1F !important; }');
    const plain = renderEmail({ locale: 'en', subject: 's', preheader: 'p', heading: 'h', paragraphs: ['x'], footer: { lines: ['f'] } });
    expect(plain.html).toContain('[data-ogsb] .card');
  });
});

// ---------------------------------------------------------------- what the api really sends

describe('emails from the api', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const call = caller(() => app);
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: WEB, apiPublicUrl: `${WEB}/api`, corsOrigins: [], now: () => clock, rateLimit: false });
    for (const who of ['eleni', 'maria']) tokens[who] = (await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' })).body.accessToken;
  });

  const last = (sql: string, ...p: unknown[]) => db.prepare(`SELECT * FROM dev_outbox WHERE ${sql} ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(...p) as OutboxRow;

  it('the sign in code goes out as html and text together, in the language asked for', async () => {
    await call('POST', '/v1/auth/otp/request', undefined, { email: 'mail.person@example.com', locale: 'ru' });
    const row = last("to_address = 'mail.person@example.com'");
    expect(row.title).toMatch(/^Ваш код для Custock: \d{6}$/);
    expect(row.html).toContain('<html lang="ru"');
    expect(row.html).toContain(`${WEB}/api/email/mark.png`);
    const raw = await rawMail(row);
    expect(raw).toMatch(/Content-Type: multipart\/alternative/);
    expect(raw).toMatch(/Content-Type: text\/plain; charset=utf-8/);
    expect(raw).toMatch(/Content-Type: text\/html; charset=utf-8/);
  });

  it('invites, join confirmations and email changes all carry html', async () => {
    const roles = await call('GET', `/v1/orgs/${s.orgId}/roles`, tokens.eleni);
    const staff = roles.body.find((r: Json) => r.templateKey === 'staff' || r.name === 'Staff').id;
    const inv = await call('POST', `/v1/orgs/${s.orgId}/invites`, tokens.eleni, { email: 'new.staff@example.com', roleId: staff, scopeType: 'shop', scopeId: s.shops.kifisia, locale: 'el' });
    const invite = last("to_address = 'new.staff@example.com'");
    expect(invite.html).toContain(`href="${inv.body.link}"`);
    expect(invite.html).toContain('Αποδοχή πρόσκλησης');
    await call('POST', '/v1/public/join/kif7q2', undefined, { name: 'Mira', email: 'mira@example.com', locale: 'en', emailNews: true, push: false, over15: true });
    const join = last("to_address = 'mira@example.com'");
    expect(join.title).toContain('Confirm you want news from');
    expect(join.html).toMatch(/href="https:\/\/orestislef\.gr\/custock\/confirm\/[^"]+"/);
    await call('POST', '/v1/me/email', tokens.maria, { email: 'maria.new@example.com', password: 'custock' });
    expect(last("to_address = 'maria.new@example.com'").html).toMatch(/user-select:all;">\d{6}<\/span>/);
  });

  it('an offer post email lists its products with prices and the unsubscribe headers', async () => {
    db.prepare('UPDATE organizations SET posts_need_approval = 0 WHERE id = ?').run(s.orgId);
    const variant = db.prepare('SELECT v.id, v.price_minor FROM product_variants v WHERE v.org_id = ? AND v.price_minor > 500 LIMIT 1').get(s.orgId) as Json;
    const post = await call('POST', `/v1/orgs/${s.orgId}/posts`, tokens.eleni, {
      kind: 'offer', defaultLocale: 'el', translations: { el: { title: 'Προσφορά', body: 'Κείμενο' }, en: { title: 'Offer', body: 'Text' }, ru: { title: 'Акция', body: 'Текст' } },
      channels: ['feed', 'email'], audience: { scopes: [{ scopeType: 'org', scopeId: s.orgId }] },
      products: [{ variantId: variant.id, offerPriceMinor: variant.price_minor - 200 }], validUntil: clock + 5 * 86_400_000,
    });
    expect((await call('POST', `/v1/orgs/${s.orgId}/posts/${post.body.id}/publish`, tokens.eleni)).status).toBe(200);
    await runJobs({ cfg: { db, jwtSecret: SECRET, publicWebUrl: WEB } }, clock);
    const row = last("channel = 'email' AND json_extract(payload, '$.postId') = ?", post.body.id);
    expect(row).toBeTruthy();
    expect(row.html).toMatch(/\/s\/lemoni\/p\/[0-9a-f-]{36}/);
    expect(row.html).toContain(`${WEB}/s/lemoni/news?post=${post.body.id}`);
    expect(row.html).toMatch(/href="https:\/\/orestislef\.gr\/custock\/unsubscribe\/[^"]+"/);
    const raw = (await rawMail(row)).replace(/\r\n[ \t]+/g, ' ');
    expect(raw).toMatch(/^List-Unsubscribe: <https:\/\/orestislef\.gr\/custock\/unsubscribe\/[^>]+>$/m);
    expect(raw).toMatch(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
  });

  it('serves the mark and the fonts, nothing else', async () => {
    const mark = await app.request('/email/mark.png');
    expect(mark.status).toBe(200);
    expect(mark.headers.get('Content-Type')).toBe('image/png');
    expect((await app.request('/email/commissioner-greek.woff2')).headers.get('Content-Type')).toBe('font/woff2');
    expect((await app.request('/email/..%2Fapp.ts')).status).toBe(404);
    expect((await app.request('/email/samples.ts')).status).toBe(404);
  });

  it('a dev preview lists every template, and shows each in light, dark and text', async () => {
    const index = await call('GET', '/v1/dev/emails');
    expect(index.status).toBe(200);
    for (const k of EMAIL_KINDS) expect(index.body).toContain(`emails/${k}?locale=ru&amp;scheme=dark`);
    const dark = await call('GET', '/v1/dev/emails/post?locale=el&scheme=dark');
    expect(dark.headers.get('Content-Type')).toContain('text/html');
    expect(dark.body).toContain('<html lang="el"');
    const text = await call('GET', '/v1/dev/emails/otp?locale=en&format=text');
    expect(text.body).toMatch(/^Subject: Your Custock code: 482913/);
    expect((await call('GET', '/v1/dev/emails/nope')).status).toBe(404);
    const prod = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], rateLimit: false });
    expect((await prod.request('/v1/dev/emails')).status).toBe(404);
  });
});

// ---------------------------------------------------------------- the first owner, invited

describe('first owner by invite', () => {
  let db: Db;
  let app: App;
  const call = caller(() => app);

  beforeAll(() => {
    db = openDb(':memory:');
    migrate(db);
    app = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], now: () => clock, rateLimit: false });
  });

  it('with mail live, create-business invites the owner instead of making a password', async () => {
    const live = { CUSTOCK_PUBLIC_WEB_URL: WEB, CUSTOCK_TRANSPORT: 'live', CUSTOCK_ALLOW_SENDING: 'yes', CUSTOCK_SMTP_URL: 'smtps://shop%40gmail.com:pw@smtp.gmail.com:465', CUSTOCK_MAIL_FROM: 'shop@gmail.com' };
    const out = io(live);
    expect(await runCli(db, ['create-business', '--name', 'Fourno', '--slug', 'fourno', '--owner-email', 'Baker@Example.com', '--shop', 'Center', '--locale', 'en'], out)).toBe(0);
    expect(out.lines[1]).toMatch(new RegExp(`^owner invite for baker@example\\.com: ${WEB.replace(/\./g, '\\.')}/invite/[A-Za-z0-9_-]{20,}$`));
    expect(out.lines[2]).toBe('emailed now. the link works for 14 days and once.');
    expect(db.prepare('SELECT 1 FROM users WHERE email = ?').get('baker@example.com')).toBeUndefined();
    const mail = db.prepare("SELECT * FROM dev_outbox WHERE to_address = 'baker@example.com'").get() as OutboxRow;
    expect(mail.title).toBe('Your Custock is ready');
    expect(mail.html).toContain('Fourno is ready');
    expect(mail.html).toContain('Set your password');
    expect(JSON.parse(mail.payload!).type).toBe('invite');

    const token = out.lines[1]!.split('/').pop()!;
    const preview = await call('GET', `/v1/invites/${token}`, undefined, undefined, { 'Accept-Language': 'en' });
    expect(preview.body).toMatchObject({ orgName: 'Fourno', scopeName: 'Fourno', roleName: 'Owner', email: 'baker@example.com', accountExists: false });
    const reg = await call('POST', '/v1/invites/register', undefined, { token, displayName: 'Bea Baker', password: 'fresh.bread.daily' });
    expect(reg.status).toBe(201);
    const me = await call('GET', '/v1/me/context', reg.body.accessToken);
    expect(me.body.orgs[0]).toMatchObject({ slug: 'fourno' });
    expect(me.body.orgs[0].orgPerms).toEqual(expect.arrayContaining(['shops.create', 'org.settings.manage']));
    expect(me.body.orgs[0].shops).toHaveLength(1);
    // the owner can now run the business: invite a manager
    const roles = await call('GET', `/v1/orgs/${reg.body.orgId}/roles`, reg.body.accessToken);
    const manager = roles.body.find((r: Json) => r.templateKey === 'manager' || r.name === 'Manager').id;
    const inv = await call('POST', `/v1/orgs/${reg.body.orgId}/invites`, reg.body.accessToken, { email: 'm@example.com', roleId: manager, scopeType: 'org', scopeId: reg.body.orgId, locale: 'en' });
    expect(inv.status).toBe(201);
    // nobody to tell that the owner accepted
    expect(db.prepare("SELECT count(*) n FROM dev_outbox WHERE json_extract(payload, '$.type') = 'inviteAccepted'").get()).toEqual({ n: 0 });
    // accepting made the business its join link for the shop page, once
    const pub = await call('GET', '/v1/public/orgs/fourno');
    expect(pub.body).toMatchObject({ slug: 'fourno', name: 'Fourno', joinCode: expect.stringMatching(/^[a-z0-9]{6}$/), logoUrl: null });
    expect((await call('GET', `/v1/public/join/${pub.body.joinCode}`)).status).toBe(200);
    const again = io({ CUSTOCK_PUBLIC_WEB_URL: WEB });
    expect(await runCli(db, ['add-join-link', '--org', 'fourno'], again)).toBe(0);
    expect(again.lines[0]).toBe('fourno already has a join link for the whole business');
    expect((db.prepare("SELECT count(*) n FROM join_links WHERE org_id = ? AND scope_type = 'org'").get(reg.body.orgId) as Json).n).toBe(1);
  });

  it('a business made with a password has its join link right away, an unknown slug is a 404', async () => {
    const out = io({ CUSTOCK_NEW_PASSWORD: 'long enough pass', CUSTOCK_PUBLIC_WEB_URL: WEB });
    expect(await runCli(db, ['create-business', '--name', 'Bakaliko', '--slug', 'bakaliko', '--owner-email', 'bk@example.com', '--owner-name', 'B'], out)).toBe(0);
    const link = db.prepare("SELECT label FROM join_links j JOIN organizations o ON o.id = j.org_id WHERE o.slug = 'bakaliko' AND j.scope_type = 'org'").get() as Json;
    expect(link.label).toBe('Shop page');
    expect((await call('GET', '/v1/public/orgs/nobody-here')).status).toBe(404);
    // a business whose owner has not accepted yet: no link, and add-join-link says why
    const pending = io({ CUSTOCK_PUBLIC_WEB_URL: WEB });
    expect(await runCli(db, ['create-business', '--name', 'Later', '--slug', 'later', '--owner-email', 'later@example.com', '--invite'], pending)).toBe(0);
    expect((await call('GET', '/v1/public/orgs/later')).body.joinCode).toBeNull();
    await expect(runCli(db, ['add-join-link', '--org', 'later'], io({ CUSTOCK_PUBLIC_WEB_URL: WEB }))).rejects.toThrow('no owner account yet');
  });

  it('without live mail the password mode stays the default, --invite asks for the link anyway', async () => {
    const plain = io({ CUSTOCK_NEW_PASSWORD: 'long enough pass', CUSTOCK_PUBLIC_WEB_URL: WEB });
    expect(await runCli(db, ['create-business', '--name', 'Kiosk', '--slug', 'kiosk', '--owner-email', 'k@example.com', '--owner-name', 'K'], plain)).toBe(0);
    expect(plain.lines[1]).toBe('owner k@example.com can sign in at /admin');
    const asked = io({ CUSTOCK_PUBLIC_WEB_URL: WEB });
    expect(await runCli(db, ['create-business', '--name', 'Bakery', '--slug', 'bakery', '--owner-email', 'b@example.com', '--invite'], asked)).toBe(0);
    expect(asked.lines[2]).toBe('mail is not live, so share the link by hand. it works for 14 days and once.');
    await expect(runCli(db, ['create-business', '--name', 'X', '--slug', 'xx', '--owner-email', 'x@example.com', '--invite'], io({}))).rejects.toThrow('CUSTOCK_PUBLIC_WEB_URL');
  });

  it('invite-owner makes a fresh link and the old one stops working', async () => {
    const first = io({ CUSTOCK_PUBLIC_WEB_URL: WEB });
    await runCli(db, ['invite-owner', '--org', 'bakery', '--email', 'b@example.com'], first);
    const again = io({ CUSTOCK_PUBLIC_WEB_URL: WEB });
    await runCli(db, ['invite-owner', '--org', 'bakery', '--email', 'b@example.com'], again);
    const oldToken = first.lines[0]!.split('/').pop()!;
    const newToken = again.lines[0]!.split('/').pop()!;
    expect((await call('GET', `/v1/invites/${oldToken}`)).status).toBe(410);
    expect((await call('GET', `/v1/invites/${newToken}`)).status).toBe(200);
    await expect(runCli(db, ['invite-owner', '--org', 'nope', '--email', 'b@example.com'], io({ CUSTOCK_PUBLIC_WEB_URL: WEB }))).rejects.toThrow('no business');
  });
});
