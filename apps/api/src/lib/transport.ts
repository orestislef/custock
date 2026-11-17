// outgoing messages. the only transport for now writes to dev_outbox and logs one line.
// nothing ever leaves the machine.

import { uuidv7 } from '@custock/core';
import type { Db } from '@custock/db';
import { platform } from './tenant';

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
