// upload slots and the files they become. presign writes a row for the bucket before any byte is
// sent, so a row only counts toward storage once it is confirmed: the bytes arrived (local
// storage) or the file was put on a product, post, logo, category or profile. a slot never used is purged
// after an hour, so asking for slots cannot fill the storage meter.

import type { Db } from '@custock/db';
import { platform } from './tenant';

export const UNCONFIRMED_TTL_MS = 60 * 60_000;
// per person, for every kind of photo together
export const PRESIGN_PER_HOUR = 30;

// still in use by something (the same list the cleanup of unused photos checks)
export const FILE_IN_USE = `(EXISTS (SELECT 1 FROM product_images i WHERE i.file_id = f.id)
  OR EXISTS (SELECT 1 FROM posts p WHERE p.cover_file_id = f.id)
  OR EXISTS (SELECT 1 FROM post_media m WHERE m.file_id = f.id)
  OR EXISTS (SELECT 1 FROM shops s WHERE s.image_file_id = f.id)
  OR EXISTS (SELECT 1 FROM organizations o WHERE o.logo_file_id = f.id)
  OR EXISTS (SELECT 1 FROM categories c WHERE c.image_file_id = f.id)
  OR EXISTS (SELECT 1 FROM users u WHERE u.avatar_file_id = f.id))`;

export function confirmFiles(db: Db, ids: readonly (string | null | undefined)[], now: number) {
  const list = ids.filter((x): x is string => !!x);
  if (!list.length) return;
  platform(db).run('UPDATE files SET confirmed_at = @now WHERE confirmed_at IS NULL AND id IN (SELECT value FROM json_each(@ids))', { now, ids: JSON.stringify(list) });
}

// slots older than an hour that nothing uses go: the row is marked deleted and the object, if the
// browser sent one, is removed (best effort). a used file that somehow missed its confirmation
// is confirmed here instead, so a photo in use is never purged.
export function purgeUnconfirmedFiles(db: Db, now: number, remove?: (key: string) => unknown): number {
  const p = platform(db);
  p.run(`UPDATE files AS f SET confirmed_at = f.created_at WHERE f.confirmed_at IS NULL AND f.deleted_at IS NULL AND ${FILE_IN_USE}`);
  const stale = p.all<{ id: string; storage_key: string }>(
    `SELECT f.id, f.storage_key FROM files f
      WHERE f.confirmed_at IS NULL AND f.deleted_at IS NULL AND f.created_at < @cut AND f.storage_key NOT LIKE 'http%'
        AND NOT ${FILE_IN_USE}
      LIMIT 500`,
    { cut: now - UNCONFIRMED_TTL_MS },
  );
  for (const f of stale) {
    p.run('UPDATE files SET deleted_at = @now WHERE id = @id', { now, id: f.id });
    if (remove) {
      try {
        void Promise.resolve(remove(f.storage_key)).catch(() => {});
      } catch {}
    }
  }
  return stale.length;
}
