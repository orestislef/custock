import { describe, expect, it } from 'vitest';
import { matches, normalize, searchKey, searchSql, transliterate } from '../src/index';

describe('search', () => {
  it('normalises greek and russian', () => {
    expect(normalize('Καφές ΕΛΛΗΝΙΚΌΣ')).toBe('καφεσ ελληνικοσ');
    expect(normalize('Мёд, ЙОД!')).toBe('мед иод');
    expect(normalize('  Ϊ ΐ  ')).toBe('ι ι');
  });
  it('transliterates', () => {
    expect(transliterate('καφεσ')).toBe('kafes');
    expect(transliterate('μελι')).toBe('meli');
    expect(transliterate('мед')).toBe('med');
  });
  const honey = searchKey('Θυμαρίσιο μέλι 450g', 'Thyme honey 450 g', 'Тимьяновый мёд 450 г');
  const coffee = searchKey('Ελληνικός καφές', 'Greek coffee', 'Греческий кофе');
  const frappe = searchKey('Φραπέ');
  it('finds greek by greeklish', () => {
    expect(matches(honey, 'meli')).toBe(true);
    expect(matches(coffee, 'kafes')).toBe(true);
    expect(matches(coffee, 'ellinikos')).toBe(true);
  });
  it('finds without accents and in any case', () => {
    expect(matches(honey, 'ΜΕΛΙ')).toBe(true);
    expect(matches(coffee, 'καφες')).toBe(true);
  });
  it('finds russian with or without ё', () => {
    expect(matches(honey, 'мед')).toBe(true);
    expect(matches(honey, 'мёд')).toBe(true);
    expect(matches(coffee, 'кофе')).toBe(true);
  });
  it('tolerates doubled letters', () => {
    expect(matches(frappe, 'frappe')).toBe(true);
  });
  it('needs every token', () => {
    expect(matches(honey, 'meli kafes')).toBe(false);
    expect(matches(honey, 'thyme 450')).toBe(true);
  });
  it('builds sql with one group per token', () => {
    const { sql, params } = searchSql('search_key', 'meli 450');
    expect(sql.split(' AND ').length).toBe(2);
    expect(params).toContain('%meli%');
  });
});
