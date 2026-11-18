// every action the api can write to an audit log has a sentence in english, greek and russian,
// so neither audit screen ever shows a raw key like "category.updated"

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUSINESS_AUDIT_ACTIONS, PLATFORM_AUDIT_ACTIONS, isAuditAction } from '@custock/core';
import { LOCALES, resources } from '@custock/i18n';

// i18next style lookup: nested objects, or keys that keep their dots ("role.assigned")
function lookup(obj: unknown, path: string[]): unknown {
  if (!path.length) return obj;
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (let n = path.length; n >= 1; n--) {
    const key = path.slice(0, n).join('.');
    if (key in o) {
      const found = lookup(o[key], path.slice(n));
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const web = (locale: (typeof LOCALES)[number]) => resources[locale].web as unknown;

describe('audit actions have words in every language', () => {
  for (const locale of LOCALES) {
    it(`business actions in ${locale}`, () => {
      const missing: string[] = [];
      const capitalised: string[] = [];
      for (const action of BUSINESS_AUDIT_ACTIONS) {
        const v = lookup(web(locale), ['audit', 'action', ...action.split('.')]);
        if (typeof v !== 'string' || !v.trim()) missing.push(action);
        // the verb sits in the middle of "{{actor}} {{verb}}", so it starts in lower case
        else if (v[0] !== v[0]!.toLocaleLowerCase(locale)) capitalised.push(action);
      }
      expect(missing, `audit.action missing in ${locale}`).toEqual([]);
      expect(capitalised, `audit.action should start in lower case in ${locale}`).toEqual([]);
    });

    it(`platform actions in ${locale}`, () => {
      const missing = PLATFORM_AUDIT_ACTIONS.filter((action) => {
        const v = lookup(web(locale), ['platform', 'audit', 'action', ...action.split('.')]);
        return typeof v !== 'string' || !v.trim();
      });
      expect(missing, `platform.audit.action missing in ${locale}`).toEqual([]);
    });

    it(`the fallback words exist in ${locale}`, () => {
      for (const k of ['added', 'changed', 'removed']) {
        const v = lookup(web(locale), ['audit', 'fallback', k]);
        expect(typeof v === 'string' && v.includes('{{thing}}'), `audit.fallback.${k} in ${locale}`).toBe(true);
      }
      expect(typeof lookup(web(locale), ['audit', 'thing', 'other'])).toBe('string');
    });
  }
});

// belt and braces next to the types: any action written as a literal in the api source is one
// of the registered keys
describe('the api only writes registered audit actions', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(join(__dirname, '..', 'src'));

  it('every literal action passed to an audit writer is registered', () => {
    const unknown: string[] = [];
    const seen = new Set<string>();
    // the whole call up to its semicolon, nested parentheses included
    const call = /\b(audit|platformAudit|auditBusiness|auditPlatform|grantSuperAdmin)\(([^;]*);/gs;
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(call)) {
        for (const lit of m[2]!.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) {
          const key = lit[1]!;
          seen.add(key);
          // other quoted dotted words in the call (none today) would show up here too
          if (!isAuditAction(key)) unknown.push(`${file.split(/[\\/]src[\\/]/).pop()}: ${key}`);
        }
      }
    }
    expect(unknown).toEqual([]);
    expect(seen.size, 'the scan finds the audit calls').toBeGreaterThan(40);
  });
});
