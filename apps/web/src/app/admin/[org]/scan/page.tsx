'use client';

// scanning, the main input for stock work on a phone. modes come from permissions: look up opens
// the product, sell takes one off with undo, receive and transfer keep a running list to confirm
// once, count adds to a count on the server (several phones can count one shop). sales and
// deliveries made without signal wait in the outbox (src/lib/outbox.ts).

import Link from '@/components/admin/org-link';
import { useSearchParams } from 'next/navigation';
import { useOrgRouter as useRouter } from '@/components/admin/org-link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScanFilter, ean13, featureOn, uuidv7, type MovementBatchResult, type Product, type ScanResult, type Shop, type StockCount, type StockLevel } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { OutboxBadge } from '@/components/admin/outbox-badge';
import { Camera, SAME_CODE_GAP_MS } from '@/components/scan/camera';
import { armScanSound, scanSound } from '@/lib/scan-sound';
import { useToast } from '@/components/ui/client-kit';
import { Chips, Why } from '@/components/ui/kit';
import { IconBarcode, IconCheck, IconKeyboard, IconMinus, IconPlus, IconShop, IconTruck } from '@/components/ui/icons';
import { Tally } from '@/components/ui/tally';
import { apiMode } from '@/lib/api-client';
import { lookupCached, syncShops } from '@/lib/catalog-cache';
import { devBuild } from '@/lib/env';
import { qtyNumber } from '@/lib/format';
import { productName } from '@/lib/names';
import { isNetworkError, submitMovements, useOnline } from '@/lib/outbox';
import { symbology } from '@/lib/scanner';
import { RedirectHome } from '@/components/admin/redirect-home';

type Mode = 'lookup' | 'sell' | 'receive' | 'count' | 'transfer';
const MODES: Mode[] = ['lookup', 'sell', 'receive', 'count', 'transfer'];
const MODE_KEY = 'custock.scan.mode';
const MODE_PERM: Record<Mode, string> = { lookup: 'products.view', receive: 'stock.receive', sell: 'stock.sell', count: 'stock.count', transfer: 'stock.transfer.send' };

interface Line { variantId: string; product: Product; qty: number; expected: number }

// read at the moment of a scan or a tap, never while rendering
const now = () => Date.now();

export default function ScanPage() {
  return <Suspense><Scan /></Suspense>;
}

function Scan() {
  const { api, org, t, locale, can, shopId, shops, me } = useAdmin();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const online = useOnline();

  // the shop we scan in: the one selected, else the first where this person may change stock
  const workShop = shopId ?? org.shops.find((s) => s.perms.some((x) => x.startsWith('stock.')))?.shopId ?? org.shops[0]?.shopId ?? null;
  const canTransfer = can(MODE_PERM.transfer, workShop);
  const [allShops, setAllShops] = useState<Shop[] | null>(null);
  // transfer needs another shop to send to. a business with one shop does not get the mode at all
  const otherShops = (allShops ?? shops).filter((s) => s.id !== workShop).length;
  // count and transfer leave when a super admin switched them off for this business
  const modes = MODES.filter((m) => can(MODE_PERM[m], m === 'lookup' ? null : workShop) && (m !== 'transfer' || otherShops > 0)
    && (m !== 'count' || featureOn(org, 'counts')) && (m !== 'transfer' || featureOn(org, 'transfers')));
  const asked = params.get('mode') as Mode | null;
  // the mode asked for in the link, else the one this device used last, else sell
  const [mode, setMode] = useState<Mode>(() => {
    if (asked && modes.includes(asked)) return asked;
    let last: string | null = null;
    try { last = typeof window === 'undefined' ? null : localStorage.getItem(MODE_KEY); } catch {}
    if (last && modes.includes(last as Mode)) return last as Mode;
    return modes.includes('sell') ? 'sell' : modes[0] ?? 'lookup';
  });
  const [lines, setLines] = useState<Line[]>([]);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState<ScanResult | null>(null);
  const [toShop, setToShop] = useState<string | null>(null);
  const [archived, setArchived] = useState<Product | null>(null);
  const countId = useRef<string | null>(null);
  const inFlight = useRef(false);
  // codes read while the one before is still on its way wait here and go through in order. the
  // camera already ignores a code held still, so this only ever holds different items scanned fast
  const waiting = useRef<{ raw: string; format?: string; at: number; camera: boolean }[]>([]);
  const nextCode = useRef<(raw: string, format?: string, at?: number, camera?: boolean) => Promise<void>>(async () => {});
  // what the camera counts: one item at a time inside the frame. after a lookup it learns which
  // codes are the same item (the barcode and the qr code on one shelf label)
  const filter = useMemo(() => new ScanFilter(SAME_CODE_GAP_MS), []);
  useEffect(() => { armScanSound(); }, []);

  // keep a copy of this shop's catalog on the device, so scans resolve without signal
  useEffect(() => {
    if (workShop) void syncShops(api, org.orgId, [workShop]);
  }, [api, org.orgId, workShop]);

  useEffect(() => {
    if (!canTransfer) return;
    void api.shops(org.orgId, { all: true }).then(setAllShops).catch(() => setAllShops(shops));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, org.orgId]);
  const destinations = (allShops ?? []).filter((s) => s.id !== workShop);

  const name = useCallback((p: Pick<Product, 'name' | 'translations'>) => productName(p, locale), [locale]);
  const total = lines.reduce((n, l) => n + l.qty, 0);

  function addLine(product: Product, variantId: string, n: number, levels?: StockLevel[]) {
    const expected = levels?.find((l) => l.variantId === variantId && l.shopId === workShop)?.onHand ?? 0;
    setLines((cur) => {
      const i = cur.findIndex((l) => l.variantId === variantId);
      if (i >= 0) {
        const next = { ...cur[i]!, qty: cur[i]!.qty + n };
        return [next, ...cur.filter((_, j) => j !== i)];
      }
      return [{ variantId, product, qty: n, expected }, ...cur];
    });
  }

  function afterMovements(res: MovementBatchResult) {
    const told = res.backInStock.reduce((n, b) => n + b.notified, 0);
    if (told > 0) toast(t('product.backInStockToast', { count: told }), undefined, 6000);
    else if (res.lowStock.length) toast(t('scanner.lowStock', { count: res.lowStock.length }));
  }

  async function sellOne(product: Product, variantId: string, n: number) {
    if (!workShop) return;
    const id = uuidv7();
    // a scan's pack quantity is already in base units (pieces, or grams for a 500 g pack)
    const sent = await submitMovements(api, org.orgId, [{ id, shopId: workShop, variantId, qtyDelta: -n, kind: 'sale', occurredAt: now() }]);
    if (sent.result?.rejected.length) {
      toast(t(`common:error.${sent.result.rejected[0]!.code}`));
      return;
    }
    if (sent.result) afterMovements(sent.result);
    addLine(product, variantId, n);
    // one undo per sale: a second tap, or an undo the server refuses, never takes the line off twice
    let undone = false;
    toast(sent.queued ? t('offline.savedSale', { count: n, name: name(product) }) : t('scanner.sold', { count: n, name: name(product) }), {
      label: t('common:action.undo'),
      run: () => {
        if (undone) return;
        undone = true;
        void submitMovements(api, org.orgId, [{ id: uuidv7(), shopId: workShop, variantId, qtyDelta: n, kind: 'reversal', refType: 'reversal', refId: id, occurredAt: now() }]).then((res) => {
          const refused = res.result?.rejected[0];
          if (refused) { toast(t(`common:error.${refused.code}`)); return; }
          setLines((cur) => cur.map((l) => (l.variantId === variantId ? { ...l, qty: l.qty - n } : l)).filter((l) => l.qty > 0));
          toast(t('stockSheet.undone'));
        }, (e) => {
          undone = false;
          toast(isNetworkError(e) ? t('offline.needsSignal') : t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
        });
      },
    });
  }

  // counts live on the server, several phones can count the same shop at once
  async function countScan(product: Product, variantId: string, n: number, how: 'add' | 'set') {
    if (!workShop) return;
    if (!countId.current) {
      // carry on with this person's own open count in this shop (the page was left, the mode
      // changed), so counting from the scanner never leaves a trail of half counts behind
      const mine = (await api.counts(org.orgId, { shopId: workShop, status: 'open' }).catch(() => [] as StockCount[]))
        .filter((c) => c.kind === 'partial' && c.startedBy === me.user.id)
        .sort((a, b) => b.startedAt - a.startedAt)[0];
      countId.current = mine ? mine.id : (await api.startCount(org.orgId, workShop, { kind: 'partial' })).id;
    }
    const line = await api.setCountLine(org.orgId, countId.current, variantId, n, how);
    setLines((cur) => [{ variantId, product, qty: line.countedQty, expected: line.expectedQty }, ...cur.filter((l) => l.variantId !== variantId)]);
  }

  // at: when the code was read, so a code that waited in line is judged by when it was seen.
  // camera: from the camera, where one item can show several codes. typed codes (a keyboard or a
  // usb scanner) always count, every time.
  async function handleCode(raw: string, format?: string, at: number = now(), camera = false) {
    const value = raw.trim();
    if (!value) return;
    if (inFlight.current) {
      if (waiting.current.length < 50) waiting.current.push({ raw: value, format, at, camera });
      return;
    }
    inFlight.current = true;
    try {
      let r: ScanResult;
      try {
        r = await api.scan(org.orgId, value, format ? symbology(format) : undefined, workShop ?? undefined);
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        // no signal: the copy of this shop's catalog answers
        const hit = await lookupCached(org.orgId, workShop ? [workShop] : [], value);
        r = { codeNorm: value, kind: 'raw', valid: true, match: hit ? 'variant' : 'unknown', packQty: hit?.packQty ?? 1, product: hit?.product ?? null, variantId: hit?.variantId ?? null };
      }
      if (r.match === 'unknown' || !r.product || !r.variantId) {
        scanSound('miss');
        setUnknown(r);
        setArchived(null);
        return;
      }
      setUnknown(null);
      // an archived product is not sold, received or counted from the scanner; look up still opens it
      if (r.match === 'archived' && mode !== 'lookup') { setArchived(r.product); return; }
      setArchived(null);
      // another code of an item already in the picture (the qr next to the barcode) is not a second
      // item. a pack code and a unit code of one product are different items.
      if (camera && !filter.claim(value, `${r.variantId}:${r.packQty}`, at)) return;
      scanSound('ok');
      const levels = (r.product as Product & { levels?: StockLevel[] }).levels;
      if (mode === 'lookup') { waiting.current = []; router.push(`/admin/stock/${r.product.id}`); }
      else if (mode === 'sell') await sellOne(r.product, r.variantId, r.packQty);
      else if (mode === 'count') await countScan(r.product, r.variantId, r.packQty, 'add');
      else addLine(r.product, r.variantId, r.packQty, levels);
    } catch (e) {
      toast(isNetworkError(e) ? t('offline.needsSignal') : t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      inFlight.current = false;
      const next = waiting.current.shift();
      if (next) void nextCode.current(next.raw, next.format, next.at, next.camera);
    }
  }
  // the newest handleCode (it reads the current mode and shop), for the codes that waited
  useEffect(() => { nextCode.current = handleCode; });

  async function receiveAll() {
    if (!workShop || !lines.length) return;
    setBusy(true);
    try {
      const batchId = uuidv7();
      const movements = lines.filter((l) => l.qty > 0).map((l) => ({
        id: uuidv7(), shopId: workShop, variantId: l.variantId, qtyDelta: l.qty, kind: 'receive' as const, batchId, occurredAt: now(),
      }));
      const sent = await submitMovements(api, org.orgId, movements);
      const refused = sent.result?.rejected ?? [];
      if (refused.length) {
        // what went in stays in: only the refused lines are left on screen, so a second tap cannot
        // receive the accepted ones twice
        const kept = new Set(refused.map((r) => movements.find((m) => m.id === r.id)?.variantId));
        if (sent.result) afterMovements(sent.result);
        setLines((cur) => cur.filter((l) => kept.has(l.variantId)));
        toast(t(`common:error.${refused[0]!.code}`));
        return;
      }
      if (sent.result) afterMovements(sent.result);
      toast(sent.queued ? t('offline.savedReceive', { count: total }) : t('scanner.received', { count: total }));
      setLines([]);
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  }

  async function finishCount() {
    if (!countId.current) return;
    setBusy(true);
    try {
      await api.submitCount(org.orgId, countId.current);
      if (can('stock.count.approve', workShop)) {
        const applied = await api.applyCount(org.orgId, countId.current, 'ignore');
        const diffs = applied.lines.filter((l) => l.difference !== 0).length;
        toast(diffs ? t('scanner.countApplied', { count: diffs }) : t('scanner.countNoDifferences'));
      } else {
        toast(t('scanner.countSubmitted'));
      }
      countId.current = null;
      setLines([]);
    } catch (e) {
      toast(isNetworkError(e) ? t('offline.needsSignal') : t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  }

  async function sendTransfer() {
    if (!workShop || !toShop || !lines.length) return;
    setBusy(true);
    try {
      const draft = await api.createTransfer(org.orgId, { fromShopId: workShop, toShopId: toShop, lines: lines.filter((l) => l.qty > 0).map((l) => ({ variantId: l.variantId, qty: l.qty })) });
      await api.sendTransfer(org.orgId, draft.id);
      toast(t('scanner.transferSent', { count: total, shop: destinations.find((d) => d.id === toShop)?.name ?? '' }), {
        label: t('scanner.openTransfer'), run: () => router.push(`/admin/stock/transfers/${draft.id}`),
      });
      setLines([]);
      setToShop(null);
    } catch (e) {
      toast(isNetworkError(e) ? t('offline.needsSignal') : t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  }

  function changeMode(m: Mode) {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch {}
    // codes waiting from the old mode are dropped. an item still in the picture does not count in the
    // new mode until it is taken away and shown again, so changing mode never sells by surprise
    waiting.current = [];
    setLines([]);
    setUnknown(null);
    setArchived(null);
    countId.current = null;
  }

  function setQty(l: Line, next: number) {
    if (mode === 'count') { void countScan(l.product, l.variantId, Math.max(0, next), 'set').catch(() => toast(t('offline.needsSignal'))); return; }
    setLines((cur) => cur.map((x) => (x.variantId === l.variantId ? { ...x, qty: Math.max(0, next) } : x)));
  }

  // while developing: codes from the sample shop, and one nobody knows
  const samples = useMemo(() => (devBuild ? [ean13('520004417010'), ean13('520004417020'), ean13('520004417030'), '4006381333931'] : []), []);
  const needsSignal = !online && (mode === 'count' || mode === 'transfer');

  // nothing to scan for: the tab is not offered, an old link goes home
  if (!modes.length || !workShop) return <RedirectHome />;

  return (
    <div className="page-in pt-3 max-w-[640px]">
      <h1 className="sr-only">{t('scanner.title')}</h1>
      <Camera
        onCode={(raw, format) => void handleCode(raw, format, now(), true)}
        filter={filter}
        silent
        paused={busy}
        overlay={<OutboxBadge dark />}
        actions={
          <button type="button" className="scan-round" aria-pressed={manual} aria-label={t('scanner.typeCode')} onClick={() => setManual((x) => !x)}
            style={manual ? { background: 'rgba(255,255,255,0.92)', color: '#16171B' } : undefined}>
            <IconKeyboard size={22} />
          </button>
        }
      />

      <div className="mt-4 flex flex-col gap-4">
        {/* the modes scroll sideways like the camera app's, the chosen one stays visible */}
        <Chips value={mode} onChange={changeMode} label={t('scanner.modeLabel')} options={modes.map((m) => ({ value: m, label: t(`scanner.mode.${m}`) }))} />

        {manual ? (
          <form className="list flex items-center gap-2 pl-4 pr-1.5" onSubmit={(e) => { e.preventDefault(); void handleCode(code); setCode(''); }}>
            <IconBarcode size={20} className="flex-none" style={{ color: 'var(--c-ink-2)' }} />
            <input className="flex-1 min-w-0 bg-transparent border-0 outline-none t-body tnum min-h-[48px]" style={{ color: 'var(--c-ink)' }} inputMode="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              enterKeyHint="go" maxLength={500} autoFocus
              placeholder={t('scanner.typeCodePlaceholder')} aria-label={t('scanner.typeCode')} value={code} onChange={(e) => setCode(e.target.value)} />
            <button type="submit" className="btn btn-tinted" disabled={!code.trim()}>{t('common:action.add')}</button>
          </form>
        ) : null}

        {samples.length && apiMode === 'fixtures' ? (
          <div>
            <p className="t-foot t-2 m-0 mb-2 px-1">{t('scanner.samples')}</p>
            <div className="scroll-x flex gap-2">
              {samples.map((c) => <button key={c} type="button" className="chip tnum" onClick={() => void handleCode(c, 'ean_13')}><IconBarcode size={14} />{c}</button>)}
            </div>
          </div>
        ) : null}

        {needsSignal ? <p className="t-sub m-0 px-1" style={{ color: 'var(--c-few-text)' }}>{t('offline.modeNeedsSignal')}</p> : null}

        {unknown ? (
          <div className="card p-4 page-in" role="status">
            <p className="t-headline m-0">{t('scanner.unknownTitle')}</p>
            <p className="t-sub t-2 m-0 mt-1 tnum">{unknown.valid ? unknown.codeNorm.replace(/^0+(?=\d{8})/, '') : t('scanner.damaged')}</p>
            <div className="mt-3">
              {!unknown.valid ? null : can('products.create', null) ? (
                <Link className="btn btn-tinted" href={`/admin/stock/new?code=${encodeURIComponent(unknown.codeNorm.replace(/^0+(?=\d{8})/, ''))}`}><IconPlus size={18} />{t('scanner.createWithCode')}</Link>
              ) : <p className="t-sub t-2 m-0">{t('scanner.unknownSaved')}</p>}
            </div>
          </div>
        ) : null}

        {archived ? (
          <div className="card p-4 page-in" role="status">
            <p className="t-headline m-0">{t('scanner.archivedTitle')}</p>
            <p className="t-sub t-2 m-0 mt-1">{t('scanner.archivedBody', { name: name(archived) })}</p>
          </div>
        ) : null}

        {mode !== 'lookup' && lines.length ? (
          <section aria-label={t('scanner.listLabel')}>
            <div className="flex items-center justify-between px-1 mb-2">
              <p className="t-foot t-2 m-0">
                {mode === 'sell' ? t('scanner.listHead.sell', { count: total }) : `${t('scanner.lines', { count: lines.length })} · ${t(`scanner.listHead.${mode}`, { count: total })}`}
              </p>
              {mode !== 'sell' ? <button type="button" className="btn btn-plain" style={{ minHeight: 32, padding: '0 4px' }} onClick={() => {
                // clearing a count starts it over: the open count on the server goes too
                if (mode === 'count' && countId.current) void api.cancelCount(org.orgId, countId.current).catch(() => {});
                setLines([]);
                countId.current = null;
              }}>{t('scanner.clear')}</button> : null}
            </div>
            <ul className="list" role="list">
              {lines.map((l) => (
                <li key={l.variantId} className="row" style={{ minHeight: 56 }}>
                  <span className="row-main">
                    <span className="row-title block truncate">{name(l.product)}</span>
                    {mode === 'count' ? (
                      <span className="row-sub block" style={l.qty !== l.expected ? { color: 'var(--c-accent)' } : undefined}>
                        {t('scanner.expected', { qty: qtyNumber(l.expected, l.product.uom, locale) })}
                      </span>
                    ) : null}
                  </span>
                  {mode !== 'sell' ? (
                    <button type="button" className="icon-btn" aria-label={t('scanner.less', { name: name(l.product) })} onClick={() => setQty(l, l.qty - 1)}><IconMinus size={20} /></button>
                  ) : null}
                  <span className="t-headline tnum min-w-[36px] text-center"><Tally value={l.qty} format={(n) => qtyNumber(n, l.product.uom, locale)} /></span>
                  {mode !== 'sell' ? (
                    <button type="button" className="icon-btn" aria-label={t('scanner.more', { name: name(l.product) })} onClick={() => setQty(l, l.qty + 1)}><IconPlus size={20} /></button>
                  ) : l.product.uom === 'piece' ? (
                    // one more of the same, without scanning the same code again
                    <button type="button" className="icon-btn" aria-label={t('scanner.sellOneMore', { name: name(l.product) })} disabled={busy}
                      onClick={() => void sellOne(l.product, l.variantId, 1).then(() => scanSound('ok'), () => toast(t('offline.needsSignal')))}><IconPlus size={20} /></button>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="mt-4">
              {mode === 'receive' ? (
                <button type="button" className="btn btn-primary btn-large" disabled={busy || !total} onClick={() => void receiveAll()}>
                  <IconCheck size={20} />{t('scanner.receiveCta', { count: total })}
                </button>
              ) : null}
              {mode === 'transfer' ? (
                destinations.length ? (
                  <div className="flex flex-col gap-3">
                    <div className="scroll-x flex gap-2" role="group" aria-label={t('scanner.pickShop')}>
                      {destinations.map((d) => (
                        <button key={d.id} type="button" className="chip" aria-pressed={toShop === d.id} onClick={() => setToShop(d.id)}><IconShop size={14} />{d.name}</button>
                      ))}
                    </div>
                    <button type="button" className="btn btn-primary btn-large" disabled={busy || !toShop || !online} onClick={() => void sendTransfer()}>
                      <IconTruck size={20} />
                      {toShop ? t('scanner.sendCta', { count: total, shop: destinations.find((d) => d.id === toShop)?.name ?? '' }) : t('scanner.pickShop')}
                    </button>
                  </div>
                ) : <Why>{t('scanner.noDestination')}</Why>
              ) : null}
              {mode === 'count' ? (
                <div className="flex flex-col gap-3">
                  <button type="button" className="btn btn-primary btn-large" disabled={busy || !online} onClick={() => void finishCount()}>
                    <IconCheck size={20} />{can('stock.count.approve', workShop) ? t('scanner.applyCount') : t('scanner.submitCount')}
                  </button>
                  {!can('stock.count.approve', workShop) ? <p className="t-foot t-2 m-0 px-1">{t('scanner.countNeedsApproval')}</p> : null}
                </div>
              ) : null}
            </div>
          </section>
        ) : !unknown ? (
          <p className="t-sub t-2 text-center m-0 mt-2 px-4">{t(`scanner.hint.${mode}`)}</p>
        ) : null}
      </div>
    </div>
  );
}
