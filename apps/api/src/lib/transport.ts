// outgoing messages. everything is written to the outbox table first. in live mode the worker
// sends unsent rows (lib/live.ts), otherwise nothing ever leaves the machine.

import { maskEmail, uuidv7 } from '@custock/core';
import type { Db } from '@custock/db';
import { platform } from './tenant';
import { pushDecorations, pushUrl } from './webpush';
import type { RenderedEmail } from '../email/layout';

export interface OutgoingMessage {
  channel: 'email' | 'push' | 'sms';
  orgId?: string | null;
  userId?: string | null;
  customerId?: string | null;
  to?: string | null;
  locale?: string | null;
  title: string;
  // the plain text. emails also carry html, push never
  body: string;
  html?: string | null;
  payload?: Record<string, unknown>;
}

export interface Transport {
  send(msg: OutgoingMessage): { id: string };
}

export function devOutboxTransport(db: Db, log: (line: string) => void = (l) => console.log(l)): Transport {
  return {
    send(msg) {
      const id = uuidv7();
      // a visible push carries the page a tap opens, on the web app (CUSTOCK_PUBLIC_WEB_URL)
      if (msg.channel === 'push' && !msg.payload?.silent && !msg.payload?.url) {
        msg = { ...msg, payload: { ...(msg.payload ?? {}), url: pushUrl(db, msg.orgId ?? null, !!msg.customerId, msg.payload ?? {}) } };
      }
      // the business's icon and the buttons, unless the sender chose its own
      if (msg.channel === 'push' && !msg.payload?.silent) {
        const deco = pushDecorations(db, msg.orgId ?? null, !!msg.customerId, msg.locale ?? null, msg.payload ?? {});
        msg = { ...msg, payload: { icon: deco.icon, actions: deco.actions, ...(msg.payload ?? {}) } };
      }
      platform(db).run(
        `INSERT INTO dev_outbox (id, channel, org_id, user_id, customer_id, to_address, locale, title, body, html, payload, created_at)
         VALUES (@id, @channel, @org, @user, @customer, @to, @locale, @title, @body, @html, @payload, @now)`,
        {
          id, channel: msg.channel, org: msg.orgId ?? null, user: msg.userId ?? null, customer: msg.customerId ?? null,
          to: msg.to ?? null, locale: msg.locale ?? null, title: msg.title, body: msg.body, html: msg.channel === 'email' ? msg.html ?? null : null,
          payload: msg.payload ? JSON.stringify(msg.payload) : null, now: Date.now(),
        },
      );
      // logs never carry an address or a subject (subjects can hold sign in codes): a masked
      // address and the kind of message are enough to follow what happens
      const kind = typeof msg.payload?.type === 'string' ? msg.payload.type : 'message';
      log(`[outbox] ${msg.channel} to ${maskEmail(msg.to) ?? (msg.customerId ? 'customer' : msg.userId ? 'user' : '?')}: ${kind}`);
      return { id };
    },
  };
}

// an email from a rendered template: subject, plain text and html together
export function emailMessage(r: RenderedEmail, m: Omit<OutgoingMessage, 'channel' | 'title' | 'body' | 'html'>): OutgoingMessage {
  return { ...m, channel: 'email', title: r.subject, body: r.text, html: r.html };
}
