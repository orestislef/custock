'use client';

// a JSON schema from the api description, as a readable tree: property name, type, whether it is
// required, allowed values. references to named schemas show the name and open on demand, so a
// big contract never renders all at once. depth is capped so cycles cannot run away.

import type { TFunction } from '@custock/i18n/client';

type S = Record<string, unknown>;
const MAX_DEPTH = 5;

function resolve(schema: unknown, components: Record<string, unknown>): { schema: S; name: string | null } {
  const s = (schema ?? {}) as S;
  const r = typeof s.$ref === 'string' ? s.$ref : null;
  if (r) {
    const name = r.split('/').pop() ?? r;
    return { schema: (components[name] ?? {}) as S, name };
  }
  return { schema: s, name: null };
}

function typeLabel(schema: unknown, components: Record<string, unknown>, t: TFunction): string {
  const { schema: s, name } = resolve(schema, components);
  if (name) return name;
  const type = s.type;
  if (Array.isArray(type)) {
    const real = type.filter((x) => x !== 'null');
    const base = real.length === 1 ? String(real[0]) : real.join(' | ');
    return type.includes('null') ? `${base}, ${t('platform.dev.api.nullable')}` : base;
  }
  if (type === 'array') return t('platform.dev.api.listOf', { type: typeLabel(s.items, components, t) });
  if (Array.isArray(s.enum)) return t('platform.dev.api.values', { list: (s.enum as unknown[]).map(String).join(', ') });
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const opts = ((s.anyOf ?? s.oneOf) as unknown[]).map((o) => typeLabel(o, components, t));
    return `${t('platform.dev.api.oneOf')} ${opts.join(' | ')}`;
  }
  if (typeof type === 'string') {
    const fmt = typeof s.format === 'string' ? ` (${s.format})` : '';
    return `${type}${fmt}`;
  }
  return 'any';
}

// the object an item resolves to, when it has properties worth opening
function objectOf(schema: unknown, components: Record<string, unknown>): S | null {
  let { schema: s } = resolve(schema, components);
  if (s.type === 'array') s = resolve(s.items, components).schema;
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const first = ((s.anyOf ?? s.oneOf) as unknown[]).map((o) => resolve(o, components).schema).find((o) => o.properties);
    if (first) s = first;
  }
  return s.properties && typeof s.properties === 'object' ? s : null;
}

export function SchemaView({ schema, components, t, depth = 0 }: { schema: unknown; components: Record<string, unknown>; t: TFunction; depth?: number }) {
  const obj = objectOf(schema, components);
  if (!obj) return <p className="t-foot t-2 m-0 font-mono">{typeLabel(schema, components, t)}</p>;
  const required = new Set(Array.isArray(obj.required) ? (obj.required as string[]) : []);
  const props = Object.entries(obj.properties as Record<string, unknown>);
  return (
    <ul className="schema-list" role="list">
      {props.map(([name, child]) => {
        const nested = depth < MAX_DEPTH ? objectOf(child, components) : null;
        const label = (
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
            <span className="font-mono t-foot" style={{ color: 'var(--c-ink)', fontWeight: 600 }}>{name}</span>
            <span className="font-mono t-foot t-2 break-all">{typeLabel(child, components, t)}</span>
            <span className="t-cap2 t-2">{required.has(name) ? t('platform.dev.api.required') : t('platform.dev.api.optional')}</span>
          </span>
        );
        return (
          <li key={name} className="schema-item">
            {nested ? (
              <details>
                <summary className="schema-summary">{label}</summary>
                <div className="schema-nest">
                  <SchemaView schema={child} components={components} t={t} depth={depth + 1} />
                </div>
              </details>
            ) : label}
          </li>
        );
      })}
    </ul>
  );
}
