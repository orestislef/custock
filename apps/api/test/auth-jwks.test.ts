// tokens from an outside login server, checked through a JWKS. keys are made here, nothing leaves
// the machine.

import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { migrate, openDb, seed, hashPassword, type Db, type SeedResult } from '@custock/db';
import { createApp, type App } from '../src/app';

const ISSUER = 'https://login.example.com';
const AUDIENCE = 'custock';
let db: Db;
let s: SeedResult;
let app: App;
let rsa: CryptoKey;
let ec: CryptoKey;
let stranger: CryptoKey;
const clock = Date.now();

async function token(key: CryptoKey, alg: 'RS256' | 'ES256', kid: string, claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string | number } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg, kid })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt(Math.floor(clock / 1000))
    .setExpirationTime(opts.exp ?? Math.floor(clock / 1000) + 600)
    .sign(key);
}

async function me(tok: string) {
  const res = await app.request('/v1/me/context', { headers: { Authorization: `Bearer ${tok}` } });
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeAll(async () => {
  db = openDb(':memory:');
  migrate(db);
  s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
  const r = await generateKeyPair('RS256');
  const e = await generateKeyPair('ES256');
  const x = await generateKeyPair('RS256');
  rsa = r.privateKey;
  ec = e.privateKey;
  stranger = x.privateKey;
  const jwks = {
    keys: [
      { ...(await exportJWK(r.publicKey)), kid: 'rsa-1', alg: 'RS256', use: 'sig' },
      { ...(await exportJWK(e.publicKey)), kid: 'ec-1', alg: 'ES256', use: 'sig' },
    ],
  };
  app = createApp({
    db, dev: false, jwtSecret: 'unused-in-jwks-mode-but-long-enough-000', publicWebUrl: 'http://localhost:3000', corsOrigins: [], rateLimit: false, now: () => clock,
    auth: { mode: 'jwks', issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet(jwks) },
  });
});

describe('external login server', () => {
  it('a known subject maps to the existing user and their memberships', async () => {
    const r = await me(await token(rsa, 'RS256', 'rsa-1', { sub: s.users.eleni }));
    expect(r.status).toBe(200);
    expect(r.body.orgs[0].orgPerms).toContain('org.settings.manage');
  });
  it('a new subject gets a user row on first sight, linked to customer records with the same confirmed email', async () => {
    const email = (db.prepare("SELECT email FROM customers WHERE org_id = ? AND user_id IS NULL AND email_verified_at IS NOT NULL LIMIT 1").get(s.orgId) as { email: string }).email;
    const r = await me(await token(ec, 'ES256', 'ec-1', { sub: 'ext-123', email: email.toUpperCase(), email_verified: true, name: 'Ext Person', locale: 'ru-RU' }));
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: 'ext-123', email, displayName: 'Ext Person', locale: 'ru' });
    expect(r.body.following.map((f: { orgName: string }) => f.orgName)).toEqual(['Lemoni']);
  });
  it('an email already used by another account is not taken over', async () => {
    const r = await me(await token(rsa, 'RS256', 'rsa-1', { sub: 'ext-456', email: 'eleni@example.com', email_verified: true }));
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBeNull();
    expect(r.body.orgs).toEqual([]);
  });
  it('wrong issuer, wrong audience, expired, unknown key or our own HS256 tokens are refused', async () => {
    expect((await me(await token(rsa, 'RS256', 'rsa-1', { sub: s.users.eleni }, { iss: 'https://evil.example.com' }))).status).toBe(401);
    expect((await me(await token(rsa, 'RS256', 'rsa-1', { sub: s.users.eleni }, { aud: 'other-app' }))).status).toBe(401);
    expect((await me(await token(rsa, 'RS256', 'rsa-1', { sub: s.users.eleni }, { exp: Math.floor(clock / 1000) - 10 }))).status).toBe(401);
    expect((await me(await token(stranger, 'RS256', 'rsa-1', { sub: s.users.eleni }))).status).toBe(401);
    const hs = await new SignJWT({ sid: 'x' }).setProtectedHeader({ alg: 'HS256' }).setSubject(s.users.eleni!).setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime('5m').sign(new TextEncoder().encode('unused-in-jwks-mode-but-long-enough-000'));
    expect((await me(hs)).status).toBe(401);
    expect((await me(await token(rsa, 'RS256', 'rsa-1', {}))).status).toBe(401);
  });
  it('our own login endpoints are gone in this mode', async () => {
    const res = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'eleni@example.com', password: 'custock' }) });
    expect(res.status).toBe(404);
  });
});
