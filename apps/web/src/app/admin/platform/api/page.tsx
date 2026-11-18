'use client';

// the api as the server describes it (GET /v1/openapi.json), for the super admin: endpoints
// grouped by area, a search over path, name and permission, a filter by who may call it, and a
// sheet per endpoint with its parameters, body, answer, permissions and problem codes. self hosted,
// no swagger bundle and nothing from a CDN.

import { useDeferredValue, useMemo, useState } from 'react';
import type { OpenApiDoc, OpenApiOperation } from '@custock/core';
import { usePlatform } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { PlatformShell } from '@/components/platform/platform-shell';
import { Empty, Group, Row } from '@/components/ui/kit';
import { FadeRow, Sheet, useToast } from '@/components/ui/client-kit';
import { IconCopy, IconDownload, IconSearch, IconWarning } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { SchemaView } from './schema-view';

type Access = NonNullable<OpenApiOperation['x-access']>;
const ACCESS: Access[] = ['public', 'user', 'org', 'superadmin'];
const TAG_ORDER = [
  'auth', 'account', 'business', 'products', 'stock', 'counts', 'transfers', 'customers', 'join-links', 'posts', 'team', 'reports',
  'uploads', 'push', 'customer-app', 'public', 'platform', 'files', 'system', 'dev',
];

interface Endpoint { method: string; path: string; op: OpenApiOperation; tag: string; search: string }

export default function PlatformApiPage() {
  return (
    <PlatformShell>
      <ApiDocs />
    </PlatformShell>
  );
}

function MethodBadge({ method }: { method: string }) {
  const m = method.toLowerCase();
  return <span className={`method method-${m}`} aria-label={method.toUpperCase()}>{method.toUpperCase()}</span>;
}

function ApiDocs() {
  const { api, t } = usePlatform();
  const doc = useAsync(() => api.openApi(), []);
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim().toLowerCase());
  const [access, setAccess] = useState<Access | 'all'>('all');
  const [open, setOpen] = useState<Endpoint | null>(null);

  const endpoints = useMemo<Endpoint[]>(() => {
    const d = doc.data as OpenApiDoc | undefined;
    if (!d) return [];
    const out: Endpoint[] = [];
    for (const [path, ops] of Object.entries(d.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const tag = op.tags?.[0] ?? 'system';
        const search = [method, path, op.summary, tag, t(`platform.dev.api.tag.${tag}`, { defaultValue: tag }), ...(op['x-permissions'] ?? [])].join(' ').toLowerCase();
        out.push({ method, path, op, tag, search });
      }
    }
    return out;
  }, [doc.data, t]);

  const shown = endpoints.filter((e) => (access === 'all' || e.op['x-access'] === access) && (!query || query.split(/\s+/).every((w) => e.search.includes(w))));
  const groups = TAG_ORDER.map((tag) => ({ tag, items: shown.filter((e) => e.tag === tag) }))
    .concat([{ tag: '__other', items: shown.filter((e) => !TAG_ORDER.includes(e.tag)) }])
    .filter((g) => g.items.length);

  const d = doc.data as OpenApiDoc | undefined;
  const download = () => {
    if (!d) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custock-openapi.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const subtitle = d ? `${t('platform.dev.api.count', { count: endpoints.length })} · ${t('platform.dev.api.version', { v: d.info.version })}` : t('platform.dev.api.sub');

  return (
    <Page title={t('platform.dev.api.title')} subtitle={subtitle} back={{ href: '/admin/platform', label: t('platform.title') }}
      actions={d ? <button type="button" className="btn btn-gray" onClick={download}><IconDownload size={18} />{t('platform.dev.api.download')}</button> : null}
      phoneAction={d ? <button type="button" className="icon-btn" onClick={download} aria-label={t('platform.dev.api.download')}><IconDownload size={22} /></button> : undefined}>
      {doc.error && !d ? (
        <Empty icon={<IconWarning size={28} />} title={t('platform.dev.api.loadFailed')}
          action={<button type="button" className="btn btn-tinted" onClick={() => void doc.reload()}>{t('platform.dev.api.retry')}</button>} />
      ) : !d ? (
        <div className="h-96 rounded-[16px] skel" aria-busy="true" />
      ) : (
        <>
          <div className="search mb-3" style={{ height: 40 }}>
            <IconSearch size={18} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('platform.dev.api.search')} aria-label={t('platform.dev.api.search')} autoComplete="off" spellCheck={false} />
          </div>
          <FadeRow className="flex gap-2 overflow-x-auto mb-5 -mx-4 px-4 md:mx-0 md:px-0" label={t('platform.dev.api.title')}>
            <button type="button" className="chip" aria-pressed={access === 'all'} onClick={() => setAccess('all')}>{t('platform.dev.api.all')}</button>
            {ACCESS.map((a) => (
              <button key={a} type="button" className="chip" aria-pressed={access === a} onClick={() => setAccess(a)}>{t(`platform.dev.api.access.${a}`)}</button>
            ))}
          </FadeRow>
          {!groups.length ? (
            <Empty icon={<IconSearch size={28} />} title={t('platform.dev.api.noMatch', { q: q.trim() })} />
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((g) => (
                <Group key={g.tag} title={g.tag === '__other' ? t('platform.dev.api.tag.system') : t(`platform.dev.api.tag.${g.tag}`, { defaultValue: g.tag })}>
                  {g.items.map((e) => (
                    <Row key={`${e.method} ${e.path}`} onClick={() => setOpen(e)}
                      leading={<MethodBadge method={e.method} />}
                      title={e.op.summary ?? e.path}
                      subtitle={<span className="code-path">{e.path}</span>} />
                  ))}
                </Group>
              ))}
            </div>
          )}
        </>
      )}
      <EndpointSheet endpoint={open} components={(d?.components?.schemas ?? {}) as Record<string, unknown>} onClose={() => setOpen(null)} />
    </Page>
  );
}

function EndpointSheet({ endpoint, components, onClose }: { endpoint: Endpoint | null; components: Record<string, unknown>; onClose: () => void }) {
  const { t } = usePlatform();
  const toast = useToast();
  const e = endpoint;
  const op = e?.op;
  const access = op?.['x-access'] ?? 'public';
  const params = op?.parameters ?? [];
  const body = op?.requestBody?.content?.['application/json']?.schema;
  const okKey = op ? Object.keys(op.responses ?? {}).find((k) => k.startsWith('2')) : undefined;
  const answer = okKey ? op?.responses?.[okKey]?.content?.['application/json']?.schema : undefined;

  const copy = async () => {
    if (!e) return;
    try {
      await navigator.clipboard.writeText(`${e.method.toUpperCase()} ${e.path}`);
      toast(t('platform.dev.api.copied'));
    } catch {
      // the clipboard can be blocked, the path stays selectable
    }
  };

  return (
    <Sheet open={!!e} onClose={onClose} title={op?.summary ?? ''}>
      {e && op ? (
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-2">
            <MethodBadge method={e.method} />
            <span className="code-path flex-1 select-all" style={{ color: 'var(--c-ink)' }}>{e.path}</span>
            <button type="button" className="icon-btn -mt-2" onClick={() => void copy()} aria-label={t('platform.dev.api.copyPath')}><IconCopy size={18} /></button>
          </div>

          <Group footer={t(`platform.dev.api.accessLine.${access}`)}>
            <Row chevron={false} title={t(`platform.dev.api.access.${access}`)} />
          </Group>

          {op['x-permissions']?.length ? (
            <section>
              <h3 className="t-foot t-2 font-normal m-0 mb-2 px-1">{t('platform.dev.api.permissions')}</h3>
              <div className="flex flex-wrap gap-2">
                {op['x-permissions'].map((p) => <span key={p} className="chip font-mono" style={{ cursor: 'default', fontSize: 13, minHeight: 30 }}>{p}</span>)}
              </div>
            </section>
          ) : null}

          {params.length ? (
            <Group title={t('platform.dev.api.params')}>
              {params.map((p) => (
                <Row key={`${p.in}:${p.name}`} chevron={false}
                  title={<span className="font-mono">{p.name}</span>}
                  subtitle={`${p.in === 'path' ? t('platform.dev.api.inPath') : t('platform.dev.api.inQuery')} · ${p.required ? t('platform.dev.api.required') : t('platform.dev.api.optional')}`} />
              ))}
            </Group>
          ) : null}

          <section>
            <h3 className="t-foot t-2 font-normal m-0 mb-2 px-1">{t('platform.dev.api.body')}</h3>
            <div className="card px-4 py-2">
              {body ? <SchemaView schema={body} components={components} t={t} /> : <p className="t-foot t-2 m-0 py-1">{t('platform.dev.api.noBody')}</p>}
            </div>
          </section>

          <section>
            <h3 className="t-foot t-2 font-normal m-0 mb-2 px-1">{t('platform.dev.api.response')}{okKey ? ` · ${okKey}` : ''}</h3>
            <div className="card px-4 py-2">
              {answer ? <SchemaView schema={answer} components={components} t={t} /> : <p className="t-foot t-2 m-0 py-1">{t('platform.dev.api.noSchema')}</p>}
            </div>
          </section>

          {op['x-errors']?.length ? (
            <section>
              <h3 className="t-foot t-2 font-normal m-0 mb-2 px-1">{t('platform.dev.api.errors')}</h3>
              <div className="flex flex-wrap gap-2">
                {op['x-errors'].map((code) => <span key={code} className="chip font-mono" style={{ cursor: 'default', fontSize: 13, minHeight: 30 }}>{code}</span>)}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
