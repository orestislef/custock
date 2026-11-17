'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Transfer } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { StockTabs } from '@/components/admin/stock-tabs';
import { ProductPicker } from '@/components/admin/product-picker';
import { Empty, Group, Row, Why } from '@/components/ui/kit';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { IconClose, IconPlus, IconTruck } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { productName } from '@/lib/names';
import { relative } from '@/lib/format';

export default function TransfersPage() {
  const { api, org, t, locale, can, shops, shopId } = useAdmin();
  const router = useRouter();
  const allowed = can('stock.transfer.send', null) || can('stock.transfer.receive', null);
  const list = useAsync(() => (allowed ? api.transfers(org.orgId, shopId ? { shopId } : undefined) : Promise.resolve([])), [shopId, allowed]);
  const [creating, setCreating] = useState(false);
  // names of every shop, also the ones outside this member's reach
  const allShops = useAsync(() => api.shops(org.orgId), []);
  const name = (id: string) => (allShops.data ?? shops).find((s) => s.id === id)?.name ?? t('transfers.otherShop');

  if (!allowed) return <Page title={t('transfers.title')}><Why>{t('common:error.forbidden')}</Why></Page>;
  const items = list.data ?? [];
  const groups: { key: string; items: Transfer[] }[] = [
    { key: 'incoming', items: items.filter((x) => x.status === 'sent' && can('stock.transfer.receive', x.toShopId)) },
    { key: 'outgoing', items: items.filter((x) => x.status === 'sent' && !can('stock.transfer.receive', x.toShopId)) },
    { key: 'drafts', items: items.filter((x) => x.status === 'draft') },
    { key: 'done', items: items.filter((x) => x.status === 'received' || x.status === 'cancelled') },
  ];

  return (
    <Page title={t('transfers.title')} actions={shops.some((s) => can('stock.transfer.send', s.id)) ? <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={18} />{t('transfers.new')}</button> : null}>
      <StockTabs />
      {list.data && !items.length ? <Empty icon={<IconTruck size={40} />} title={t('transfers.emptyTitle')} body={t('transfers.emptyBody')} /> : null}
      {groups.filter((g) => g.items.length).map((g) => (
        <Group key={g.key} title={t(`transfers.group.${g.key}`)} footer={g.key === 'incoming' ? t('transfers.incomingFoot') : undefined}>
          {g.items.map((x) => (
            <Row key={x.id} href={`/admin/stock/transfers/${x.id}`} leading={<span className="icon-tile" style={{ background: x.status === 'sent' ? 'var(--c-info)' : 'var(--c-ink-3)' }}><IconTruck size={18} /></span>}
              title={`${name(x.fromShopId)} → ${name(x.toShopId)}`}
              subtitle={`${t(`transfers.status.${x.status}`)} · ${t('transfers.items', { count: x.lines.reduce((a, l) => a + l.qtySent, 0) })} · ${relative(x.sentAt ?? x.createdAt, locale)}`} />
          ))}
        </Group>
      ))}
      <NewTransfer open={creating} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/admin/stock/transfers/${id}`)} />
    </Page>
  );
}

function NewTransfer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { api, org, t, locale, can, shops, shopId } = useAdmin();
  const toast = useToast();
  const from = shops.filter((s) => can('stock.transfer.send', s.id));
  const allShops = useAsync(() => (open ? api.shops(org.orgId) : Promise.resolve([])), [open]);
  const [fromId, setFrom] = useState(shopId && from.some((s) => s.id === shopId) ? shopId : from[0]?.id ?? '');
  const [toId, setTo] = useState('');
  const [lines, setLines] = useState<{ variantId: string; name: string; qty: number }[]>([]);
  const [picking, setPicking] = useState(false);
  const targets = (allShops.data ?? []).filter((s) => s.id !== fromId);

  async function create() {
    try {
      const x = await api.createTransfer(org.orgId, { fromShopId: fromId, toShopId: toId || targets[0]!.id, lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) });
      onClose();
      setLines([]);
      onCreated(x.id);
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('transfers.new')}
      footer={<button type="button" className="btn btn-primary btn-large" disabled={!fromId || !targets.length || !lines.length} onClick={() => void create()}>{t('transfers.saveDraft')}</button>}>
      <div className="list mb-4">
        <label className="row">
          <span className="row-main row-title">{t('transfers.from')}</span>
          <select className="t-body bg-transparent border-0 outline-none text-right" style={{ color: 'var(--c-ink-2)' }} value={fromId} onChange={(e) => setFrom(e.target.value)}>
            {from.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="row">
          <span className="row-main row-title">{t('transfers.to')}</span>
          <select className="t-body bg-transparent border-0 outline-none text-right" style={{ color: 'var(--c-ink-2)' }} value={toId || targets[0]?.id || ''} onChange={(e) => setTo(e.target.value)}>
            {targets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <section className="group">
        <h3 className="group-head">{t('transfers.lines')}</h3>
        <div className="list">
          {lines.map((l, i) => (
            <div key={l.variantId} className="row">
              <span className="row-main row-title">{l.name}</span>
              <input className="t-body tnum text-right bg-transparent border-0 outline-none w-16 rounded-[8px] px-2 py-1" style={{ background: 'var(--c-fill)' }} inputMode="numeric"
                aria-label={t('stockSheet.qty')} value={l.qty} onChange={(e) => { const n = Math.max(1, Number(e.target.value) || 1); setLines((x) => x.map((y, j) => (j === i ? { ...y, qty: n } : y))); }} />
              <button type="button" className="icon-btn" aria-label={t('common:action.remove')} onClick={() => setLines((x) => x.filter((_, j) => j !== i))}><IconClose size={18} /></button>
            </div>
          ))}
          <button type="button" className="row" style={{ color: 'var(--c-accent)' }} onClick={() => setPicking(true)}><IconPlus size={20} /><span className="row-main row-title">{t('counts.addProduct')}</span></button>
        </div>
        <p className="group-foot">{t('transfers.draftFoot')}</p>
      </section>
      <ProductPicker open={picking} title={t('counts.addProduct')} onClose={() => setPicking(false)}
        onPick={({ product, variantId }) => { setPicking(false); if (!lines.some((l) => l.variantId === variantId)) setLines((x) => [...x, { variantId, name: productName(product, locale), qty: 1 }]); }} />
    </Sheet>
  );
}
