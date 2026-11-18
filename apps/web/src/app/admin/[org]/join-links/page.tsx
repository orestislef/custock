'use client';

import Link from '@/components/admin/org-link';
import { useState } from 'react';
import type { JoinLink, ScopeType } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Empty, Switch } from '@/components/ui/kit';
import { Picker, Sheet, Tip, useToast } from '@/components/ui/client-kit';
import { Qr } from '@/components/ui/qr';
import { IconCopy, IconLink, IconPlus, IconPrint } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { basePath } from '@/lib/api-client';
import { number, percent } from '@/lib/format';
import { RedirectHome } from '@/components/admin/redirect-home';
import { cleanLine, LIMITS } from '@custock/core';

export default function JoinLinksPage() {
  const { api, org, t, locale, can, shops } = useAdmin();
  const links = useAsync(() => (can('joinlinks.manage', null) ? api.joinLinks(org.orgId) : Promise.resolve([])), []);
  const groups = useAsync(() => api.groups(org.orgId), []);
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const origin = typeof window === 'undefined' ? '' : window.location.origin + basePath;
  const scopeName = (l: JoinLink) => l.scopeType === 'org' ? org.name : l.scopeType === 'group' ? groups.data?.find((g) => g.id === l.scopeId)?.name ?? '' : shops.find((s) => s.id === l.scopeId)?.name ?? '';

  if (!can('joinlinks.manage', null)) return <RedirectHome />;

  return (
    <Page title={t('links.title')} actions={<button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={18} />{t('links.new')}</button>}
      phoneAction={<button type="button" className="icon-btn" style={{ background: 'var(--c-accent-tint)' }} aria-label={t('links.new')} onClick={() => setCreating(true)}><IconPlus size={22} /></button>}>
      <Tip id="links-label">{t('links.tip')}</Tip>
      {links.data && !links.data.length ? (
        <Empty icon={<IconLink size={40} />} title={t('links.emptyTitle')} body={t('links.emptyBody')}
          action={<button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={18} />{t('links.new')}</button>} />
      ) : (
        <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 list-none p-0 m-0">
          {(links.data ?? []).map((l) => (
            <li key={l.id} className="card p-4 flex gap-4">
              <Qr value={`${origin}${l.url}`} size={104} label={t('links.qrFor', { label: l.label ?? scopeName(l) })} />
              <div className="min-w-0 flex-1 flex flex-col">
                <p className="t-headline m-0 truncate">{l.label ?? t('links.noLabel')}</p>
                <p className="t-foot t-2 m-0 mt-0.5 truncate">{scopeName(l)}</p>
                <p className="m-0 flex items-center gap-1 min-w-0">
                  <Link href={l.url} className="t-sub tnum block truncate min-w-0 py-3">{l.url}</Link>
                  <button type="button" className="icon-btn flex-none" style={{ width: 44, height: 44, color: 'var(--c-ink-2)' }} aria-label={t('links.copy', { url: l.url })} title={t('links.copy', { url: l.url })}
                    onClick={() => void navigator.clipboard.writeText(`${origin}${l.url}`).then(() => toast(t('links.copied')))}><IconCopy size={18} /></button>
                </p>
                <p className="t-sub m-0 mt-3 tnum">
                  {t('links.stats', { opens: number(l.opens, locale), signups: number(l.signups, locale) })}
                </p>
                <p className="t-foot t-2 m-0 mt-0.5">{t('links.conversion', { pct: percent(l.confirmed / Math.max(1, l.opens), locale) })}</p>
                <span className="flex-1" />
                <span className="flex items-center gap-2 mt-3 flex-wrap">
                  {/* the column next to the code is narrow on a phone: a long label wraps instead of running out of the card */}
                  <Link href={`/admin/print/${l.id}`} className="btn btn-tinted max-w-full whitespace-normal text-center py-2" aria-disabled={l.disabled}><IconPrint size={18} className="flex-none" />{t('links.poster')}</Link>
                  <label className="inline-flex items-center gap-2 t-foot t-2 ml-auto">
                    {l.disabled ? t('links.off') : t('links.on')}
                    <Switch checked={!l.disabled} label={t('links.activeFor', { label: l.label ?? scopeName(l) })}
                      onChange={(on) => void api.updateJoinLink(org.orgId, l.id, { disabled: !on }).then(() => links.reload()).catch((e: { code?: string }) => toast(t(`common:error.${e.code ?? 'internal'}`)))} />
                  </label>
                </span>
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
  const [i, setI] = useState('0');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const o = options[Number(i)];
    if (!o) return;
    setError(null);
    try {
      await api.createJoinLink(org.orgId, { scopeType: o.type, scopeId: o.id, label: label.trim() || undefined });
      toast(t('links.created'));
      setLabel('');
      onClose();
      onCreated();
    } catch (e) {
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('links.new')} error={error} footer={<button type="button" className="btn btn-primary btn-large" onClick={() => void create()}>{t('common:action.add')}</button>}>
      <ul className="list mb-2" role="list">
        <li className="row">
          <span className="row-main row-title">{t('links.for')}</span>
          <Picker variant="plain" label={t('links.for')} value={i} onChange={setI} options={options.map((o, k) => ({ value: String(k), label: o.name }))} />
        </li>
        <li><label className="block row-sep relative"><span className="field-label">{t('links.labelPh')}</span><input className="field pt-1" autoComplete="off" autoCapitalize="sentences" enterKeyHint="done" maxLength={LIMITS.joinLabel} value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => setLabel((v) => cleanLine(v))} /></label></li>
      </ul>
      <p className="inset-group-foot px-0">{t('links.labelFoot')}</p>
    </Sheet>
  );
}
