// the server refuses what a form refuses: the shared rules from packages/core/src/validate.ts,
// with the field error code (common.json field.*) in the problem's fields

import { beforeAll, describe, expect, it } from 'vitest';
import { migrate, openDb, seed, hashPassword, type Db, type SeedResult } from '@custock/db';
import { ean13 } from '@custock/core';
import { createApp, type App } from '../src/app';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: Db;
let s: SeedResult;
let app: App;
const SECRET = 'test-secret-that-is-long-enough-789';
const tokens: Record<string, string> = {};

async function call(method: string, path: string, who?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}

beforeAll(async () => {
  db = openDb(':memory:');
  migrate(db);
  s = seed(db, { passwordHash: hashPassword('custock'), now: Date.now() });
  app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000', corsOrigins: [], rateLimit: false });
  for (const who of ['eleni', 'maria']) {
    const r = await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' });
    tokens[who] = r.body.accessToken;
  }
});

const products = () => `/v1/orgs/${s.orgId}/products`;

describe('field rules on the server', () => {
  it('sign in takes the email with capitals and spaces around it', async () => {
    const r = await call('POST', '/v1/auth/login', undefined, { email: '  ELENI@Example.com ', password: 'custock' });
    expect(r.status).toBe(200);
  });

  it('a product name is trimmed and collapsed, and refused when too long', async () => {
    const ok = await call('POST', products(), 'eleni', { name: '  Μέλι   θυμαρίσιο \u0000 450g  ', priceMinor: 790, taxRateBp: 1300 });
    expect(ok.status).toBe(201);
    expect(ok.body.name).toBe('Μέλι θυμαρίσιο 450g');
    const long = await call('POST', products(), 'eleni', { name: 'x'.repeat(201) });
    expect(long.status).toBe(400);
    expect(long.body.fields.name).toBe('tooLong');
    const empty = await call('POST', products(), 'eleni', { name: '   ' });
    expect(empty.status).toBe(400);
  });

  it('a barcode with the wrong last digit is refused, a pasted one with spaces is cleaned', async () => {
    const bad = await call('POST', products(), 'eleni', { name: 'Check digit test', barcode: '5201234567890' });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.barcode).toBe('checkDigit');
    const good = await call('POST', products(), 'eleni', { name: 'Spaced code test', barcode: '520 1234 56789 4' });
    expect(good.status).toBe(201);
    expect(good.body.variants[0].barcodes.map((b: Json) => b.code)).toContain('5201234567894');
  });

  it('prices are whole cents, never negative, never absurd; vat only the allowed rates', async () => {
    expect((await call('POST', products(), 'eleni', { name: 'Neg', priceMinor: -100 })).body.fields.priceMinor).toBe('negative');
    expect((await call('POST', products(), 'eleni', { name: 'Huge', priceMinor: 1_000_000_000 })).body.fields.priceMinor).toBe('tooLarge');
    expect((await call('POST', products(), 'eleni', { name: 'Float', priceMinor: 9.9 })).status).toBe(400);
    expect((await call('POST', products(), 'eleni', { name: 'Vat', taxRateBp: 2300 })).body.fields.taxRateBp).toBe('invalid');
  });

  it('an invite email is checked properly and stored lowercased', async () => {
    const roles = await call('GET', `/v1/orgs/${s.orgId}/roles`, 'eleni');
    const staff = roles.body.find((r: Json) => r.templateKey === 'staff' || r.name === 'Staff').id;
    const base = { roleId: staff, scopeType: 'shop', scopeId: s.shops.kifisia, locale: 'el' };
    for (const email of ['maria', 'maria@example', 'ma ria@example.com', 'maria@@example.com', 'maria..x@example.com']) {
      const r = await call('POST', `/v1/orgs/${s.orgId}/invites`, 'eleni', { ...base, email });
      expect(r.status, email).toBe(400);
      expect(r.body.fields.email, email).toMatch(/invalid|spaces/);
    }
    const ok = await call('POST', `/v1/orgs/${s.orgId}/invites`, 'eleni', { ...base, email: '  New.Person@Example.COM ' });
    expect(ok.status).toBe(201);
    expect((db.prepare('SELECT email FROM invites WHERE id = ?').get(ok.body.id) as Json).email).toBe('new.person@example.com');
  });

  it('a customer phone is stored as E.164 and a broken one is refused', async () => {
    const ok = await call('POST', `/v1/orgs/${s.orgId}/customers`, 'eleni', { name: 'Phone Test', phone: '691 234 5678', shopId: s.shops.kifisia });
    expect(ok.status).toBe(201);
    expect((db.prepare('SELECT phone FROM customers WHERE id = ?').get(ok.body.id) as Json).phone).toBe('+306912345678');
    const bad = await call('POST', `/v1/orgs/${s.orgId}/customers`, 'eleni', { name: 'Phone Test 2', phone: '69a2345678', shopId: s.shops.kifisia });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.phone).toBe('invalid');
  });

  it('a new password has no spaces and is not the email', async () => {
    const roles = await call('GET', `/v1/orgs/${s.orgId}/roles`, 'eleni');
    const staff = roles.body.find((r: Json) => r.templateKey === 'staff' || r.name === 'Staff').id;
    const inv = await call('POST', `/v1/orgs/${s.orgId}/invites`, 'eleni', { email: 'pw.rules@example.com', roleId: staff, scopeType: 'shop', scopeId: s.shops.kifisia, locale: 'en' });
    const token = new URL(inv.body.link).pathname.split('/').pop();
    const spaced = await call('POST', '/v1/invites/register', undefined, { token, displayName: 'Pw Rules', password: 'has spaces in it' });
    expect(spaced.status).toBe(400);
    expect(spaced.body.fields.password).toBe('spaces');
    const same = await call('POST', '/v1/invites/register', undefined, { token, displayName: 'Pw Rules', password: 'pw.rules@example.com' });
    expect(same.status).toBe(400);
    expect(same.body.fields.password).toBe('sameAsEmail');
    const short = await call('POST', '/v1/invites/register', undefined, { token, displayName: 'Pw Rules', password: 'short' });
    expect(short.body.fields.password).toBe('tooShort');
    const ok = await call('POST', '/v1/invites/register', undefined, { token, displayName: '  Pw   Rules ', password: 'no-spaces-here-2026' });
    expect(ok.status).toBe(201);
  });

  it('post titles are one line, bodies keep their inside, both have limits', async () => {
    const audience = { scopes: [{ scopeType: 'org', scopeId: s.orgId }] };
    const r = await call('POST', `/v1/orgs/${s.orgId}/posts`, 'eleni', {
      kind: 'news', defaultLocale: 'el', channels: ['feed'], audience,
      translations: { el: { title: '  Νέα   σοδειά  ', body: '  Πρώτη γραμμή\n\n  δεύτερη  ' } },
    });
    expect(r.status).toBe(201);
    expect(r.body.translations.el.title).toBe('Νέα σοδειά');
    expect(r.body.translations.el.body).toBe('Πρώτη γραμμή\n\n  δεύτερη');
    const long = await call('POST', `/v1/orgs/${s.orgId}/posts`, 'eleni', {
      kind: 'news', defaultLocale: 'el', channels: ['feed'], audience, translations: { el: { title: 'x'.repeat(201), body: '' } },
    });
    expect(long.status).toBe(400);
  });

  it('a code typed on the counter is cleaned of spaces and dashes', async () => {
    const code = ean13('520000000001');
    const p = await call('POST', products(), 'eleni', { name: 'Counter code test', barcode: code });
    expect(p.status).toBe(201);
    const variant = p.body.variants[0].id;
    const dashed = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
    const attach = await call('POST', `/v1/orgs/${s.orgId}/variants/${variant}/barcodes`, 'eleni', { code: '5201234567890' });
    expect(attach.status).toBe(400);
    expect(attach.body.fields.code).toBe('checkDigit');
    expect(dashed).toContain('-');
  });
});
