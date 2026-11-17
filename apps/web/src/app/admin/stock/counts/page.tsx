'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { StockTabs } from '@/components/admin/stock-tabs';
import { Empty, Group, Row, Segmented, Why } from '@/components/ui/kit';
import { Picker, Sheet, isMac, useShortcuts } from '@/components/ui/client-kit';
import { IconClipboard, IconPlus } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { relative } from '@/lib/format';
import { categoryName } from '@/lib/use-names';

export default function CountsPage() {
  const { api, org, t, locale, can, shops, shopId } = useAdmin();
  const router = useRouter();
  const allowed = can('stock.count', null) || can('stock.count.approve', null);
  const list = useAsync(() => (allowed ? api.counts(org.orgId, shopId ? { shopId } : undefined) : Promise.resolve([])), [shopId, allowed]);
  const [starting, setStarting] = useState(false);
  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? '';
  const canStart = shops.some((s) => can('stock.count', s.id));
  useShortcuts({ create: useCallback(() => { if (canStart) setStarting(true); }, [canStart]) });

  if (!allowed) return <Page title={t('counts.title')}><Why>{t('common:error.forbidden')}</Why></Page>;
  const open = (list.data ?? []).filter((c) => c.status === 'open' || c.status === 'review');
  const done = (list.data ?? []).filter((c) => c.status === 'applied' || c.status === 'cancelled');

  return (
    <Page title={t('counts.title')}
      actions={canStart && list.data?.length ? <button type="button" className="btn btn-primary" title={`${t('counts.start')} (${isMac() ? '⌘' : 'Ctrl+'}N)`} onClick={() => setStarting(true)}><IconPlus size={18} />{t('counts.start')}</button> : null}
      phoneAction={canStart && list.data?.length ? <button type="button" className="icon-btn" style={{ background: 'var(--c-accent-tint)' }} aria-label={t('counts.start')} onClick={() => setStarting(true)}><IconPlus size={22} /></button> : undefined}>
      <StockTabs />
      {list.data && !list.data.length ? (
        <Empty icon={<IconClipboard size={40} />} title={t('counts.emptyTitle')} body={t('counts.emptyBody')}
          action={canStart ? <button type="button" className="btn btn-primary" onClick={() => setStarting(true)}><IconPlus size={18} />{t('counts.start')}</button> : undefined} />
      ) : (
        <>
          {open.length ? (
            <Group title={t('counts.open')} footer={t('counts.openFoot')}>
              {open.map((c) => (
                <Row key={c.id} href={`/admin/stock/counts/${c.id}`} title={`${shopName(c.shopId)} · ${t(`counts.kind.${c.kind}`)}`}
                  subtitle={`${t(`counts.status.${c.status}`)} · ${t('counts.lines', { count: c.lines.length })} · ${relative(c.startedAt, locale)}`} />
              ))}
            </Group>
          ) : null}
          {done.length ? (
            <Group title={t('counts.done')}>
              {done.map((c) => (
                <Row key={c.id} href={`/admin/stock/counts/${c.id}`} title={`${shopName(c.shopId)} · ${t(`counts.kind.${c.kind}`)}`}
                  subtitle={`${t(`counts.status.${c.status}`)} · ${relative(c.appliedAt ?? c.startedAt, locale)}`} />
              ))}
            </Group>
          ) : null}
        </>
      )}
      <StartSheet open={starting} onClose={() => setStarting(false)} onStarted={(id) => router.push(`/admin/stock/counts/${id}`)} />
    </Page>
  );
}

function StartSheet({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: (id: string) => void }) {
  const { api, org, t, locale, can, shops, shopId } = useAdmin();
  const [error, setError] = useState<string | null>(null);
  const allowed = shops.filter((s) => can('stock.count', s.id));
  const [shop, setShop] = useState(shopId && allowed.some((s) => s.id === shopId) ? shopId : allowed[0]?.id ?? '');
  const [kind, setKind] = useState<'full' | 'partial'>('partial');
  const cats = useAsync(() => (open ? api.categories(org.orgId) : Promise.resolve([])), [open]);
  const [cat, setCat] = useState('');

  async function start() {
    try {
      const c = await api.startCount(org.orgId, shop, { kind, filter: kind === 'partial' && cat ? { categoryId: cat } : null });
      onClose();
      onStarted(c.id);
    } catch (e) {
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('counts.start')} error={error} footer={<button type="button" className="btn btn-primary btn-large" disabled={!shop} onClick={() => void start()}>{t('counts.startButton')}</button>}>
      <ul className="list mb-4" role="list">
        <li className="row">
          <span className="row-main row-title">{t('stockSheet.shop')}</span>
          <Picker variant="plain" label={t('stockSheet.shop')} value={shop} onChange={setShop} options={allowed.map((s) => ({ value: s.id, label: s.name }))} />
        </li>
      </ul>
      <section className="inset-group">
        <div className="px-1"><Segmented label={t('counts.kindLabel')} value={kind} onChange={setKind} options={[{ value: 'partial', label: t('counts.kind.partial') }, { value: 'full', label: t('counts.kind.full') }]} /></div>
        <p className="inset-group-foot">{t(`counts.kindFoot.${kind}`)}</p>
      </section>
      {kind === 'partial' ? (
        <ul className="list mb-2" role="list">
          <li className="row">
            <span className="row-main row-title">{t('stock.form.category')}</span>
            <Picker variant="plain" label={t('stock.form.category')} value={cat} onChange={setCat} options={[{ value: '', label: t('counts.anyCategory') }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: categoryName(c, locale) }))]} />
          </li>
        </ul>
      ) : null}
    </Sheet>
  );
}
