// quantities are integers in base units. pieces count 1, kg/l/m are stored x1000 (grams, ml, mm).

import type { Uom } from './contract';
import { intlLocale } from './money';

export const UOM_SCALE: Record<Uom, number> = { piece: 1, kg: 1000, l: 1000, m: 1000 };

export function toBaseQty(value: number, uom: Uom): number {
  return Math.round(value * UOM_SCALE[uom]);
}

export function fromBaseQty(qty: number, uom: Uom): number {
  return qty / UOM_SCALE[uom];
}

// number only, the unit label comes from translations (common.uom.*)
export function formatQty(qty: number, uom: Uom, locale: string = 'el'): string {
  const value = fromBaseQty(qty, uom);
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: uom === 'piece' ? 0 : 3 }).format(value);
}
