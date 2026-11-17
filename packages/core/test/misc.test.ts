import { describe, expect, it } from 'vitest';
import {
  formatMoney, formatQty, fromBaseQty, maskEmail, maskPhone, netFromGross, parseMoney, toBaseQty,
  uuidv7, uuidv7Time, vatFromGross,
} from '../src/index';

const spaces = (s: string) => s.replace(/[  ]/g, ' ');

describe('money', () => {
  it('formats per locale', () => {
    expect(spaces(formatMoney(1290, 'EUR', 'el'))).toBe('12,90 €');
    expect(spaces(formatMoney(1290, 'EUR', 'en'))).toBe('€12.90');
    expect(spaces(formatMoney(129000, 'EUR', 'ru'))).toBe('1 290,00 €');
  });
  it('splits vat from gross prices', () => {
    expect(vatFromGross(1240, 2400)).toBe(240);
    expect(netFromGross(1130, 1300)).toBe(1000);
  });
  it('parses typed prices', () => {
    expect(parseMoney('12,90')).toBe(1290);
    expect(parseMoney('12.9')).toBe(1290);
    expect(parseMoney('1.290,50 €')).toBe(129050);
  });
});

describe('quantities', () => {
  it('stores kg as grams', () => {
    expect(toBaseQty(0.25, 'kg')).toBe(250);
    expect(fromBaseQty(1500, 'kg')).toBe(1.5);
    expect(formatQty(1250, 'kg', 'el')).toBe('1,25');
    expect(formatQty(3, 'piece', 'en')).toBe('3');
  });
});

describe('masking', () => {
  it('masks email and phone', () => {
    expect(maskEmail('maria@example.com')).toBe('ma***@example.com');
    expect(maskPhone('+306912345123')).toBe('+30 69** *** 123');
    expect(maskPhone(null)).toBeNull();
  });
});

describe('uuid v7', () => {
  it('is sortable and carries its time', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_000);
    const c = uuidv7(1_700_000_000_001);
    expect(a < b && b < c).toBe(true);
    expect(uuidv7Time(c)).toBe(1_700_000_000_001);
    expect(a[14]).toBe('7');
  });
});
