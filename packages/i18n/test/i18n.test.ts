import { describe, expect, it } from 'vitest';
import { translator, pickLocale, resources } from '../src/index';

describe('i18n', () => {
  it('uses russian plural forms', () => {
    const t = translator('ru');
    expect(t('stock.waiting', { count: 1 })).toBe('1 человек ждёт');
    expect(t('stock.waiting', { count: 3 })).toBe('3 человека ждут');
    expect(t('stock.waiting', { count: 14 })).toBe('14 человек ждут');
  });
  it('uses greek plural forms', () => {
    const t = translator('el');
    expect(t('stock.waiting', { count: 1 })).toBe('1 άτομο περιμένει');
    expect(t('stock.waiting', { count: 14 })).toBe('14 άτομα περιμένουν');
  });
  it('picks a supported locale', () => {
    expect(pickLocale(null, 'el-GR')).toBe('el');
    expect(pickLocale('de', 'fr')).toBe('en');
  });
  it('has the same common keys in every language', () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, p + k + '.') : [p + k.replace(/_(one|few|many|other)$/, '')]));
    const en = new Set(keys(resources.en.common));
    for (const l of ['el', 'ru'] as const) {
      const other = new Set(keys(resources[l].common));
      expect([...en].filter((k) => !other.has(k))).toEqual([]);
    }
  });
});
