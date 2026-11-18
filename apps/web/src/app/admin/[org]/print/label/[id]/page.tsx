'use client';

import Link from '@/components/admin/org-link';
import { use, useMemo, useState } from 'react';
import { barsFor, type Bars } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { RedirectHome } from '@/components/admin/redirect-home';
import { Qr } from '@/components/ui/qr';
import { Picker } from '@/components/ui/client-kit';
import { Segmented } from '@/components/ui/kit';
import { IconChevronLeft, IconPrint } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { basePath } from '@/lib/api-client';
import { money } from '@/lib/format';
import { productName } from '@/lib/names';

// shelf labels for one product, on A4: the name, the price when customers see prices, the barcode
// drawn for real (EAN-13 or Code 128) and a QR code to the product's shelf page, where customers
// read more and can ask to hear when it is back.

type Size = '50x30' | '70x40';
const SIZES: Record<Size, { w: number; h: number; qr: number; name: number; price: number }> = {
  '50x30': { w: 50, h: 30, qr: 15, name: 8.5, price: 13 },
  '70x40': { w: 70, h: 40, qr: 20, name: 10.5, price: 17 },
};
const SIZE_KEY = 'custock.label.size';

function BarsSvg({ bars, widthMm, heightMm }: { bars: Bars; widthMm: number; heightMm: number }) {
  // quiet zones: 9 modules for EAN-13 on the left (7 right), 10 for Code 128 on both sides
  const left = bars.kind === 'ean13' ? 9 : 10;
  const right = bars.kind === 'ean13' ? 7 : 10;
  const total = left + bars.modules + right;
  let x = left;
  const rects: { x: number; w: number }[] = [];
  bars.runs.forEach((w, i) => {
    if (i % 2 === 0) rects.push({ x, w });
    x += w;
  });
  return (
    <svg viewBox={`0 0 ${total} 40`} width={`${widthMm}mm`} height={`${heightMm}mm`} preserveAspectRatio="none" role="img" aria-label={bars.text} shapeRendering="crispEdges">
      <rect x="0" y="0" width={total} height="40" fill="#FFFFFF" />
      {rects.map((r, i) => <rect key={i} x={r.x} y="0" width={r.w} height="40" fill="#000000" />)}
    </svg>
  );
}

export default function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, locale, can, settings } = useAdmin();
  const allowed = can('products.edit', null) || can('products.create', null);
  const product = useAsync(() => (allowed ? api.product(org.orgId, id) : Promise.resolve(null)), [id, allowed]);
  const [size, setSize] = useState<Size>(() => {
    try { const v = localStorage.getItem(SIZE_KEY); if (v === '50x30' || v === '70x40') return v; } catch {}
    return '50x30';
  });
  const [variantId, setVariantId] = useState('');
  const [copies, setCopies] = useState(1);

  const p = product.data;
  const variant = p ? p.variants.find((v) => v.id === variantId) ?? p.variants[0] : undefined;
  const code = variant?.barcodes[0]?.code ?? '';
  const bars = useMemo(() => (code ? barsFor(code) : null), [code]);
  if (!allowed) return <RedirectHome />;
  if (!p || !variant) return <div className="p-10"><div className="h-[400px] skel" /></div>;

  const s = SIZES[size];
  const name = productName(p, locale);
  const options = variant.options ? Object.values(variant.options).join(' · ') : '';
  // the base price, only when customers see prices
  const priceMinor = variant.priceMinor;
  const showPrice = !!settings?.customerPrices && priceMinor != null;
  const shelfUrl = code ? `${window.location.origin}${basePath}/p/${encodeURIComponent(code)}` : null;
  const pickSize = (v: Size) => { setSize(v); try { localStorage.setItem(SIZE_KEY, v); } catch {} };

  const label = (key: number) => (
    <div key={key} className="label-cell" style={{ width: `${s.w}mm`, height: `${s.h}mm`, padding: '2.2mm', display: 'grid', gridTemplateColumns: `1fr ${s.qr}mm`, gridTemplateRows: 'auto 1fr auto', columnGap: '2mm', background: '#FFFFFF', color: '#000000', boxSizing: 'border-box', overflow: 'hidden' }}>
      <div style={{ gridColumn: '1 / 2', fontSize: `${s.name}pt`, lineHeight: 1.15, fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {name}{options ? <span style={{ fontWeight: 400 }}> {options}</span> : null}
      </div>
      <div style={{ gridColumn: '2 / 3', gridRow: '1 / 3', display: 'flex', justifyContent: 'flex-end' }}>
        {shelfUrl ? <div style={{ width: `${s.qr}mm`, height: `${s.qr}mm` }}><Qr value={shelfUrl} size={Math.round(s.qr * 3.78)} label={shelfUrl} /></div> : null}
      </div>
      <div style={{ gridColumn: '1 / 2', alignSelf: 'center', fontSize: `${s.price}pt`, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {showPrice ? money(priceMinor, org.currency, locale) : null}
      </div>
      <div style={{ gridColumn: '1 / 3', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {bars ? <BarsSvg bars={bars} widthMm={s.w - 4.4} heightMm={s.h * 0.22} /> : null}
        {code ? <span style={{ fontSize: '6.5pt', letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums' }}>{code}</span> : null}
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh" style={{ background: 'var(--c-shelf)' }}>
      <style>{'@page { size: A4; margin: 8mm; } @media print { .label-sheet { box-shadow: none !important; padding: 0 !important; width: auto !important; min-height: 0 !important; } .label-cell { outline: 0.2mm dashed #BBBBBB; } }'}</style>
      <div className="no-print max-w-[820px] mx-auto px-4 pb-4">
        <div className="flex items-center gap-2 h-[56px]">
          <Link href={`/admin/stock/${p.id}`} className="inline-flex items-center min-h-[44px] ml-back t-body"><IconChevronLeft size={24} />{name}</Link>
          <span className="flex-1" />
          <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!code}><IconPrint size={18} />{t('common:action.print')}</button>
        </div>
        <h1 className="t-title1 t-display m-0">{t('label.title')}</h1>
        <p className="t-sub t-2 mt-1 mb-4">{code ? t('label.lead') : t('label.noCode')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label={t('label.size')} value={size} onChange={(v) => pickSize(v as Size)}
            options={[{ value: '50x30', label: '50 × 30 mm' }, { value: '70x40', label: '70 × 40 mm' }]} />
          {p.variants.length > 1 ? (
            <Picker label={t('label.variant')} value={variant.id} onChange={setVariantId}
              options={p.variants.map((v) => ({ value: v.id, label: v.options ? Object.values(v.options).join(' · ') : name }))} />
          ) : null}
          <span className="inline-flex items-center gap-2">
            <span className="t-sub t-2">{t('label.copies')}</span>
            <button type="button" className="icon-btn" aria-label={t('label.fewer')} onClick={() => setCopies((n) => Math.max(1, n - 1))} disabled={copies <= 1}>−</button>
            <span className="t-headline tnum" aria-live="polite" style={{ minWidth: 28, textAlign: 'center' }}>{copies}</span>
            <button type="button" className="icon-btn" aria-label={t('label.more')} onClick={() => setCopies((n) => Math.min(60, n + 1))} disabled={copies >= 60}>+</button>
          </span>
        </div>
        {!showPrice && priceMinor != null ? <p className="t-foot t-2 mt-3 mb-0">{t('label.noPrice')}</p> : null}
      </div>
      {code ? (
        <div className="label-sheet mx-auto bg-white" style={{ width: 'min(210mm, 100%)', minHeight: '120mm', padding: '8mm', boxShadow: '0 10px 40px rgba(0,0,0,0.12)', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: '2mm' }}>
          {Array.from({ length: copies }, (_, i) => label(i))}
        </div>
      ) : null}
    </div>
  );
}
