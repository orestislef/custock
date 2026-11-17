// the live transports: FCM HTTP v1 for push and SMTP for email. they only ever run with
// CUSTOCK_TRANSPORT=live, the credentials present and CUSTOCK_ALLOW_SENDING=yes (see main.ts).
// the worker drains the outbox table through them. building the messages is pure and tested.

import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';
import nodemailer, { type Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import type { Db } from '@custock/db';
import { parseJson, platform } from './tenant';

export interface OutboxRow {
  id: string;
  channel: 'email' | 'push' | 'sms';
  org_id: string | null;
  user_id: string | null;
  customer_id: string | null;
  to_address: string | null;
  locale: string | null;
  title: string | null;
  body: string | null;
  payload: string | null;
  created_at: number;
}

interface Payload {
  type?: string;
  threadId?: string;
  link?: string | null;
  image?: string | null;
  silent?: boolean;
  fromName?: string;
  replyTo?: string | null;
  listUnsubscribe?: string;
  listUnsubscribePost?: string;
  [k: string]: unknown;
}

// FCM data values must be strings
function dataOf(p: Payload): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v == null || ['fromName', 'replyTo', 'listUnsubscribe', 'listUnsubscribePost', 'silent'].includes(k)) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

// one FCM v1 message for one device token
export function buildFcmMessage(row: OutboxRow, token: string): Record<string, unknown> {
  const p = parseJson<Payload>(row.payload, {});
  const data = dataOf(p);
  if (p.silent) {
    // data only: the app refreshes in the background
    return {
      message: {
        token,
        data,
        android: { priority: 'high' },
        apns: { headers: { 'apns-push-type': 'background', 'apns-priority': '5' }, payload: { aps: { 'content-available': 1 } } },
      },
    };
  }
  const image = p.image ?? undefined;
  return {
    message: {
      token,
      notification: { title: row.title ?? '', body: row.body ?? '', ...(image ? { image } : {}) },
      data,
      android: {
        priority: 'high',
        notification: { channel_id: p.type === 'post' ? 'posts' : 'alerts', ...(image ? { image } : {}), tag: p.threadId ?? undefined },
      },
      apns: {
        payload: { aps: { 'thread-id': p.threadId ?? row.org_id ?? 'custock', 'mutable-content': image ? 1 : 0, sound: 'default' } },
        ...(image ? { fcm_options: { image } } : {}),
      },
    },
  };
}

// the email, ready for nodemailer. the sender address is ours, the name and reply-to are the shop's.
export function buildEmail(row: OutboxRow, fromAddress: string): Mail.Options {
  const p = parseJson<Payload>(row.payload, {});
  const headers: Record<string, string> = row.locale ? { 'Content-Language': row.locale } : {};
  if (p.listUnsubscribe) {
    headers['List-Unsubscribe'] = `<${p.listUnsubscribe}>`;
    headers['List-Unsubscribe-Post'] = p.listUnsubscribePost ?? 'List-Unsubscribe=One-Click';
  }
  return {
    from: { name: p.fromName ?? 'Custock', address: fromAddress },
    to: row.to_address ?? undefined,
    ...(p.replyTo ? { replyTo: p.replyTo } : {}),
    subject: row.title ?? '',
    text: row.body ?? '',
    headers,
  };
}

export interface LiveSender {
  push(row: OutboxRow, token: string): Promise<{ ok: true } | { ok: false; unregistered: boolean; error: string }>;
  email(row: OutboxRow): Promise<void>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

// a sender talking to Google and an SMTP server. never built in tests or in outbox mode.
export function createLiveSender(opts: { serviceAccountPath: string; smtpUrl: string; mailFrom: string }): LiveSender {
  const sa = JSON.parse(readFileSync(opts.serviceAccountPath, 'utf8')) as ServiceAccount;
  const mailer: Transporter = nodemailer.createTransport(opts.smtpUrl);
  let cached: { token: string; until: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.until > Date.now() + 60_000) return cached.token;
    const key = await importPKCS8(sa.private_key, 'RS256');
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(sa.client_email)
      .setAudience(sa.token_uri ?? 'https://oauth2.googleapis.com/token')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const res = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: json.access_token, until: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  return {
    async push(row, token) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildFcmMessage(row, token)),
      });
      if (res.ok) return { ok: true };
      const text = await res.text();
      return { ok: false, unregistered: res.status === 404 || text.includes('UNREGISTERED'), error: `${res.status} ${text.slice(0, 200)}` };
    },
    async email(row) {
      await mailer.sendMail(buildEmail(row, opts.mailFrom));
    },
  };
}

// sends what is waiting. push goes to every live device of the user, a dead token is revoked.
export async function drainOutbox(db: Db, sender: LiveSender, now: number, limit = 200): Promise<{ sent: number; failed: number }> {
  const p = platform(db);
  const rows = p.all<OutboxRow>(
    `SELECT id, channel, org_id, user_id, customer_id, to_address, locale, title, body, payload, created_at
       FROM dev_outbox WHERE sent_at IS NULL AND attempts < 5 ORDER BY created_at LIMIT @lim`,
    { lim: limit },
  );
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (row.channel === 'email' && row.to_address) {
        await sender.email(row);
      } else if (row.channel === 'push') {
        const userId = row.user_id ?? (row.customer_id ? p.get<{ user_id: string | null }>('SELECT user_id FROM customers WHERE id = @c', { c: row.customer_id })?.user_id ?? null : null);
        const devices = userId
          ? p.all<{ id: string; fcm_token: string }>('SELECT id, fcm_token FROM devices WHERE user_id = @u AND revoked_at IS NULL AND fcm_token IS NOT NULL', { u: userId })
          : [];
        for (const d of devices) {
          const r = await sender.push(row, d.fcm_token);
          if (!r.ok && r.unregistered) p.run('UPDATE devices SET fcm_token = NULL, revoked_at = @now WHERE id = @id', { now, id: d.id });
          else if (!r.ok) throw new Error(r.error);
        }
      }
      p.run('UPDATE dev_outbox SET sent_at = @now, attempts = attempts + 1, last_error = NULL WHERE id = @id', { now, id: row.id });
      sent++;
    } catch (err) {
      p.run('UPDATE dev_outbox SET attempts = attempts + 1, last_error = @e WHERE id = @id', { e: String(err).slice(0, 500), id: row.id });
      failed++;
    }
  }
  return { sent, failed };
}

// what live mode needs before it may start. returns the problems, empty when all is there.
export function liveProblems(env: NodeJS.ProcessEnv, exists: (path: string) => boolean): string[] {
  const out: string[] = [];
  if (env.CUSTOCK_ALLOW_SENDING !== 'yes') out.push('CUSTOCK_ALLOW_SENDING=yes is not set');
  if (!env.CUSTOCK_FCM_SERVICE_ACCOUNT) out.push('CUSTOCK_FCM_SERVICE_ACCOUNT (path to the service account json) is not set');
  else if (!exists(env.CUSTOCK_FCM_SERVICE_ACCOUNT)) out.push('CUSTOCK_FCM_SERVICE_ACCOUNT points to a missing file');
  if (!env.CUSTOCK_SMTP_URL) out.push('CUSTOCK_SMTP_URL (smtps://user:pass@host:465) is not set');
  if (!env.CUSTOCK_MAIL_FROM) out.push('CUSTOCK_MAIL_FROM (the sender address) is not set');
  return out;
}
