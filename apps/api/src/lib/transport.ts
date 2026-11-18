// outgoing messages. everything is written to the outbox table first. in live mode the worker
// sends unsent rows (lib/live.ts), otherwise nothing ever leaves the machine.

import { uuidv7 } from '@custock/core';
import type { Db } from '@custock/db';
import { platform } from './tenant';
import { pushUrl } from './webpush';

export interface OutgoingMessage {
  channel: 'email' | 'push' | 'sms';
  orgId?: string | null;
  userId?: string | null;
  customerId?: string | null;
  to?: string | null;
  locale?: string | null;
  title: string;
  body: string;
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
      platform(db).run(
        `INSERT INTO dev_outbox (id, channel, org_id, user_id, customer_id, to_address, locale, title, body, payload, created_at)
         VALUES (@id, @channel, @org, @user, @customer, @to, @locale, @title, @body, @payload, @now)`,
        {
          id, channel: msg.channel, org: msg.orgId ?? null, user: msg.userId ?? null, customer: msg.customerId ?? null,
          to: msg.to ?? null, locale: msg.locale ?? null, title: msg.title, body: msg.body,
          payload: msg.payload ? JSON.stringify(msg.payload) : null, now: Date.now(),
        },
      );
      log(`[dev outbox] ${msg.channel} to ${msg.to ?? msg.customerId ?? msg.userId ?? '?'}: ${msg.title}`);
      return { id };
    },
  };
}
