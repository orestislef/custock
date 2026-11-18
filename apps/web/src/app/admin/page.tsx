'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { TFunction } from '@custock/i18n';
import { uuidv7, type Movement, type Transfer } from '@custock/core';
import { useAdmin, useShopFilter } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Tally } from '@/components/ui/tally';
import { Tip, useToast } from '@/components/ui/client-kit';
import { Group, Row, IconTile, signed } from '@/components/ui/kit';
import { ProductPicker, type PickedVariant } from '@/components/admin/product-picker';
import { StockSheet, type StockMode } from '@/components/admin/stock-sheet';
import {
  IconBarcode, IconBell, IconCheck, IconHalf, IconPeople, IconSlash, IconTruck, IconWarning, IconMegaphone, IconClipboard, IconMinus, IconPlus,
} from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { useNames } from '@/lib/use-names';
import { AppIcon, InstallCoach } from '@/components/pwa/install-coach';
import { PushCard } from '@/components/pwa/push-card';
import { basePath } from '@/lib/api-client';
import { date, qtyNumber, relative } from '@/lib/format';

// home answers "what needs me" first, then what changed, then a few numbers as a list.
// staff get their own today: the actions they do all day and what they did last.
// read at the moment of a tap, not while rendering
const clock = () => Date.now();

export default function Home() {
  const { can, org } = useAdmin();
  const staffLike = !can('reports.view', null) && !can('members.view', null) && (can('stock.sell', null) || can('stock.receive', null));
  return staffLike ? <StaffToday /> : <ManagerHome key={org.orgId} />;
}

function greeting(t: TFunction, name: string, now: number) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Athens' }).format(now));
  return t(hour < 12 ? 'dash.morning' : hour < 18 ? 'dash.afternoon' : 'dash.evening', { name });
}

function ManagerHome() {
  const { api, org, t, locale, can, me, shops } = useAdmin();
  const shopId = useShopFilter();
  const cards = useAsync(() => api.dashboard(org.orgId, shopId), [shopId]);
  const recent = useAsync(() => (can('stock.history.view') ? api.movements(org.orgId, { shopId, limit: 6 }) : Promise.resolve(null)), [shopId]);
  const names = useNames(api, org.orgId, locale);
  const [now] = useState(Date.now);
  const d = cards.data;
  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? '';

  const needs = d
    ? [
        can('posts.publish', null) && d.pendingApprovals > 0 && { key: 'approvals', n: d.pendingApprovals, href: '/admin/posts?status=pending_approval', icon: <IconMegaphone size={18} /> },
        can('stock.count.approve', null) && d.countsInReview > 0 && { key: 'counts', n: d.countsInReview, href: '/admin/stock/counts', icon: <IconClipboard size={18} /> },
        (can('products.create', null) || can('products.edit', null)) && d.unknownCodes > 0 && { key: 'unknown', n: d.unknownCodes, href: '/admin/stock?filter=unknown', icon: <IconBarcode size={18} /> },
        can('stock.adjust', null) && d.negativeStock > 0 && { key: 'negative', n: d.negativeStock, href: '/admin/stock?filter=negative', icon: <IconWarning size={18} />, tone: 'neg' as const },
        can('stock.transfer.receive', null) && d.transfersOnTheWay > 0 && { key: 'transfers', n: d.transfersOnTheWay, href: '/admin/stock/transfers', icon: <IconTruck size={18} /> },
      ].filter(Boolean) as { key: string; n: number; href: string; icon: React.ReactNode; tone?: 'neg' }[]
    : [];
  // someone who never has anything to act on gets no "needs you" section at all
  const actsOnThings = ['posts.publish', 'stock.count.approve', 'products.create', 'products.edit', 'stock.adjust', 'stock.transfer.receive'].some((p) => can(p, null));

  const stats: { key: string; value: number | null; href: string; icon: React.ReactNode }[] = [
    { key: 'waiting', value: d?.peopleWaiting ?? null, href: '/admin/stock?filter=waiting', icon: <IconBell size={18} /> },
    { key: 'lowStock', value: d?.lowStock ?? null, href: '/admin/stock?filter=low', icon: <IconHalf size={18} /> },
    { key: 'outOfStock', value: d?.outOfStock ?? null, href: '/admin/stock?filter=out', icon: <IconSlash size={18} /> },
    ...(can('customers.view', null) ? [{ key: 'newFollowers', value: d?.newFollowersWeek ?? null, href: '/admin/customers', icon: <IconPeople size={18} /> }] : []),
    ...(can('posts.view', null) ? [{ key: 'scheduled', value: d?.scheduledPosts ?? null, href: '/admin/posts?status=scheduled', icon: <IconMegaphone size={18} /> }] : []),
  ];

  return (
    <Page title={greeting(t, me.user.displayName?.split(' ')[0] ?? '', now)} subtitle={date(now, locale, { weekday: 'long', day: 'numeric', month: 'long' })}>
      {can('joinlinks.manage', null) ? <Tip id="dash-qr">{t('dash.tipQr')}</Tip> : null}
      <StaffCoach />
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-x-6 items-start">
        <div>
          {actsOnThings ? (
            <Group title={t('dash.needsYou')} footer={d && !needs.length ? t('dash.allClear') : undefined}>
              {!d ? <Row title={<span className="inline-block h-4 w-40 skel" />} /> : needs.length ? needs.map((n) => (
                <Row key={n.key} href={n.href} leading={<IconTile tone={n.tone}>{n.icon}</IconTile>} title={t(`dash.need.${n.key}`, { count: n.n })} />
              )) : <Row leading={<IconTile tone="ok"><IconCheck size={18} /></IconTile>} title={t('dash.nothing')} />}
            </Group>
          ) : null}

          <Group title={t('dash.atAGlance')}>
            {stats.map((s) => (
              <Row key={s.key} href={s.href} leading={<IconTile>{s.icon}</IconTile>} title={t(`dash.${s.key}`)}
                value={s.value == null ? <span className="inline-block w-6 h-4 skel" /> : <span className="t-headline" style={{ color: 'var(--c-ink)' }}><Tally value={s.value} /></span>} />
            ))}
          </Group>
        </div>

        {recent.data ? (
          <Group title={t('dash.recent')} footer={<Link href="/admin/stock">{t('common:action.seeAll')}</Link>}>
            {!recent.data.items.length ? <Row title={<span className="t-2">{t('dash.recentEmpty')}</span>} /> : null}
            {recent.data.items.map((m) => (
              <Row
                key={m.id}
                title={m.productName ?? names.variant(m.variantId, t(`common:movement.${m.kind}`))}
                subtitle={`${t(`common:movement.${m.kind}`)} · ${shopName(m.shopId)} · ${m.createdByName ?? ''} · ${relative(m.recordedAt, locale)}`}
                value={<span style={{ color: m.qtyDelta > 0 ? 'var(--c-success)' : 'var(--c-ink-2)' }}>{signed(m.qtyDelta, qtyNumber(Math.abs(m.qtyDelta), names.uom(m.variantId), locale))}</span>}
              />
            ))}
          </Group>
        ) : null}
      </div>
    </Page>
  );
}

// staff: big actions, what is on the way, and the last things they did with undo
function StaffToday() {
  const { api, org, t, locale, can, me, shops, shopId } = useAdmin();
  const toast = useToast();
  const names = useNames(api, org.orgId, locale);
  const [now] = useState(Date.now);
  const [mode, setMode] = useState<StockMode | null>(null);
  const [picked, setPicked] = useState<PickedVariant | null>(null);
  // the list needs history access. staff without it still get the actions above
  const canHistory = shopId ? can('stock.history.view', shopId) : shops.some((s) => can('stock.history.view', s.id));
  const mine = useAsync(() => (canHistory ? api.movements(org.orgId, { shopId: shopId ?? undefined, limit: 60 }).catch(() => null) : Promise.resolve(null)), [shopId, canHistory]);
  const incoming = useAsync(() => (can('stock.transfer.receive', null) ? api.transfers(org.orgId, { status: 'sent' }) : Promise.resolve([] as Transfer[])), []);
  const myMoves = (mine.data?.items ?? []).filter((m) => m.createdBy === me.user.id).slice(0, 10);
  const toMe = (incoming.data ?? []).filter((x) => can('stock.transfer.receive', x.toShopId));
  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? '';

  async function undo(m: Movement) {
    try {
      await api.postMovements(org.orgId, [{ id: uuidv7(), shopId: m.shopId, variantId: m.variantId, qtyDelta: -m.qtyDelta, kind: 'reversal', refType: 'reversal', refId: m.id, occurredAt: clock() }]);
      toast(t('stockSheet.undone'));
      void mine.reload();
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  const actions = [
    can('stock.sell', null) && { mode: 'sell' as StockMode, label: t('today.sell'), icon: <IconMinus size={22} /> },
    can('stock.receive', null) && { mode: 'receive' as StockMode, label: t('today.receive'), icon: <IconPlus size={22} /> },
  ].filter(Boolean) as { mode: StockMode; label: string; icon: React.ReactNode }[];

  return (
    <Page title={t('today.title')} subtitle={`${greeting(t, me.user.displayName?.split(' ')[0] ?? '', now)} · ${date(now, locale, { weekday: 'long', day: 'numeric', month: 'long' })}`}>
      <StaffCoach />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        {actions.map((a) => (
          <button key={a.mode} type="button" className="card p-4 text-left border-0 cursor-pointer flex flex-col gap-3 min-h-[96px]" onClick={() => setMode(a.mode)}>
            <span className="icon-tile">{a.icon}</span>
            <span className="t-headline">{a.label}</span>
          </button>
        ))}
        {can('stock.count', null) ? (
          <Link href="/admin/stock/counts" className="card p-4 flex flex-col gap-3 min-h-[96px] hover:no-underline" style={{ color: 'var(--c-ink)' }}>
            <span className="icon-tile"><IconClipboard size={22} /></span>
            <span className="t-headline">{t('today.count')}</span>
          </Link>
        ) : null}
      </div>

      {toMe.length ? (
        <Group title={t('transfers.group.incoming')}>
          {toMe.map((x) => (
            <Row key={x.id} href={`/admin/stock/transfers/${x.id}`} leading={<IconTile><IconTruck size={18} /></IconTile>}
              title={shopName(x.fromShopId) ? t('today.fromShop', { shop: shopName(x.fromShopId) }) : t('today.fromOther')} subtitle={t('transfers.items', { count: x.lines.reduce((a, l) => a + l.qtySent, 0) })} />
          ))}
        </Group>
      ) : null}

      {canHistory ? <Group title={t('today.mine')} footer={myMoves.length ? t('today.mineFoot') : undefined}>
        {myMoves.length ? myMoves.map((m) => (
          <Row key={m.id} title={m.productName ?? names.variant(m.variantId, t(`common:movement.${m.kind}`))}
            subtitle={`${t(`common:movement.${m.kind}`)} · ${shopName(m.shopId)} · ${relative(m.recordedAt, locale)}`}
            trailing={
              <span className="inline-flex items-center gap-2">
                <span className="tnum" style={{ color: m.qtyDelta > 0 ? 'var(--c-success)' : 'var(--c-ink-2)' }}>{signed(m.qtyDelta, qtyNumber(Math.abs(m.qtyDelta), names.uom(m.variantId), locale))}</span>
                {m.kind !== 'reversal' && now - m.recordedAt < 3_600_000 ? <button type="button" className="btn btn-plain" onClick={() => void undo(m)}>{t('common:action.undo')}</button> : null}
              </span>
            } />
        )) : <Row title={<span className="t-2">{t('today.nothingYet')}</span>} />}
      </Group> : null}

      <ProductPicker open={mode != null && !picked} title={mode === 'sell' ? t('today.sell') : t('today.receive')} onClose={() => setMode(null)} onPick={(p) => setPicked(p)} />
      {mode && picked ? (
        <StockSheet open mode={mode} product={picked.product} variantId={picked.variantId}
          onClose={() => { setMode(null); setPicked(null); }}
          onDone={() => { void mine.reload(); }} />
      ) : null}
    </Page>
  );
}

// "add custock to your home screen", on phones only, closable for good
function StaffCoach() {
  const { t, api } = useAdmin();
  return (
    <>
      <div className="md:hidden">
        <InstallCoach place="staff-home" appName="Custock" className="mb-6"
          icon={<AppIcon src={`${basePath}/icons/icon-192.png`} size={48} label="Custock" />} body={t('pwa.staffCoachBody')} />
      </div>
      <PushCard api={api} orgId={null} place="staff-home" className="mb-6 max-w-[640px]" installCoachShown
        title={t('push.card.staffTitle')} body={t('push.card.staffBody')} later={t('push.card.staffLater')}
        onTitle={t('push.card.staffOnTitle')} onBody={t('push.card.staffOnBody')}
        appName="Custock" appIcon={<AppIcon src={`${basePath}/icons/icon-192.png`} size={44} label="Custock" />} />
    </>
  );
}
