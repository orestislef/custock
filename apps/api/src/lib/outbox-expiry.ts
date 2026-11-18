// messages that carry a live token (sign in codes, reset, invite and confirmation links) must not
// keep it longer than the token itself lives, whether or not sending is on. in outbox mode nothing
// is ever sent, so without this the links would sit in the database and every backup for good.
// after the longest lifetime the token can have, the text and html of the row are dropped.

import type { Db } from '@custock/db';
import { platform } from './tenant';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// the longest each kind of token can live (the policy maximums), with a margin
export const TOKEN_MESSAGE_TTL: Record<string, number> = {
  otp: 30 * MIN + MIN,
  delete_code: 10 * MIN + MIN,
  password_reset: 120 * MIN + MIN,
  email_change: 60 * MIN + MIN,
  email_changed: 7 * DAY + MIN, // carries the one click revert link
  invite: 30 * DAY + MIN,
  platform_invite: 14 * DAY + MIN,
  join_confirm: 30 * DAY + MIN,
};

export function expireTokenMessages(db: Db, now: number): number {
  const p = platform(db);
  let n = 0;
  for (const [type, ttl] of Object.entries(TOKEN_MESSAGE_TTL)) {
    n += p.run(
      `UPDATE dev_outbox SET body = NULL, html = NULL
        WHERE (body IS NOT NULL OR html IS NOT NULL) AND created_at < @cut AND json_extract(payload, '$.type') = @type`,
      { cut: now - ttl, type },
    ).changes;
  }
  return n;
}
