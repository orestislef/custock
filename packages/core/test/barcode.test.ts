import { describe, expect, it } from 'vitest';
import { DEFAULT_OWN_DOMAINS, ean13, expandUpcE, gtinCheckDigit, isValidGtin, makeInternalEan13, normalizeBarcode, ownDomainsFor, setOwnDomains } from '../src/index';

describe('barcodes', () => {
  it('computes check digits', () => {
    expect(gtinCheckDigit('400638133393')).toBe(1);
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('96385074')).toBe(true);
  });
  it('makes upc-a and ean-13 with a leading zero the same thing', () => {
    const a = normalizeBarcode('036000291452');
    const b = normalizeBarcode('0036000291452');
    expect(a.codeNorm).toBe('00036000291452');
    expect(b.codeNorm).toBe(a.codeNorm);
    expect(a.kind).toBe('gtin');
  });
  it('expands upc-e', () => {
    expect(expandUpcE('04252614')).toBe('042100005264');
    expect(normalizeBarcode('04252614', 'upce').codeNorm).toBe('00042100005264');
  });
  it('flags damaged codes', () => {
    const r = normalizeBarcode('4006381333932');
    expect(r.valid).toBe(false);
    expect(r.kind).toBe('raw');
  });
  it('reads gs1 element strings and digital links', () => {
    expect(normalizeBarcode('(01)09506000134352(17)271231(10)AB1').codeNorm).toBe('09506000134352');
    expect(normalizeBarcode('0109506000134352172712311', 'gs1-datamatrix').codeNorm).toBe('09506000134352');
    expect(normalizeBarcode('https://id.gs1.org/01/09506000134352/10/ABC').codeNorm).toBe('09506000134352');
  });
  it('reads our own shelf qr', () => {
    const code = ean13('520123456789');
    const r = normalizeBarcode(`https://custock.app/p/${code}`);
    expect(r.codeNorm).toBe('0' + code);
    expect(normalizeBarcode('https://custock.app/p/LEMONI-1').kind).toBe('internal');
  });
  it('keeps other codes exact', () => {
    expect(normalizeBarcode(' AbC-123 ').codeNorm).toBe('AbC-123');
    expect(normalizeBarcode('https://example.com/x').kind).toBe('raw');
  });
  it('makes internal ean-13 labels', () => {
    const c = makeInternalEan13(42);
    expect(c).toHaveLength(13);
    expect(c.startsWith('20')).toBe(true);
    expect(isValidGtin(c)).toBe(true);
    expect(normalizeBarcode(c).kind).toBe('internal');
    expect(makeInternalEan13(7, '29').startsWith('29')).toBe(true);
  });
});

describe('our own shelf qr codes', () => {
  const shelf = 'https://orestislef.gr/custock/p/5200044170102';
  it('come from the configured web address, not a fixed list', () => {
    expect(DEFAULT_OWN_DOMAINS).not.toContain('orestislef.github.io');
    expect(ownDomainsFor('https://orestislef.gr/custock', 'shop.example.com', 'not a url %')).toEqual(['custock.app', 'localhost', 'orestislef.gr', 'shop.example.com']);
    expect(normalizeBarcode(shelf).kind).toBe('raw');
    expect(normalizeBarcode(shelf, null, { ownDomains: ownDomainsFor('https://orestislef.gr') })).toMatchObject({ kind: 'gtin', codeNorm: '05200044170102' });
    expect(normalizeBarcode('https://orestislef.github.io/custock/p/5200044170102').kind).toBe('raw');
  });
  it('the api can set the default once', () => {
    setOwnDomains(ownDomainsFor('https://orestislef.gr/custock'));
    expect(normalizeBarcode(shelf).kind).toBe('gtin');
    setOwnDomains([]);
    expect(normalizeBarcode(shelf).kind).toBe('raw');
  });
});
