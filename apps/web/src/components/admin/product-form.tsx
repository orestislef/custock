'use client';

// create or edit a product. scan or type the barcode, or let us make our own label code.
// vat rates come from the business country. variants and photos by url show up when the api
// contract supports them (and always with the sample data).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProductInput as ProductInputSchema, type Product, type ProductInput, type StockLevel, type Uom } from '@custock/core';
import { useAdmin } from './admin-context';
import { ScanButton } from './scan-button';
import { Group, Row, Segmented, Switch, Why } from '@/components/ui/kit';
import { Photo, useToast } from '@/components/ui/client-kit';
import { IconClose, IconPlus } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { apiMode } from '@/lib/api-client';
import { money } from '@/lib/format';

const VAT: Record<string, number[]> = { GR: [2400, 1300, 600], CY: [1900, 900, 500], DE: [1900, 700], BG: [2000, 900], RO: [1900, 900, 500] };
const shape = ProductInputSchema.shape as Record<string, unknown>;
const supportsVariants = apiMode === 'fixtures' || 'variants' in shape;
const supportsImages = apiMode === 'fixtures' || 'imageUrls' in shape;

interface Option { name: string; values: string }

function parseMoney(v: string): number | null {
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  return v.trim() && !Number.isNaN(n) ? Math.round(n * 100) : null;
}

export function ProductForm({ product }: { product?: Product & { levels: StockLevel[] } }) {
  const { api, org, t, locale, can, settings } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const cats = useAsync(() => api.categories(org.orgId), []);
  const v0 = product?.variants[0];
  const rates = VAT[settings?.country ?? 'GR'] ?? VAT.GR!;
  const canPrice = can('products.price.edit', null) || (!product && can('products.create', null) && can('products.price.edit', null));
  const canCost = can('products.cost.edit', null);

  const [name, setName] = useState(product?.name ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [desc, setDesc] = useState(product?.description ?? '');
  const [cat, setCat] = useState(product?.categoryId ?? '');
  const [uom, setUom] = useState<Uom>(product?.uom ?? 'piece');
  const [vat, setVat] = useState(String(product?.taxRateBp ?? rates[0]));
  const [track, setTrack] = useState(product?.trackStock ?? true);
  const [price, setPrice] = useState(v0?.priceMinor != null ? (v0.priceMinor / 100).toFixed(2) : '');
  const [cost, setCost] = useState(v0?.costMinor != null ? (v0.costMinor / 100).toFixed(2) : '');
  const [barcode, setBarcode] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState('');
  const [busy, setBusy] = useState(false);

  // every combination of the option values: size S, M x color black, white = 4 variants
  const combos = useMemo(() => {
    const lists = options.map((o) => o.values.split(',').map((v) => v.trim()).filter(Boolean).map((v) => ({ [o.name.trim() || '?']: v })));
    return lists.filter((l) => l.length).reduce<Record<string, string>[]>((acc, list) => acc.flatMap((a) => list.map((b) => ({ ...a, ...b }))), [{}]).filter((c) => Object.keys(c).length);
  }, [options]);

  async function save() {
    setBusy(true);
    try {
      const priceMinor = canPrice ? parseMoney(price) : null;
      const costMinor = canCost ? parseMoney(cost) : null;
      if (!product) {
        const input: ProductInput & { variants?: unknown; imageUrls?: string[] } = {
          name: name.trim(), brand: brand.trim() || null, description: desc.trim() || null, categoryId: cat || null,
          uom, taxRateBp: Number(vat), trackStock: track,
          ...(priceMinor != null ? { priceMinor } : {}), ...(costMinor != null ? { costMinor } : {}),
          ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
          ...(supportsVariants && combos.length > 1 ? { variants: combos.map((o) => ({ options: o, priceMinor })) } : {}),
          ...(supportsImages && images.length ? { imageUrls: images } : {}),
        };
        const p = await api.createProduct(org.orgId, input);
        toast(t('stock.created', { name: p.name }));
        router.push(`/admin/stock/${p.id}`);
      } else {
        const patch: Partial<ProductInput> = {
          name: name.trim(), brand: brand.trim() || null, description: desc.trim() || null, categoryId: cat || null,
          uom, taxRateBp: Number(vat), trackStock: track,
          ...(canPrice && priceMinor != null && priceMinor !== v0?.priceMinor ? { priceMinor } : {}),
          ...(canCost && costMinor != null && costMinor !== v0?.costMinor ? { costMinor } : {}),
          ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
        };
        await api.updateProduct(org.orgId, product.id, patch);
        toast(t('productForm.saved'));
        router.push(`/admin/stock/${product.id}`);
      }
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
      setBusy(false);
    }
  }

  async function ownCode() {
    try { setBarcode((await api.nextInternalBarcode(org.orgId)).code); } catch (e) { toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`)); }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px] gap-x-8">
      <div>
        <Group>
          <label className="block"><span className="field-label">{t('stock.form.name')}</span>
            <input className="field pt-1" value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label className="block row-sep relative"><span className="field-label">{t('productForm.brand')}</span>
            <input className="field pt-1" value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
          <label className="block row-sep relative"><span className="field-label">{t('productForm.description')}</span>
            <textarea className="field pt-1" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          <label className="row row-sep relative"><span className="row-main row-title">{t('stock.form.category')}</span>
            <select className="t-body bg-transparent border-0 outline-none text-right max-w-[60%]" style={{ color: 'var(--c-ink-2)' }} value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">{t('productForm.noCategory')}</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        </Group>

        <section className="group">
          <h2 className="group-head">{t('productForm.barcode')}</h2>
          <div className="list">
            <div className="flex items-center pr-1">
              <input className="field tnum" inputMode="numeric" placeholder={t('productForm.barcodePh')} aria-label={t('productForm.barcode')} value={barcode} onChange={(e) => setBarcode(e.target.value)} />
              <ScanButton onCode={(c) => setBarcode(c)} />
            </div>
            <button type="button" className="row row-sep relative" style={{ color: 'var(--c-accent)' }} onClick={() => void ownCode()}>
              <span className="row-main row-title">{t('productForm.ownCode')}</span>
            </button>
          </div>
          <p className="group-foot">{product ? t('productForm.barcodeAddFoot', { count: product.variants.reduce((a, v) => a + v.barcodes.length, 0) }) : t('productForm.barcodeFoot')}</p>
        </section>

        <section className="group">
          <h2 className="group-head">{t('productForm.unit')}</h2>
          <div className="px-1 overflow-x-auto"><Segmented label={t('productForm.unit')} value={uom} onChange={setUom} options={(['piece', 'kg', 'l', 'm'] as const).map((u) => ({ value: u, label: t(`productForm.uom.${u}`) }))} /></div>
          <p className="group-foot">{t('productForm.unitFoot')}</p>
        </section>

        {supportsVariants && !product ? (
          <section className="group">
            <h2 className="group-head">{t('productForm.variants')}</h2>
            <div className="list">
              {options.map((o, i) => (
                <div key={i} className="row gap-2">
                  <input className="t-body bg-transparent border-0 outline-none w-28 min-w-0" placeholder={t('productForm.optionName')} aria-label={t('productForm.optionName')} value={o.name}
                    onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                  <input className="t-body bg-transparent border-0 outline-none flex-1 min-w-0" placeholder={t('productForm.optionValues')} aria-label={t('productForm.optionValues')} value={o.values}
                    onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? { ...y, values: e.target.value } : y)))} />
                  <button type="button" className="icon-btn" aria-label={t('common:action.remove')} onClick={() => setOptions((x) => x.filter((_, j) => j !== i))}><IconClose size={18} /></button>
                </div>
              ))}
              {options.length < 3 ? (
                <button type="button" className="row" style={{ color: 'var(--c-accent)' }} onClick={() => setOptions((x) => [...x, { name: '', values: '' }])}>
                  <IconPlus size={20} /><span className="row-main row-title">{t('productForm.addOption')}</span>
                </button>
              ) : null}
            </div>
            {combos.length > 1 ? (
              <div className="flex flex-wrap gap-1.5 mt-3 px-1">
                {combos.map((c, i) => <span key={i} className="badge badge-gray">{Object.values(c).join(' · ')}</span>)}
              </div>
            ) : null}
            <p className="group-foot">{combos.length > 1 ? t('productForm.variantsCount', { count: combos.length }) : t('productForm.variantsFoot')}</p>
          </section>
        ) : null}

        {supportsImages && !product ? (
          <section className="group">
            <h2 className="group-head">{t('productForm.photos')}</h2>
            <div className="list">
              {images.map((u, i) => (
                <div key={u} className="row has-icon" style={{ '--sep-inset': '72px' } as React.CSSProperties}>
                  <Photo src={u} alt="" size={44} />
                  <span className="row-main row-sub truncate">{u}</span>
                  <button type="button" className="icon-btn" aria-label={t('common:action.remove')} onClick={() => setImages((x) => x.filter((_, j) => j !== i))}><IconClose size={18} /></button>
                </div>
              ))}
              <form className="flex items-center pr-1" onSubmit={(e) => { e.preventDefault(); if (/^https:\/\//.test(imageUrl)) { setImages((x) => [...x, imageUrl]); setImageUrl(''); } }}>
                <input className="field" type="url" placeholder={t('productForm.photoPh')} aria-label={t('productForm.photoPh')} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
                <button type="submit" className="icon-btn" aria-label={t('common:action.add')} disabled={!/^https:\/\//.test(imageUrl)}><IconPlus size={20} /></button>
              </form>
            </div>
            <p className="group-foot">{t('productForm.photoFoot')}</p>
          </section>
        ) : null}
      </div>

      <div>
        <Group title={t('product.prices')} footer={canPrice ? t('productForm.priceFoot') : <Why>{t('common:why.setByAdmin')}</Why>}>
          <label className="row"><span className="row-main row-title">{t('stock.form.price')}</span>
            <input className="t-body tnum text-right bg-transparent border-0 outline-none w-28" inputMode="decimal" placeholder={money(0, org.currency, locale)} disabled={!canPrice} value={price} onChange={(e) => setPrice(e.target.value)} aria-label={t('stock.form.price')} /></label>
          {canCost ? (
            <label className="row"><span className="row-main row-title">{t('product.cost')}</span>
              <input className="t-body tnum text-right bg-transparent border-0 outline-none w-28" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} aria-label={t('product.cost')} /></label>
          ) : null}
        </Group>
        <section className="group">
          <h2 className="group-head">{t('product.vat')}</h2>
          <div className="px-1"><Segmented label={t('product.vat')} value={vat} onChange={setVat} options={rates.map((r) => ({ value: String(r), label: `${r / 100}%` }))} /></div>
          <p className="group-foot">{t('productForm.vatFoot', { country: settings?.country ?? 'GR' })}</p>
        </section>
        <Group footer={t('productForm.trackFoot')}>
          <Row title={t('productForm.track')} trailing={<Switch checked={track} onChange={setTrack} label={t('productForm.track')} />} />
        </Group>
        <button type="button" className="btn btn-primary btn-large mb-8" disabled={busy || !name.trim()} onClick={() => void save()}>
          {product ? t('common:action.save') : t('productForm.create')}
        </button>
      </div>
    </div>
  );
}
