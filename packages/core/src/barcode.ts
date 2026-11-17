// barcode normalisation from thinking/05-inventory.md.
// retail codes become gtin-14 so upc-a, ean-13 with a leading zero and itf-14 meet.

export type BarcodeKind = 'gtin' | 'internal' | 'raw';

export interface NormalizedBarcode {
  code: string; // as scanned, trimmed
  codeNorm: string; // what we store and look up
  kind: BarcodeKind;
  valid: boolean;
  gtin: string | null; // gtin-14 when it is one
}

export const DEFAULT_OWN_DOMAINS = ['custock.app', 'orestislef.github.io', 'localhost'];

// default in store prefix range for our own labels (gs1 restricted circulation 20 to 29)
export const DEFAULT_INTERNAL_PREFIX = '20';

export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

// upc-e (6, 7 or 8 digits) to upc-a (12 digits)
export function expandUpcE(upce: string): string | null {
  if (!/^\d+$/.test(upce)) return null;
  let numberSystem = '0';
  let body = upce;
  let check: string | null = null;
  if (upce.length === 8) {
    numberSystem = upce[0]!;
    body = upce.slice(1, 7);
    check = upce[7]!;
  } else if (upce.length === 7) {
    numberSystem = upce[0]!;
    body = upce.slice(1);
  } else if (upce.length !== 6) {
    return null;
  }
  if (numberSystem !== '0' && numberSystem !== '1') return null;
  const [d1, d2, d3, d4, d5, d6] = body.split('') as [string, string, string, string, string, string];
  let manufacturer: string;
  let product: string;
  if (d6 === '0' || d6 === '1' || d6 === '2') {
    manufacturer = d1 + d2 + d6 + '00';
    product = '00' + d3 + d4 + d5;
  } else if (d6 === '3') {
    manufacturer = d1 + d2 + d3 + '00';
    product = '000' + d4 + d5;
  } else if (d6 === '4') {
    manufacturer = d1 + d2 + d3 + d4 + '0';
    product = '0000' + d5;
  } else {
    manufacturer = d1 + d2 + d3 + d4 + d5;
    product = '0000' + d6;
  }
  const bodyA = numberSystem + manufacturer + product;
  const computed = String(gtinCheckDigit(bodyA));
  if (check !== null && check !== computed) return null;
  return bodyA + computed;
}

export function toGtin14(gtin: string): string {
  return gtin.padStart(14, '0');
}

// gs1 element string, with parentheses or FNC1 (\u001d) separators: take (01)
export function parseGs1Gtin(text: string): string | null {
  const paren = text.match(/\(01\)(\d{14})/);
  if (paren) return paren[1]!;
  const raw = text.replace(/^\]\w\d/, '');
  if (/^01\d{14}/.test(raw)) return raw.slice(2, 16);
  return null;
}

// gs1 digital link: https://id.gs1.org/01/09506000134352 or https://brand.example/01/<gtin>/...
export function parseDigitalLink(url: URL): string | null {
  const m = url.pathname.match(/(?:^|\/)01\/(\d{8,14})(?:\/|$)/);
  return m ? m[1]!.padStart(14, '0') : null;
}

function isInternalGtin(gtin14: string): boolean {
  // gtin-13 restricted circulation numbers 20 to 29 show up as 0 + 2x...
  return /^02\d/.test(gtin14);
}

export function normalizeBarcode(
  raw: string,
  symbology?: string | null,
  opts: { ownDomains?: readonly string[] } = {},
): NormalizedBarcode {
  const code = raw.trim().replace(/^\][A-Za-z]\d/, '');
  const sym = (symbology ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ownDomains = opts.ownDomains ?? DEFAULT_OWN_DOMAINS;

  // urls: our own shelf qr, gs1 digital link, anything else stays raw
  if (/^https?:\/\//i.test(code)) {
    try {
      const url = new URL(code);
      const own = ownDomains.some((d) => url.hostname === d || url.hostname.endsWith('.' + d));
      const shelf = url.pathname.match(/\/p\/([^/?#]+)/);
      if (own && shelf) {
        const inner = normalizeBarcode(decodeURIComponent(shelf[1]!), null, opts);
        return { ...inner, code, kind: inner.kind === 'raw' ? 'internal' : inner.kind };
      }
      const dl = parseDigitalLink(url);
      if (dl && isValidGtin(dl)) return gtinResult(code, dl);
    } catch {
      // not a url after all
    }
    return { code, codeNorm: code, kind: 'raw', valid: true, gtin: null };
  }

  // gs1 element strings from datamatrix or gs1-128
  if (code.includes('(01)') || code.includes('\u001d') || ((sym.includes('datamatrix') || sym.includes('gs1')) && /^01\d{14}/.test(code))) {
    const g = parseGs1Gtin(code);
    if (g && isValidGtin(g)) return gtinResult(code, g);
  }

  if (/^\d+$/.test(code)) {
    if (sym === 'upce' && code.length >= 6 && code.length <= 8) {
      const a = expandUpcE(code);
      if (a) return gtinResult(code, a);
      return { code, codeNorm: code, kind: 'raw', valid: false, gtin: null };
    }
    if ([8, 12, 13, 14].includes(code.length)) {
      if (isValidGtin(code)) return gtinResult(code, code);
      return { code, codeNorm: code, kind: 'raw', valid: false, gtin: null };
    }
  }

  return { code, codeNorm: code, kind: 'raw', valid: true, gtin: null };
}

function gtinResult(code: string, gtin: string): NormalizedBarcode {
  const g14 = toGtin14(gtin);
  return { code, codeNorm: g14, kind: isInternalGtin(g14) ? 'internal' : 'gtin', valid: true, gtin: g14 };
}

// our own label codes: prefix + running number + check digit, always 13 digits
export function makeInternalEan13(seq: number, prefix: string = DEFAULT_INTERNAL_PREFIX): string {
  if (!/^\d{2,3}$/.test(prefix)) throw new Error('prefix must be 2 or 3 digits');
  const body = prefix + String(seq).padStart(12 - prefix.length, '0');
  if (body.length !== 12) throw new Error('sequence too large for prefix');
  return body + gtinCheckDigit(body);
}

// a valid ean-13 from any 12 digit body, used by the seed and tests
export function ean13(body12: string): string {
  if (!/^\d{12}$/.test(body12)) throw new Error('need 12 digits');
  return body12 + gtinCheckDigit(body12);
}

export function shelfUrl(code: string, base = 'https://custock.app'): string {
  return `${base.replace(/\/$/, '')}/p/${encodeURIComponent(code)}`;
}
