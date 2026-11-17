// money is integer minor units (cents). never floats in storage.

export type AppLocaleTag = 'en' | 'el' | 'ru';

// intl locale per app locale. en uses ireland so euros look like €12.50
export function intlLocale(locale: string): string {
  switch (locale) {
    case 'el':
      return 'el-GR';
    case 'ru':
      return 'ru-RU';
    case 'en':
      return 'en-IE';
    default:
      return locale;
  }
}

export function formatMoney(minor: number, currency = 'EUR', locale: string = 'el'): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).format(minor / 100);
}

// prices are entered with vat. rate in basis points, 2400 = 24%
export function vatFromGross(grossMinor: number, rateBp: number): number {
  const net = Math.round((grossMinor * 10000) / (10000 + rateBp));
  return grossMinor - net;
}

export function netFromGross(grossMinor: number, rateBp: number): number {
  return grossMinor - vatFromGross(grossMinor, rateBp);
}

export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[^\d,.-]/g, '');
  if (!cleaned) return null;
  // the last separator is the decimal one, as typed in el, ru or en
  const lastSep = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  let whole = cleaned;
  let frac = '';
  if (lastSep >= 0 && cleaned.length - lastSep - 1 <= 2) {
    whole = cleaned.slice(0, lastSep);
    frac = cleaned.slice(lastSep + 1);
  }
  const digits = whole.replace(/[,.]/g, '');
  const n = Number(digits || '0') * 100 + Number((frac + '00').slice(0, 2));
  return Number.isFinite(n) ? (cleaned.startsWith('-') ? -Math.abs(n) : n) : null;
}
