// the live transports: web push (VAPID) and FCM HTTP v1 for push, SMTP for email. they only ever
// run with CUSTOCK_TRANSPORT=live and CUSTOCK_ALLOW_SENDING=yes, and each one only when its own
// settings are there (see liveChannels). the worker drains the outbox table through them.
// building the messages is pure and tested.

import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';
import nodemailer, { type Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import webpush from 'web-push';
import { isPushServiceEndpoint } from '@custock/core';
import type { Db } from '@custock/db';
import { parseJson, platform } from './tenant';
import { sendGate } from './platform-access';
import { ACCOUNT_SAFETY_MAIL } from './account-safety';
import { buildWebPush, subscriptionsFor, vapidProblems, type VapidConfig } from './webpush';
import { captureError } from './errors';

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
  html?: string | null;
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
    ...(row.html ? { html: row.html } : {}),
    headers,
  };
}

export type PushResult = { ok: true } | { ok: false; unregistered: boolean; error: string };

export interface WebPushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

// each channel is there only when it is live. a missing one leaves its rows in the outbox.
export interface LiveSender {
  push?(row: OutboxRow, token: string): Promise<PushResult>;
  webpush?(row: OutboxRow, sub: WebPushTarget): Promise<PushResult>;
  email?(row: OutboxRow): Promise<void>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface LiveChannels {
  fcm?: { serviceAccountPath: string };
  smtp?: { url: string; from: string };
  vapid?: VapidConfig;
}

function fcmSender(serviceAccountPath: string): NonNullable<LiveSender['push']> {
  const sa = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as ServiceAccount;
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

  return async (row, token) => {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildFcmMessage(row, token)),
    });
    if (res.ok) return { ok: true };
    const text = await res.text();
    return { ok: false, unregistered: res.status === 404 || text.includes('UNREGISTERED'), error: `${res.status} ${text.slice(0, 200)}` };
  };
}

// the request web-push would make, without making it. tests read the headers from here.
export function webPushRequest(row: OutboxRow, sub: WebPushTarget, vapid: VapidConfig) {
  const msg = buildWebPush(row);
  if (!msg) return null;
  return webpush.generateRequestDetails({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, msg.payload, {
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    TTL: msg.options.TTL,
    urgency: msg.options.urgency,
    topic: msg.options.topic,
  });
}

function webPushSender(vapid: VapidConfig): NonNullable<LiveSender['webpush']> {
  return async (row, sub) => {
    // stored endpoints were checked on the way in. checked again, the server never calls anywhere else
    if (!isPushServiceEndpoint(sub.endpoint)) return { ok: false, unregistered: true, error: 'endpoint is not a push service' };
    const msg = buildWebPush(row);
    if (!msg) return { ok: true };
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, msg.payload, {
        vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        TTL: msg.options.TTL,
        urgency: msg.options.urgency,
        topic: msg.options.topic,
        timeout: 10_000,
      });
      return { ok: true };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 0;
      return { ok: false, unregistered: status === 404 || status === 410, error: `${status} ${String((err as { body?: string }).body ?? err).slice(0, 200)}` };
    }
  };
}

// the senders for the channels that are set up. never built in tests or in outbox mode.
export function createLiveSender(ch: LiveChannels): LiveSender {
  const sender: LiveSender = {};
  if (ch.fcm) sender.push = fcmSender(ch.fcm.serviceAccountPath);
  if (ch.vapid) sender.webpush = webPushSender(ch.vapid);
  if (ch.smtp) {
    const mailer: Transporter = nodemailer.createTransport(ch.smtp.url);
    const from = ch.smtp.from;
    sender.email = async (row) => {
      await mailer.sendMail(buildEmail(row, from));
    };
  }
  return sender;
}

// sends what is waiting, for the channels that are live. a push goes to every live phone of the
// user and every web push subscription for this business, dead ones are dropped. a row counts as
// sent when it reached at least one target, or there was none; it is retried when every target
// failed for a passing reason.
export async function drainOutbox(db: Db, sender: LiveSender, now: number, limit = 200): Promise<{ sent: number; failed: number }> {
  const p = platform(db);
  const channels = [sender.email ? 'email' : null, sender.push || sender.webpush ? 'push' : null].filter(Boolean);
  if (!channels.length) return { sent: 0, failed: 0 };
  const rows = p.all<OutboxRow>(
    `SELECT id, channel, org_id, user_id, customer_id, to_address, locale, title, body, html, payload, created_at
       FROM dev_outbox WHERE sent_at IS NULL AND attempts < 5 AND channel IN (SELECT value FROM json_each(@ch)) ORDER BY created_at LIMIT @lim`,
    { lim: limit, ch: channels },
  );
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    // a platform pause holds the message, a paused business or a switched off channel drops it
    const held = sendGate(db, row.channel, row.org_id);
    // account safety mail (forgot password) goes out during a platform wide email pause too
    const safety = row.channel === 'email' && ACCOUNT_SAFETY_MAIL.has(String(parseJson<{ type?: string }>(row.payload, {}).type));
    const gate = held === 'hold' && safety ? null : held;
    if (gate === 'hold') continue;
    if (gate) {
      p.run('UPDATE dev_outbox SET attempts = 5, last_error = @e WHERE id = @id', { e: gate, id: row.id });
      continue;
    }
    try {
      if (row.channel === 'email' && row.to_address && sender.email) {
        await sender.email(row);
      } else if (row.channel === 'push') {
        const userId = row.user_id ?? (row.customer_id ? p.get<{ user_id: string | null }>('SELECT user_id FROM customers WHERE id = @c', { c: row.customer_id })?.user_id ?? null : null);
        let reached = 0;
        const errors: string[] = [];
        if (userId && sender.push) {
          const devices = p.all<{ id: string; fcm_token: string }>('SELECT id, fcm_token FROM devices WHERE user_id = @u AND revoked_at IS NULL AND fcm_token IS NOT NULL', { u: userId });
          for (const d of devices) {
            const r = await sender.push(row, d.fcm_token);
            if (r.ok) reached++;
            else if (r.unregistered) p.run('UPDATE devices SET fcm_token = NULL, revoked_at = @now WHERE id = @id', { now, id: d.id });
            else errors.push(r.error);
          }
        }
        const silent = parseJson<{ silent?: boolean }>(row.payload, {}).silent;
        if (userId && sender.webpush && !silent) {
          for (const s of subscriptionsFor(db, userId, row.org_id)) {
            const r = await sender.webpush(row, s);
            if (r.ok) {
              reached++;
              p.run('UPDATE push_subscriptions SET last_ok_at = @now, failures = 0 WHERE id = @id', { now, id: s.id });
            } else if (r.unregistered) {
              p.run('DELETE FROM push_subscriptions WHERE id = @id', { id: s.id });
            } else {
              errors.push(r.error);
              // a subscription that keeps failing is dropped after a while
              p.run('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = @id', { id: s.id });
              p.run('DELETE FROM push_subscriptions WHERE id = @id AND failures >= 20', { id: s.id });
            }
          }
        }
        if (!reached && errors.length) throw new Error(errors[0]);
      }
      p.run('UPDATE dev_outbox SET sent_at = @now, attempts = attempts + 1, last_error = NULL WHERE id = @id', { now, id: row.id });
      sent++;
    } catch (err) {
      p.run('UPDATE dev_outbox SET attempts = attempts + 1, last_error = @e WHERE id = @id', { e: String(err).slice(0, 500), id: row.id });
      failed++;
      captureError(db, { kind: 'send', error: err, route: `send ${row.channel}`, orgId: row.org_id }, { now });
    }
  }
  return { sent, failed };
}

// smtp://user:pass@host:port or smtps://... with the user url encoded (user%40gmail.com)
export function smtpProblems(url: string | undefined, from: string | undefined): string[] {
  const out: string[] = [];
  let u: URL | null = null;
  try {
    u = url ? new URL(url) : null;
  } catch {
    u = null;
  }
  if (!u || !['smtp:', 'smtps:'].includes(u.protocol) || !u.hostname) out.push('CUSTOCK_SMTP_URL must look like smtps://user%40gmail.com:app-password@smtp.gmail.com:465');
  else if (u.username && !u.password) out.push('CUSTOCK_SMTP_URL has a user but no password');
  else {
    try {
      decodeURIComponent(u.username);
      decodeURIComponent(u.password);
    } catch {
      out.push('CUSTOCK_SMTP_URL has a broken %-escape in the user or password');
    }
  }
  if (!from || !/^[^@\s]+@[^@\s]+$/.test(from)) out.push('CUSTOCK_MAIL_FROM (the sender address) must be set');
  return out;
}

// which channels may send, from the environment. a channel with none of its settings is off and
// stays in the outbox. a channel with some but not all, or wrong ones, is a problem: live mode
// refuses to start rather than half work. lines are for the startup log, one per channel.
export function liveChannels(env: NodeJS.ProcessEnv, exists: (path: string) => boolean): { problems: string[]; channels: LiveChannels; lines: string[] } {
  const problems: string[] = [];
  const lines: string[] = [];
  const channels: LiveChannels = {};
  if (env.CUSTOCK_ALLOW_SENDING !== 'yes') problems.push('CUSTOCK_ALLOW_SENDING=yes is not set');

  // the keys turn the channel on, a subject alone (as in env.example) does not
  const vapidSet = !!(env.CUSTOCK_VAPID_PUBLIC_KEY || env.CUSTOCK_VAPID_PRIVATE_KEY);
  if (!vapidSet) lines.push('web push: off, stays in the outbox (no CUSTOCK_VAPID_* settings)');
  else {
    const v = { publicKey: env.CUSTOCK_VAPID_PUBLIC_KEY, privateKey: env.CUSTOCK_VAPID_PRIVATE_KEY, subject: env.CUSTOCK_VAPID_SUBJECT };
    const pr = vapidProblems(v);
    if (pr.length) problems.push(...pr);
    else {
      channels.vapid = v as VapidConfig;
      lines.push(`web push: live (VAPID, subject ${v.subject})`);
    }
  }

  if (!env.CUSTOCK_FCM_SERVICE_ACCOUNT) lines.push('fcm: off, stays in the outbox (no CUSTOCK_FCM_SERVICE_ACCOUNT)');
  else if (!exists(env.CUSTOCK_FCM_SERVICE_ACCOUNT)) problems.push('CUSTOCK_FCM_SERVICE_ACCOUNT points to a missing file');
  else {
    channels.fcm = { serviceAccountPath: env.CUSTOCK_FCM_SERVICE_ACCOUNT };
    lines.push('fcm: live (Firebase service account)');
  }

  if (!env.CUSTOCK_SMTP_URL && !env.CUSTOCK_MAIL_FROM) lines.push('email: off, stays in the outbox (no CUSTOCK_SMTP_URL)');
  else {
    const pr = smtpProblems(env.CUSTOCK_SMTP_URL, env.CUSTOCK_MAIL_FROM);
    if (pr.length) problems.push(...pr);
    else {
      channels.smtp = { url: env.CUSTOCK_SMTP_URL!, from: env.CUSTOCK_MAIL_FROM! };
      lines.push(`email: live via ${new URL(env.CUSTOCK_SMTP_URL!).host} from ${env.CUSTOCK_MAIL_FROM}`);
    }
  }

  if (!problems.length && !channels.vapid && !channels.fcm && !channels.smtp) problems.push('no channel is set up (VAPID, FCM or SMTP)');
  return { problems, channels, lines };
}
