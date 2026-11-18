import { describe, expect, it } from 'vitest';
import { returnParam, safeReturnPath } from '../src/return-path';

describe('safeReturnPath', () => {
  it('keeps paths inside the app', () => {
    expect(safeReturnPath('/admin/posts/01abc?org=o1')).toBe('/admin/posts/01abc?org=o1');
    expect(safeReturnPath('/admin')).toBe('/admin');
    expect(safeReturnPath('/admin/stock/p1?org=o1&shop=s1#history')).toBe('/admin/stock/p1?org=o1&shop=s1#history');
    expect(safeReturnPath('/s/lemoni/news?post=p1')).toBe('/s/lemoni/news?post=p1');
    expect(safeReturnPath('/s/lemoni')).toBe('/s/lemoni');
    expect(safeReturnPath('/p/5200044170102')).toBe('/p/5200044170102');
  });

  it('drops the base path when it is there', () => {
    expect(safeReturnPath('/custock/admin/team?member=m1', '/custock')).toBe('/admin/team?member=m1');
    expect(safeReturnPath('/custock/s/lemoni', '/custock/')).toBe('/s/lemoni');
    expect(safeReturnPath('/admin', '/custock')).toBe('/admin');
  });

  it('refuses anything that could leave the app', () => {
    for (const bad of [
      'https://evil.example/admin', 'http://evil.example', '//evil.example/admin', '/\evil.example', '\\evil.example',
      '/%2f%2fevil.example', '/admin%5c..', 'javascript:alert(1)', 'data:text/html,x', ' //evil.example', '/admin\n/x',
      'admin/posts', '', '   ', null, undefined, `/admin/${'x'.repeat(600)}`, '/%00admin',
    ]) {
      expect(safeReturnPath(bad as string)).toBeNull();
    }
  });

  it('refuses pages outside the allowed areas and the sign in pages', () => {
    expect(safeReturnPath('/api/v1/me')).toBeNull();
    expect(safeReturnPath('/unsubscribe/token')).toBeNull();
    expect(safeReturnPath('/admin/login?next=/admin')).toBeNull();
    expect(safeReturnPath('/admin/forgot')).toBeNull();
    expect(safeReturnPath('/admin/reset/abc')).toBeNull();
    expect(safeReturnPath('/s/Bad_Slug!')).toBeNull();
    expect(safeReturnPath('/adminx')).toBeNull();
  });

  it('builds the parameter for the page someone is on', () => {
    expect(returnParam('/admin/posts/1', '?org=o1')).toBe('/admin/posts/1?org=o1');
    expect(returnParam('/custock/admin', '', '/custock')).toBe('/admin');
    expect(returnParam('/admin/login', '')).toBeNull();
  });
});
