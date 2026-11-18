import { describe, expect, it } from 'vitest';
import { barsFor, CODE128, code128Bars, ean13Bars, ean13Valid } from '../src/barcode-draw';

describe('shelf label barcodes', () => {
  it('knows a valid EAN-13', () => {
    expect(ean13Valid('5901234123457')).toBe(true);
    expect(ean13Valid('4006381333931')).toBe(true);
    expect(ean13Valid('5901234123458')).toBe(false);
    expect(ean13Valid('590123412345')).toBe(false);
  });

  it('draws EAN-13 in 95 modules with the guards', () => {
    const b = ean13Bars('5901234123457');
    expect(b.modules).toBe(95);
    expect(b.runs.reduce((a, x) => a + x, 0)).toBe(95);
    // start guard 101: bar 1, space 1, bar 1, then the first digit's left space
    expect(b.runs.slice(0, 3)).toEqual([1, 1, 1]);
    expect(b.runs.slice(-3)).toEqual([1, 1, 1]);
    // every digit is 7 modules: 6 + 6 digits of 4 runs each, 3 guards (3 + 5 + 3 runs)
    expect(b.runs.length).toBe(3 + 6 * 4 + 5 + 6 * 4 + 3);
  });

  it('has the full code 128 table, every symbol 11 modules and the stop 13', () => {
    expect(CODE128).toHaveLength(107);
    CODE128.slice(0, 106).forEach((p) => expect([...p].reduce((a, x) => a + Number(x), 0)).toBe(11));
    expect([...CODE128[106]].reduce((a, x) => a + Number(x), 0)).toBe(13);
  });

  it('encodes code 128 B with the right check symbol', () => {
    // Wikipedia: start B, W i k i p e d i a, check 88, stop
    const b = code128Bars('Wikipedia');
    const symbols = 1 + 9 + 1;
    expect(b.modules).toBe(symbols * 11 + 13);
    expect(b.runs.slice(-7 - 6, -7).join('')).toBe(CODE128[88]);
  });

  it('packs even digit runs in code set C', () => {
    const b = code128Bars('123456');
    // start C, 12 34 56, check, stop
    expect(b.modules).toBe(5 * 11 + 13);
    expect(b.runs.slice(0, 6).join('')).toBe(CODE128[105]);
  });

  it('picks EAN-13 when it can and code 128 otherwise', () => {
    expect(barsFor('2000000000015')?.kind).toBe('ean13');
    expect(barsFor('ABC-12')?.kind).toBe('code128');
    expect(barsFor('ΑΒΓ')).toBeNull();
  });
});
