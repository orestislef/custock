// stateless unsubscribe tokens for email links: customer id + scope, signed with the server secret

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface UnsubTarget {
  customerId: string;
  scopeType: 'org' | 'group' | 'shop';
  scopeId: string;
}

// its own key: CUSTOCK_UNSUB_SECRET, or one derived from the jwt secret so the two never match
export function unsubKey(cfg: { jwtSecret: string; unsubSecret?: string }): string {
  return cfg.unsubSecret ?? createHmac('sha256', cfg.jwtSecret).update('custock unsubscribe links').digest('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 32);
}

export function unsubToken(target: UnsubTarget, secret: string): string {
  const payload = Buffer.from(`${target.customerId}|${target.scopeType}|${target.scopeId}`).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function readUnsubToken(token: string, secret: string): UnsubTarget | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  const [customerId, scopeType, scopeId] = Buffer.from(payload, 'base64url').toString('utf8').split('|');
  if (!customerId || !scopeId || !['org', 'group', 'shop'].includes(scopeType ?? '')) return null;
  return { customerId, scopeType: scopeType as UnsubTarget['scopeType'], scopeId };
}
