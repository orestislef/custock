// scrypt password hashes for the dev login provider. format: scrypt$N$r$p$salt$hash (base64)

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

// 2^15. older hashes keep the N they were made with
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 128 * N * R * 2;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const nn = Number(n);
  const rr = Number(r);
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: nn, r: rr, p: Number(p), maxmem: 128 * nn * rr * 2 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// tokens (refresh, invite, join confirm, otp) are stored as sha-256 hashes only
export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// spends the same time as a real check, so unknown emails do not answer faster
let dummy: string | null = null;
export function burnPasswordCheck(password: string): void {
  dummy ??= hashPassword('not-a-real-password');
  verifyPassword(password, dummy);
}
