// one set of input rules for the web forms, the api and (copied) the demo. every parser takes what
// a person typed or pasted and returns either a clean value or a short error code. the codes have
// texts in common.json under field.*, so a form and the api say the same thing.

import { isValidGtin } from './barcode';

export type FieldError =
  | 'empty'
  | 'invalid'
  | 'tooManyDecimals'
  | 'wholeNumber'
  | 'negative'
  | 'tooLarge'
  | 'tooSmall'
  | 'tooLong'
  | 'tooShort'
  | 'spaces'
  | 'sameAsEmail'
  | 'checkDigit'
  | 'notHttps'
  | 'past'
  | 'beforeStart';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: FieldError };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(error: FieldError): Parsed<T> => ({ ok: false, error });

// lengths that match the database and the api contract. forms use them for maxLength and counters
export const LIMITS = {
  email: 254,
  passwordMin: 10,
  passwordMax: 128,
  personName: 80,
  businessName: 120,
  shopName: 80,
  roleName: 60,
  categoryName: 80,
  joinLabel: 80,
  productName: 200,
  brand: 120,
  description: 5000,
  sku: 64,
  optionName: 40,
  optionValue: 80,
  postTitle: 200,
  postBody: 5000,
  note: 500,
  customerNote: 2000,
  tag: 40,
  city: 80,
  address: 200,
  phone: 30,
  url: 2000,
  search: 200,
  slug: 40,
  barcode: 48,
  otp: 6,
} as const;

// money and stock never go above these, a typo with three extra zeros is caught
export const MAX_MONEY_MINOR = 100_000_000; // 1.000.000,00
export const MAX_QTY_BASE = 100_000_000; // a hundred million pieces, or 100 tonnes in grams

// ------------------------------------------------------------------ text

// control characters out (keeps line breaks and tabs in multi line text), no zero width tricks
const CONTROL_SINGLE = /[\u0000-\u001F\u007F-\u009F​-‍⁠﻿]/g;
const CONTROL_MULTI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‍⁠﻿]/g;

// a single line value: edges trimmed, control characters out, runs of spaces collapsed for names
export function cleanLine(input: string, opts: { collapse?: boolean } = {}): string {
  let s = input.replace(CONTROL_SINGLE, ' ');
  if (opts.collapse !== false) s = s.replace(/\s+/g, ' ');
  return s.trim();
}

// multi line text (descriptions, post bodies, notes): only the edges trimmed, the inside kept
export function cleanText(input: string): string {
  return input.replace(/\r\n?/g, '\n').replace(CONTROL_MULTI, '').replace(/^\s+|\s+$/g, '');
}

export function checkText(value: string, opts: { max: number; min?: number; required?: boolean }): FieldError | null {
  const n = [...value].length;
  if (!n) return opts.required ? 'empty' : null;
  if (opts.min && n < opts.min) return 'tooShort';
  if (n > opts.max) return 'tooLong';
  return null;
}

// ------------------------------------------------------------------ numbers

const SPACES = /[\s   ']/g; // spaces, no break spaces and apostrophes used as group marks

// a decimal as typed in greek, russian or english, into an integer of the given scale.
// "9,90" and "9.90" are both 9.90. "1.234,56", "1 234,56" and "1,234.56" are 1234.56.
// a single separator followed by up to `decimals` digits is the decimal mark, more digits mean a
// thousands mark. two marks in a row, letters, a lone mark or more decimals than allowed are refused.
export function parseDecimal(
  input: string,
  opts: { decimals: number; scale: number; max?: number; min?: number; allowNegative?: boolean },
): Parsed<number> {
  let s = input.trim().replace(/−/g, '-');
  if (!s) return fail('empty');
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1).trim();
  }
  s = s.replace(SPACES, '');
  if (!s || !/^[\d.,]+$/.test(s)) return fail('invalid');
  if (/[.,]{2,}/.test(s) || /^[.,]$/.test(s) || /[.,]$/.test(s)) return fail('invalid');
  if (negative && !opts.allowNegative) return fail('negative');

  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  let whole = s;
  let frac = '';
  if (commas && dots) {
    // both: the last one is the decimal mark, the other one groups thousands
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const grp = dec === ',' ? '.' : ',';
    const at = s.lastIndexOf(dec);
    whole = s.slice(0, at);
    frac = s.slice(at + 1);
    if (frac.includes(grp) || whole.includes(dec) || !validGroups(whole, grp)) return fail('invalid');
    whole = whole.split(grp).join('');
  } else if (commas + dots === 1) {
    const mark = commas ? ',' : '.';
    const [a, b] = s.split(mark) as [string, string];
    if (b.length <= opts.decimals || b.length !== 3 || !a) {
      whole = a || '0';
      frac = b;
    } else {
      // exactly three digits after one mark and no decimals allowed that long: a thousands mark
      whole = a + b;
    }
  } else if (commas + dots > 1) {
    const mark = commas ? ',' : '.';
    if (!validGroups(s, mark)) return fail('invalid');
    whole = s.split(mark).join('');
  }
  if (frac.length > opts.decimals) return fail(opts.decimals === 0 ? 'wholeNumber' : 'tooManyDecimals');
  if (!/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) return fail('invalid');
  if (whole.length > 15) return fail('tooLarge');
  const value = Number(whole) * opts.scale + Number((frac + '0'.repeat(opts.decimals)).slice(0, opts.decimals) || '0') * (opts.scale / 10 ** opts.decimals);
  const signed = negative ? -value : value;
  if (!Number.isSafeInteger(signed)) return fail('tooLarge');
  if (opts.max !== undefined && signed > opts.max) return fail('tooLarge');
  if (opts.min !== undefined && signed < opts.min) return fail(signed < 0 && !opts.allowNegative ? 'negative' : 'tooSmall');
  return ok(signed);
}

function validGroups(s: string, mark: string): boolean {
  const parts = s.split(mark);
  if (parts.length === 1) return true;
  return /^\d{1,3}$/.test(parts[0]!) && parts.slice(1).every((p) => /^\d{3}$/.test(p));
}

// money as typed, into minor units (cents). two decimals at most, never negative unless asked
export function parseMoneyInput(input: string, opts: { allowNegative?: boolean; max?: number; min?: number } = {}): Parsed<number> {
  return parseDecimal(input, { decimals: 2, scale: 100, max: opts.max ?? MAX_MONEY_MINOR, min: opts.min, allowNegative: opts.allowNegative });
}

export type QtyUom = 'piece' | 'kg' | 'l' | 'm';

// a quantity as typed, into base units: pieces are whole numbers, kilo, litre and metre take up to
// three decimals (grams, ml, mm)
export function parseQtyInput(input: string, uom: QtyUom, opts: { allowNegative?: boolean; max?: number; min?: number } = {}): Parsed<number> {
  const piece = uom === 'piece';
  return parseDecimal(input, { decimals: piece ? 0 : 3, scale: piece ? 1 : 1000, max: opts.max ?? MAX_QTY_BASE, min: opts.min, allowNegative: opts.allowNegative });
}

// a whole number typed into a stepper or a limit field: digits only
export function parseIntInput(input: string, opts: { min?: number; max?: number } = {}): Parsed<number> {
  const s = input.trim().replace(SPACES, '');
  if (!s) return fail('empty');
  if (/^-/.test(s)) return fail(opts.min !== undefined && opts.min >= 0 ? 'negative' : 'invalid');
  if (/[.,]\d/.test(s)) return fail('wholeNumber');
  if (!/^\d+$/.test(s)) return fail('invalid');
  if (s.length > 15) return fail('tooLarge');
  const n = Number(s);
  if (opts.max !== undefined && n > opts.max) return fail('tooLarge');
  if (opts.min !== undefined && n < opts.min) return fail('tooSmall');
  return ok(n);
}

// what goes back into a money field after it loses focus, in the person's language, no symbol
export function formatMoneyInput(minor: number, locale: string): string {
  const tag = locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-GB';
  return new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).format(minor / 100);
}

export function formatQtyInput(base: number, uom: QtyUom, locale: string): string {
  const tag = locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-GB';
  if (uom === 'piece') return new Intl.NumberFormat(tag, { maximumFractionDigits: 0, useGrouping: false }).format(base);
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 3, useGrouping: false }).format(base / 1000);
}

// vat rates per country, in basis points (24% = 2400). a product takes one of its country's rates
export const VAT_BY_COUNTRY: Record<string, readonly number[]> = {
  GR: [2400, 1300, 600], CY: [1900, 900, 500], DE: [1900, 700], BG: [2000, 900], RO: [1900, 900, 500],
};
export const VAT_RATES_BP: readonly number[] = [0, ...new Set(Object.values(VAT_BY_COUNTRY).flat())];
export function isAllowedVat(bp: number, country?: string | null): boolean {
  if (country && VAT_BY_COUNTRY[country]) return bp === 0 || VAT_BY_COUNTRY[country]!.includes(bp);
  return VAT_RATES_BP.includes(bp);
}

// ------------------------------------------------------------------ email, phone, password

const EMAIL_LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const EMAIL_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export function normalizeEmail(input: string): string {
  return input.replace(CONTROL_SINGLE, '').trim().toLowerCase();
}

// a real address check, not just "has an @": one @, a sane local part, a domain with a dot and a
// top level name of letters (or punycode)
export function emailProblem(input: string, opts: { required?: boolean } = { required: true }): FieldError | null {
  const s = normalizeEmail(input);
  if (!s) return opts.required === false ? null : 'empty';
  if (s.length > LIMITS.email) return 'tooLong';
  if (/\s/.test(s)) return 'spaces';
  const at = s.split('@');
  if (at.length !== 2) return 'invalid';
  const [local, domain] = at as [string, string];
  if (!local || local.length > 64 || !EMAIL_LOCAL.test(local)) return 'invalid';
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => EMAIL_LABEL.test(l))) return 'invalid';
  const tld = labels[labels.length - 1]!;
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(tld)) return 'invalid';
  return null;
}

export function isEmail(input: string): boolean {
  return emailProblem(input) === null;
}

// a phone number into E.164. greek numbers without a country code get +30. spaces, dashes, dots and
// brackets are fine when typed, letters are not
export function parsePhone(input: string, defaultCountry = '30'): Parsed<string> {
  const raw = input.trim();
  if (!raw) return fail('empty');
  if (/[^\d+\s().\-\/]/.test(raw)) return fail('invalid');
  let s = raw.replace(/[\s().\-\/]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.indexOf('+') > 0 || (s.match(/\+/g) ?? []).length > 1) return fail('invalid');
  let digits: string;
  if (s.startsWith('+')) digits = s.slice(1);
  else if (defaultCountry === '30' && /^(2\d{9}|69\d{8})$/.test(s)) digits = '30' + s;
  else if (s.startsWith(defaultCountry) && s.length > defaultCountry.length + 7) digits = s;
  else digits = defaultCountry + s.replace(/^0+/, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) return fail(digits.length > 15 ? 'tooLong' : 'invalid');
  if (digits.startsWith('30') && !/^30(2\d{9}|69\d{8})$/.test(digits)) return fail('invalid');
  return ok('+' + digits);
}

// a new password: 10 to 128 characters, no spaces anywhere, not the email again. existing passwords
// are never checked against this at sign in
export function passwordProblem(password: string, email?: string | null): FieldError | null {
  if (!password) return 'empty';
  if (/\s/.test(password)) return 'spaces';
  if ([...password].length < LIMITS.passwordMin) return 'tooShort';
  if ([...password].length > LIMITS.passwordMax) return 'tooLong';
  if (email && password.toLowerCase() === normalizeEmail(email)) return 'sameAsEmail';
  return null;
}

// ------------------------------------------------------------------ codes, slugs, urls

// a typed or pasted barcode: spaces and dashes out. numeric codes of gtin length must have the right
// check digit, other codes (code 128) are printable ascii
export function parseBarcodeInput(input: string): Parsed<string> {
  const s = input.replace(/[\s\- ]/g, '');
  if (!s) return fail('empty');
  if (s.length > LIMITS.barcode) return fail('tooLong');
  if (/^\d+$/.test(s)) {
    if ([8, 12, 13, 14].includes(s.length) && !isValidGtin(s)) return fail('checkDigit');
    return ok(s);
  }
  if (!/^[\x21-\x7E]+$/.test(s)) return fail('invalid');
  return ok(s);
}

// a one time code from an email: digits only, pasted with spaces or dashes is fine
export function normalizeOtp(input: string): string {
  return input.replace(/\D/g, '').slice(0, LIMITS.otp);
}

export function slugProblem(input: string): FieldError | null {
  if (!input) return 'empty';
  if (input.length > LIMITS.slug) return 'tooLong';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(input) || input.includes('--')) return 'invalid';
  return null;
}

export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.slug);
}

export function httpsUrlProblem(input: string, opts: { required?: boolean } = {}): FieldError | null {
  const s = input.trim();
  if (!s) return opts.required ? 'empty' : null;
  if (s.length > LIMITS.url) return 'tooLong';
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return 'invalid';
  }
  if (u.protocol !== 'https:') return 'notHttps';
  if (!u.hostname.includes('.') || u.username || u.password) return 'invalid';
  return null;
}

// ------------------------------------------------------------------ dates

export function futureProblem(ms: number | null, now = Date.now()): FieldError | null {
  if (ms === null) return null;
  return ms < now - 60_000 ? 'past' : null;
}

export function rangeProblem(startMs: number | null, endMs: number | null): FieldError | null {
  if (startMs === null || endMs === null) return null;
  return endMs <= startMs ? 'beforeStart' : null;
}

// a search box: trimmed, capped, never an error
export function cleanSearch(input: string): string {
  return cleanLine(input).slice(0, LIMITS.search);
}
