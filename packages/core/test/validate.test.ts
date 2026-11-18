import { describe, expect, it } from 'vitest';
import {
  cleanLine, cleanText, checkText, emailProblem, formatMoneyInput, formatQtyInput, futureProblem, httpsUrlProblem,
  normalizeEmail, normalizeOtp, normalizeSlug, parseBarcodeInput, parseIntInput, parseMoneyInput, parsePhone,
  parseQtyInput, passwordProblem, rangeProblem, slugProblem, isAllowedVat,
} from '../src/validate';

const money = (s: string) => parseMoneyInput(s);
const val = (r: { ok: boolean; value?: unknown; error?: unknown }) => (r.ok ? r.value : r.error);

describe('money', () => {
  it('reads greek, russian and english ways of writing a price', () => {
    expect(val(money('9,90'))).toBe(990);
    expect(val(money('9.90'))).toBe(990);
    expect(val(money('9,9'))).toBe(990);
    expect(val(money('9'))).toBe(900);
    expect(val(money(' 12,50 € '.replace('€', '')))).toBe(1250);
    expect(val(money('1.234,56'))).toBe(123456);
    expect(val(money('1 234,56'))).toBe(123456);
    expect(val(money('1 234,56'))).toBe(123456);
    expect(val(money('1 234,56'))).toBe(123456);
    expect(val(money('1,234.56'))).toBe(123456);
    expect(val(money('1.234'))).toBe(123400);
    expect(val(money('1.234.567,89'))).toBe(123456789 > 100_000_000 ? 'tooLarge' : 123456789);
    expect(val(money(',50'))).toBe(50);
    expect(val(money('0'))).toBe(0);
  });
  it('refuses what is not a price', () => {
    expect(val(money(''))).toBe('empty');
    expect(val(money('9,,90'))).toBe('invalid');
    expect(val(money('9..90'))).toBe('invalid');
    expect(val(money('9,.90'))).toBe('invalid');
    expect(val(money('9,'))).toBe('invalid');
    expect(val(money(','))).toBe('invalid');
    expect(val(money('abc'))).toBe('invalid');
    expect(val(money('9,90€'))).toBe('invalid');
    expect(val(money('1e3'))).toBe('invalid');
    expect(val(money('9,999'))).toBe(999900);
    expect(val(money('9,9999'))).toBe('tooManyDecimals');
    expect(val(money('9.123'))).toBe(912300);
    expect(val(money('12,5.3'))).toBe('invalid');
    expect(val(money('1.23,4'))).toBe('invalid');
    expect(val(money('-5'))).toBe('negative');
    expect(val(money('−5'))).toBe('negative');
    expect(val(money('99999999999'))).toBe('tooLarge');
    expect(val(parseMoneyInput('-5', { allowNegative: true }))).toBe(-500);
  });
  it('writes a price back in the person language', () => {
    expect(formatMoneyInput(123456, 'el')).toBe('1.234,56');
    expect(formatMoneyInput(990, 'en')).toBe('9.90');
    expect(formatMoneyInput(123456, 'ru').replace(/\s/g, ' ')).toBe('1 234,56');
  });
});

describe('quantities', () => {
  it('pieces are whole numbers', () => {
    expect(val(parseQtyInput('12', 'piece'))).toBe(12);
    expect(val(parseQtyInput('1.5', 'piece'))).toBe('wholeNumber');
    expect(val(parseQtyInput('1,5', 'piece'))).toBe('wholeNumber');
    expect(val(parseQtyInput('1.000', 'piece'))).toBe(1000);
    expect(val(parseQtyInput('-2', 'piece'))).toBe('negative');
    expect(val(parseQtyInput('-2', 'piece', { allowNegative: true }))).toBe(-2);
  });
  it('kilo, litre and metre take three decimals in base units', () => {
    expect(val(parseQtyInput('1,5', 'kg'))).toBe(1500);
    expect(val(parseQtyInput('0.250', 'kg'))).toBe(250);
    expect(val(parseQtyInput('2,125', 'l'))).toBe(2125);
    expect(val(parseQtyInput('2,1255', 'm'))).toBe('tooManyDecimals');
    expect(val(parseQtyInput('2,,5', 'kg'))).toBe('invalid');
    expect(formatQtyInput(1500, 'kg', 'el')).toBe('1,5');
    expect(formatQtyInput(12, 'piece', 'en')).toBe('12');
  });
  it('steppers and limits take digits only', () => {
    expect(val(parseIntInput('7'))).toBe(7);
    expect(val(parseIntInput(' 7 '))).toBe(7);
    expect(val(parseIntInput('7.5'))).toBe('wholeNumber');
    expect(val(parseIntInput('7a'))).toBe('invalid');
    expect(val(parseIntInput('-1', { min: 0 }))).toBe('negative');
    expect(val(parseIntInput('11', { max: 10 }))).toBe('tooLarge');
    expect(val(parseIntInput('0', { min: 1 }))).toBe('tooSmall');
  });
  it('only the vat rates a business may pick', () => {
    expect(isAllowedVat(2400)).toBe(true);
    expect(isAllowedVat(1300)).toBe(true);
    expect(isAllowedVat(2300)).toBe(false);
  });
});

describe('email', () => {
  it('accepts real addresses, lowercased and trimmed', () => {
    expect(normalizeEmail('  Maria.P@Example.COM ')).toBe('maria.p@example.com');
    expect(emailProblem('maria@example.com')).toBeNull();
    expect(emailProblem('a.b+shop@mail.example.gr')).toBeNull();
    expect(emailProblem('x@xn--mxaa.gr')).toBeNull();
  });
  it('refuses broken ones', () => {
    expect(emailProblem('')).toBe('empty');
    expect(emailProblem('', { required: false })).toBeNull();
    expect(emailProblem('maria')).toBe('invalid');
    expect(emailProblem('maria@')).toBe('invalid');
    expect(emailProblem('@example.com')).toBe('invalid');
    expect(emailProblem('maria@example')).toBe('invalid');
    expect(emailProblem('maria@@example.com')).toBe('invalid');
    expect(emailProblem('ma ria@example.com')).toBe('spaces');
    expect(emailProblem('maria@exa mple.com')).toBe('spaces');
    expect(emailProblem('maria..p@example.com')).toBe('invalid');
    expect(emailProblem('.maria@example.com')).toBe('invalid');
    expect(emailProblem('maria@-example.com')).toBe('invalid');
    expect(emailProblem('maria@example.c')).toBe('invalid');
    expect(emailProblem('maria@example.123')).toBe('invalid');
    expect(emailProblem('μαρία@example.com')).toBe('invalid');
    expect(emailProblem('a'.repeat(250) + '@x.gr')).toBe('tooLong');
  });
});

describe('phone', () => {
  it('greek numbers get +30, others keep their code', () => {
    expect(val(parsePhone('6912345678'))).toBe('+306912345678');
    expect(val(parsePhone('691 234 5678'))).toBe('+306912345678');
    expect(val(parsePhone('210-123-4567'))).toBe('+302101234567');
    expect(val(parsePhone('+30 691 234 5678'))).toBe('+306912345678');
    expect(val(parsePhone('0030 6912345678'))).toBe('+306912345678');
    expect(val(parsePhone('(+44) 7911 123456'))).toBe('+447911123456');
    expect(val(parsePhone('+7 912 345-67-89'))).toBe('+79123456789');
  });
  it('refuses what is not a phone', () => {
    expect(val(parsePhone(''))).toBe('empty');
    expect(val(parsePhone('69123'))).toBe('invalid');
    expect(val(parsePhone('69a2345678'))).toBe('invalid');
    expect(val(parsePhone('+30 12345'))).toBe('invalid');
    expect(val(parsePhone('69+12345678'))).toBe('invalid');
  });
});

describe('passwords', () => {
  it('10 to 128 characters, no spaces, not the email', () => {
    expect(passwordProblem('Lemoni2026!')).toBeNull();
    expect(passwordProblem('')).toBe('empty');
    expect(passwordProblem('short1!')).toBe('tooShort');
    expect(passwordProblem('has a space 123')).toBe('spaces');
    expect(passwordProblem(' leadingspace1')).toBe('spaces');
    expect(passwordProblem('x'.repeat(129))).toBe('tooLong');
    expect(passwordProblem('maria@example.com', 'Maria@Example.com')).toBe('sameAsEmail');
    expect(passwordProblem('Καλημέρα2026')).toBeNull();
  });
});

describe('text', () => {
  it('single lines: edges trimmed, spaces collapsed, control characters out', () => {
    expect(cleanLine('  Μέλι   θυμαρίσιο \t 450g  ')).toBe('Μέλι θυμαρίσιο 450g');
    expect(cleanLine('Feta\u0000​ 400g')).toBe('Feta 400g');
    expect(cleanLine('a  b', { collapse: false })).toBe('a  b');
  });
  it('multi line text keeps its inside', () => {
    expect(cleanText('  first line\n\n  second  \r\n')).toBe('first line\n\n  second');
    expect(cleanText('a\u0007b')).toBe('ab');
  });
  it('counts characters, not bytes', () => {
    expect(checkText('Ελληνικά', { max: 8 })).toBeNull();
    expect(checkText('Ελληνικάα', { max: 8 })).toBe('tooLong');
    expect(checkText('', { max: 8, required: true })).toBe('empty');
  });
});

describe('codes', () => {
  it('barcodes: spaces and dashes out, check digit checked', () => {
    expect(val(parseBarcodeInput('5201234567894'))).toBe('5201234567894');
    expect(val(parseBarcodeInput('520 1234 56789 4'))).toBe('5201234567894');
    expect(val(parseBarcodeInput('5201-2345-6789-4'))).toBe('5201234567894');
    expect(val(parseBarcodeInput('5201234567890'))).toBe('checkDigit');
    expect(val(parseBarcodeInput('96385074'))).toBe('96385074');
    expect(val(parseBarcodeInput('96385073'))).toBe('checkDigit');
    expect(val(parseBarcodeInput('036000291452'))).toBe('036000291452');
    expect(val(parseBarcodeInput('ABC-123'))).toBe('ABC123');
    expect(val(parseBarcodeInput('ΚΩΔ123'))).toBe('invalid');
    expect(val(parseBarcodeInput(''))).toBe('empty');
    expect(val(parseBarcodeInput('1'.repeat(60)))).toBe('tooLong');
  });
  it('one time codes: digits only, pasted with spaces', () => {
    expect(normalizeOtp(' 123 456 ')).toBe('123456');
    expect(normalizeOtp('123-456-789')).toBe('123456');
  });
  it('slugs', () => {
    expect(normalizeSlug(' Test Shop ')).toBe('test-shop');
    expect(normalizeSlug('a__b--c')).toBe('a-b-c');
    expect(slugProblem('test-shop')).toBeNull();
    expect(slugProblem('Test')).toBe('invalid');
    expect(slugProblem('-x')).toBe('invalid');
    expect(slugProblem('a--b')).toBe('invalid');
    expect(slugProblem('')).toBe('empty');
  });
  it('links are https only', () => {
    expect(httpsUrlProblem('https://example.com/a.jpg')).toBeNull();
    expect(httpsUrlProblem('http://example.com/a.jpg')).toBe('notHttps');
    expect(httpsUrlProblem('javascript:alert(1)')).toBe('notHttps');
    expect(httpsUrlProblem('example.com')).toBe('invalid');
    expect(httpsUrlProblem('https://user:pw@example.com')).toBe('invalid');
    expect(httpsUrlProblem('')).toBeNull();
    expect(httpsUrlProblem('', { required: true })).toBe('empty');
  });
});

describe('dates', () => {
  it('no scheduling in the past, an end after the start', () => {
    const now = Date.UTC(2026, 10, 18, 10);
    expect(futureProblem(now + 3600_000, now)).toBeNull();
    expect(futureProblem(now - 3600_000, now)).toBe('past');
    expect(futureProblem(null, now)).toBeNull();
    expect(rangeProblem(now, now + 1)).toBeNull();
    expect(rangeProblem(now, now)).toBe('beforeStart');
  });
});
