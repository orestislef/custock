'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { StockTabs } from '@/components/admin/stock-tabs';
import { Empty, Group, Row, Segmented, Why } from '@/components/ui/kit';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { IconCheck, IconPlus } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { relative } from '@/lib/format';

export default function CountsPage() {
  const { api, org, t, locale, can, shops, shopId } = useAdmin();
  const router = useRouter();
  const allowed = can('stock.count', null) || can('stock.count.approve', null);
  const list = useAsync(() => (allowed ? api.counts(org.orgId, shopId ? { shopId } : undefined) : Promise.resolve([])), [shopId, allowed]);
  const [starting, setStarting] = useState(false);
  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? '';
  const canStart = shops.some((s) => can('stock.count', s.id));

  if (!allowed) return <Page title={t('counts.title')}><Why>{t('common:error.forbidden')}</Why></Page>;
  const open = (list.data ?? []).filter((c) => c.status === 'open' || c.status === 'review');
  const done = (list.data ?? []).filter((c) => c.status === 'applied' || c.status === 'cancelled');

  return (
    <Page title={t('counts.title')} actions={canStart ? <button type="button" className="btn btn-primary" onClick={() => setStarting(true)}><IconPlus size={18} />{t('counts.start')}</button> : null}>
      <StockTabs />
      {list.data && !list.data.length ? (
        <Empty icon={<IconCheck size={40} />} title={t('counts.emptyTitle')} body={t('counts.emptyBody')} />
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
  const { api, org, t, can, shops, shopId } = useAdmin();
  const toast = useToast();
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
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('counts.start')} footer={<button type="button" className="btn btn-primary btn-large" disabled={!shop} onClick={() => void start()}>{t('counts.startButton')}</button>}>
      <div className="list mb-4">
        <label className="row">
          <span className="row-main row-title">{t('stockSheet.shop')}</span>
          <select className="t-body bg-transparent border-0 outline-none text-right" style={{ color: 'var(--c-ink-2)' }} value={shop} onChange={(e) => setShop(e.target.value)}>
            {allowed.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <section className="group">
        <div className="px-1"><Segmented label={t('counts.kindLabel')} value={kind} onChange={setKind} options={[{ value: 'partial', label: t('counts.kind.partial') }, { value: 'full', label: t('counts.kind.full') }]} /></div>
        <p className="group-foot">{t(`counts.kindFoot.${kind}`)}</p>
      </section>
      {kind === 'partial' ? (
        <div className="list mb-2">
          <select className="field" aria-label={t('stock.form.category')} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t('counts.anyCategory')}</option>
            {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      ) : null}
    </Sheet>
  );
}
