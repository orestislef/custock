'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { JoinLink, ScopeType } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Empty, Why } from '@/components/ui/kit';
import { Sheet, Tip, useToast } from '@/components/ui/client-kit';
import { Qr } from '@/components/ui/qr';
import { IconLink, IconPlus, IconPrint } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { number, percent } from '@/lib/format';

export default function JoinLinksPage() {
  const { api, org, t, locale, can, shops } = useAdmin();
  const links = useAsync(() => (can('joinlinks.manage', null) ? api.joinLinks(org.orgId) : Promise.resolve([])), []);
  const groups = useAsync(() => api.groups(org.orgId), []);
  const [creating, setCreating] = useState(false);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const scopeName = (l: JoinLink) => l.scopeType === 'org' ? org.name : l.scopeType === 'group' ? groups.data?.find((g) => g.id === l.scopeId)?.name ?? '' : shops.find((s) => s.id === l.scopeId)?.name ?? '';

  if (!can('joinlinks.manage', null)) return <Page title={t('links.title')}><Why>{t('common:error.forbidden')}</Why></Page>;

  return (
    <Page title={t('links.title')} actions={<button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={18} />{t('links.new')}</button>}>
      <Tip id="links-label">{t('links.tip')}</Tip>
      {links.data && !links.data.length ? (
        <Empty icon={<IconLink size={40} />} title={t('links.emptyTitle')} body={t('links.emptyBody')} />
      ) : (
        <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 list-none p-0 m-0">
          {(links.data ?? []).map((l) => (
            <li key={l.id} className="card p-4 flex gap-4">
              <Qr value={`${origin}${l.url}`} size={104} label={t('links.qrFor', { label: l.label ?? scopeName(l) })} />
              <div className="min-w-0 flex-1 flex flex-col">
                <p className="t-headline m-0 truncate">{l.label ?? t('links.noLabel')}</p>
                <p className="t-foot t-2 m-0 mt-0.5 truncate">{scopeName(l)} · <Link href={l.url}>{l.url}</Link></p>
                <p className="t-sub m-0 mt-3 tnum">
                  {t('links.stats', { opens: number(l.opens, locale), signups: number(l.signups, locale) })}
                </p>
                <p className="t-foot t-2 m-0 mt-0.5">{t('links.conversion', { pct: percent(l.confirmed / Math.max(1, l.opens), locale) })}</p>
                <span className="flex-1" />
                <Link href={`/admin/print/${l.id}`} className="btn btn-tinted mt-3 self-start"><IconPrint size={18} />{t('links.poster')}</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <NewLink open={creating} onClose={() => setCreating(false)} onCreated={() => void links.reload()} />
    </Page>
  );
}

function NewLink({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { api, org, t, can, shops } = useAdmin();
  const toast = useToast();
  const options: { type: ScopeType; id: string; name: string }[] = [
    ...(org.orgPerms.includes('joinlinks.manage') ? [{ type: 'org' as const, id: org.orgId, name: t('common:scope.org') }] : []),
    ...shops.filter((s) => can('joinlinks.manage', s.id)).map((s) => ({ type: 'shop' as const, id: s.id, name: s.name })),
  ];
  const [i, setI] = useState(0);
  const [label, setLabel] = useState('');

  async function create() {
    const o = options[i];
    if (!o) return;
    try {
      await api.createJoinLink(org.orgId, { scopeType: o.type, scopeId: o.id, label: label.trim() || undefined });
      toast(t('links.created'));
      setLabel('');
      onClose();
      onCreated();
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('links.new')} footer={<button type="button" className="btn btn-primary btn-large" onClick={() => void create()}>{t('common:action.add')}</button>}>
      <div className="list mb-2">
        <label className="row">
          <span className="row-main row-title">{t('links.for')}</span>
          <select className="t-body bg-transparent border-0 outline-none text-right" style={{ color: 'var(--c-ink-2)' }} value={i} onChange={(e) => setI(Number(e.target.value))}>
            {options.map((o, k) => <option key={o.id} value={k}>{o.name}</option>)}
          </select>
        </label>
        <div className="row-sep relative"><input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('links.labelPh')} aria-label={t('links.labelPh')} /></div>
      </div>
      <p className="group-foot px-0">{t('links.labelFoot')}</p>
    </Sheet>
  );
}
