// one rule for "running low" everywhere (dashboard, the low filter, alerts, reports, badges): a
// variant is low in a shop when it has stock, and no more than the shop's reorder point for it, or,
// with no reorder point set, the business's "only a few left" number. zero is out, below zero is
// negative. stock counts in base units (grams, ml, mm for kilo, litre and metre), the few left
// number in whole units, so it is scaled for those.

export function unitFactor(uom: string): number {
  return uom === 'piece' ? 1 : 1000;
}

export function lowThreshold(reorderPoint: number | null | undefined, fewLeft: number, uom: string): number {
  return reorderPoint ?? fewLeft * unitFactor(uom);
}

export function isLow(onHand: number, reorderPoint: number | null | undefined, fewLeft: number, uom: string): boolean {
  return onHand > 0 && onHand <= lowThreshold(reorderPoint, fewLeft, uom);
}

// the same rule in sql. the query must join stock_levels as l, shop_variant_settings as ss and
// products as p (aliases can be changed), and pass @fewLeft
export function lowSql(l = 'l', ss = 'ss', p = 'p'): string {
  return `${l}.on_hand > 0 AND ${l}.on_hand <= coalesce(${ss}.reorder_point, @fewLeft * CASE WHEN ${p}.uom = 'piece' THEN 1 ELSE 1000 END)`;
}
