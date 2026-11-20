// a shop's opening hours as stored (shops.opening_hours, json). a value that does not read as
// opening hours (an old draft shape, a broken one) counts as not set.
import { ShopHours } from '@custock/core';

export function readHours(json: string | null | undefined): ShopHours | null {
  if (!json) return null;
  try {
    const r = ShopHours.safeParse(JSON.parse(json));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
