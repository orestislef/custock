'use client';

// create or edit a product. scan or type the barcode, or let us make a shop barcode.
// vat rates come from the business country. variants and photos by url are sent when the api
// contract has them (it does now), and always with the sample data.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProductInput as ProductInputSchema, type Product, type ProductInput, type StockLevel, type Uom } from '@custock/core';
import { useAdmin } from './admin-context';
import { ScanButton } from './scan-button';
import { Chips, Segmented, Switch, Why } from '@/components/ui/kit';
import { Photo, Picker, useToast } from '@/components/ui/client-kit';
import { IconClose, IconPlus } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { apiMode } from '@/lib/api-client';
import { intlLocale, money } from '@/lib/format';
import { categoryName, forgetCatalog } from '@/lib/use-names';
import { variantLabel } from '@/lib/names';
import { uploadPhoto } from '@/lib/upload';

const VAT: Record<string, number[]> = { GR: [2400, 1300, 600], CY: [1900, 900, 500], DE: [1900, 700], BG: [2000, 900], RO: [1900, 900, 500] };
const shape = ProductInputSchema.shape as Record<string, unknown>;
const supportsVariants = apiMode === 'fixtures' || 'variants' in shape;
const supportsImages = apiMode === 'fixtures' || 'imageUrls' in shape;

interface Option { name: string; values: string }

function parseMoney(v: string): number | null {
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  return v.trim() && !Number.isNaN(n) ? Math.round(n * 100) : null;
}

// one field pattern for every text input: a small label above, the value below
function Field({ label, children, sep }: { label: string; children: React.ReactNode; sep?: boolean }) {
  return (
    <li>
      <label className={`block ${sep ? 'row-sep relative' : ''}`}>
        <span className="field-label">{label}</span>
        {children}
      </label>
    </li>
  );
}

export function ProductForm({ product }: { product?: Product & { levels: StockLevel[] } }) {
  const { api, org, t, locale, can, settings } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const cats = useAsync(() => api.categories(org.orgId), []);
  const v0 = product?.variants[0];
  const country = settings?.country ?? 'GR';
  const rates = VAT[country] ?? VAT.GR!;
  const countryName = new Intl.DisplayNames([intlLocale(locale)], { type: 'region' }).of(country) ?? country;
  const canPrice = can('products.price.edit', null);
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
  const [images, setImages] = useState<string[]>(product?.images.map((i) => i.url) ?? []);
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zero = money(0, org.currency, locale);

  // every combination of the option values: size S, M x color black, white = 4 variants
  const combos = useMemo(() => {
    const lists = options.map((o) => o.values.split(',').map((v) => v.trim()).filter(Boolean).map((v) => ({ [o.name.trim() || '?']: v })));
    return lists.filter((l) => l.length).reduce<Record<string, string>[]>((acc, list) => acc.flatMap((a) => list.map((b) => ({ ...a, ...b }))), [{}]).filter((c) => Object.keys(c).length);
  }, [options]);
  const imagesChanged = product ? images.join('|') !== product.images.map((i) => i.url).join('|') : images.length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const priceMinor = canPrice ? parseMoney(price) : null;
      const costMinor = canCost ? parseMoney(cost) : null;
      if (!product) {
        const input: ProductInput = {
          name: name.trim(), brand: brand.trim() || null, description: desc.trim() || null, categoryId: cat || null,
          uom, taxRateBp: Number(vat), trackStock: track,
          ...(priceMinor != null ? { priceMinor } : {}), ...(costMinor != null ? { costMinor } : {}),
          ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
          ...(supportsVariants && combos.length > 1 ? { variants: combos.map((o) => ({ options: o, priceMinor, ...(costMinor != null ? { costMinor } : {}) })) } : {}),
          ...(supportsImages && images.length ? { imageUrls: images } : {}),
        };
        const p = await api.createProduct(org.orgId, input);
        forgetCatalog(org.orgId);
        toast(t('stock.created', { name: p.name }));
        router.push(`/admin/stock/${p.id}`);
      } else {
        const patch: Partial<ProductInput> = {
          name: name.trim(), brand: brand.trim() || null, description: desc.trim() || null, categoryId: cat || null,
          uom, taxRateBp: Number(vat), trackStock: track,
          ...(canPrice && priceMinor != null && priceMinor !== v0?.priceMinor ? { priceMinor } : {}),
          ...(canCost && costMinor != null && costMinor !== v0?.costMinor ? { costMinor } : {}),
          ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
          ...(supportsImages && imagesChanged ? { imageUrls: images } : {}),
        };
        await api.updateProduct(org.orgId, product.id, patch);
        forgetCatalog(org.orgId);
        toast(t('productForm.saved'));
        router.push(`/admin/stock/${product.id}`);
      }
    } catch (e) {
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
      setBusy(false);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const f of [...files].slice(0, 10 - images.length)) {
        const url = await uploadPhoto(api, org.orgId, f);
        setImages((x) => [...x, url]);
      }
    } catch {
      setError(t('productForm.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function ownCode() {
    try { setBarcode((await api.nextInternalBarcode(org.orgId)).code); } catch (e) { setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`)); }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px] gap-x-8 items-start">
      <div>
        <section className="inset-group">
          <ul className="list" role="list">
            <Field label={t('stock.form.name')}><input className="field pt-1" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label={t('productForm.brand')} sep><input className="field pt-1" value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
            <Field label={t('productForm.description')} sep><textarea className="field pt-1" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
            <li className="row row-sep">
              <span className="row-main row-title">{t('stock.form.category')}</span>
              <Picker variant="plain" label={t('stock.form.category')} value={cat} onChange={setCat}
                options={[{ value: '', label: t('productForm.noCategory') }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: categoryName(c, locale) }))]} />
            </li>
          </ul>
        </section>

        <section className="inset-group">
          <h2 className="inset-group-head">{t('productForm.barcode')}</h2>
          <ul className="list" role="list">
            <li className="flex items-center pr-1">
              <label className="block flex-1">
                <span className="sr-only">{t('productForm.barcode')}</span>
                <input className="field tnum" inputMode="numeric" placeholder={t('productForm.barcodePh')} value={barcode} onChange={(e) => setBarcode(e.target.value)} />
              </label>
              <ScanButton onCode={(c) => setBarcode(c)} />
            </li>
            <li>
              <button type="button" className="row row-sep" style={{ color: 'var(--c-accent)' }} onClick={() => void ownCode()}>
                <span className="row-main row-title">{t('productForm.ownCode')}</span>
              </button>
            </li>
          </ul>
          <p className="inset-group-foot">{product ? t('productForm.barcodeAddFoot', { count: product.variants.reduce((a, v) => a + v.barcodes.length, 0) }) : t('productForm.barcodeFoot')}</p>
        </section>

        <section className="inset-group">
          <h2 className="inset-group-head">{t('productForm.unit')}</h2>
          <Chips label={t('productForm.unit')} value={uom} onChange={setUom} options={(['piece', 'kg', 'l', 'm'] as const).map((u) => ({ value: u, label: t(`productForm.uom.${u}`) }))} />
          <p className="inset-group-foot">{t('productForm.unitFoot')}</p>
        </section>

        {supportsVariants && !product ? (
          <section className="inset-group">
            <h2 className="inset-group-head">{t('productForm.variants')}</h2>
            <ul className="list" role="list">
              {options.map((o, i) => (
                <li key={i} className="row gap-2">
                  <input className="t-body bg-transparent border-0 outline-none w-32 min-w-0" placeholder={t('productForm.optionName')} aria-label={t('productForm.optionName')} value={o.name}
                    onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                  <input className="t-body bg-transparent border-0 outline-none flex-1 min-w-0" placeholder={t('productForm.optionValues')} aria-label={t('productForm.optionValues')} value={o.values}
                    onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? { ...y, values: e.target.value } : y)))} />
                  <button type="button" className="icon-btn" aria-label={t('common:action.remove')} onClick={() => setOptions((x) => x.filter((_, j) => j !== i))}><IconClose size={18} /></button>
                </li>
              ))}
              {options.length < 3 ? (
                <li>
                  <button type="button" className="row" style={{ color: 'var(--c-accent)' }} onClick={() => setOptions((x) => [...x, { name: '', values: '' }])}>
                    <IconPlus size={20} /><span className="row-main row-title">{t('productForm.addOption')}</span>
                  </button>
                </li>
              ) : null}
            </ul>
            {combos.length > 1 ? (
              <div className="flex flex-wrap gap-1.5 mt-3 px-1">
                {combos.map((c, i) => <span key={i} className="badge badge-gray">{Object.values(c).join(' · ')}</span>)}
              </div>
            ) : null}
            <p className="inset-group-foot">{combos.length > 1 ? t('productForm.variantsCount', { count: combos.length }) : t('productForm.variantsFoot')}</p>
          </section>
        ) : product && product.variants.length > 1 ? (
          <section className="inset-group">
            <h2 className="inset-group-head">{t('productForm.variants')}</h2>
            <ul className="list" role="list">
              {product.variants.map((v) => <li key={v.id} className="row"><span className="row-main row-title">{variantLabel(v.options) || v.sku}</span><span className="row-value">{money(v.priceMinor, org.currency, locale)}</span></li>)}
            </ul>
          </section>
        ) : null}

        {supportsImages ? (
          <section className="inset-group">
            <h2 className="inset-group-head">{t('productForm.photos')}</h2>
            <ul className="list" role="list">
              {images.map((u, i) => (
                <li key={u} className="row has-icon" style={{ '--sep-inset': '72px' } as React.CSSProperties}>
                  <Photo src={u} alt="" size={44} />
                  <span className="row-main row-sub truncate">{u.startsWith('data:') ? t('productForm.newPhoto') : u.replace(/^https?:\/\//, '')}</span>
                  <button type="button" className="icon-btn" aria-label={t('common:action.remove')} onClick={() => setImages((x) => x.filter((_, j) => j !== i))}><IconClose size={18} /></button>
                </li>
              ))}
              <li>
                <label className="row" style={{ color: 'var(--c-accent)', cursor: 'pointer' }}>
                  <IconPlus size={20} />
                  <span className="row-main row-title">{uploading ? t('productForm.uploading') : t('productForm.upload')}</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={uploading} onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
                </label>
              </li>
              <li>
                <form className="flex items-center pr-1 row-sep relative" onSubmit={(e) => { e.preventDefault(); if (/^https:\/\//.test(imageUrl)) { setImages((x) => [...x, imageUrl]); setImageUrl(''); } }}>
                  <label className="block flex-1"><span className="sr-only">{t('productForm.photoPh')}</span>
                    <input className="field" type="url" placeholder={t('productForm.photoPh')} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} /></label>
                  <button type="submit" className="icon-btn" aria-label={t('common:action.add')} disabled={!/^https:\/\//.test(imageUrl)}><IconPlus size={20} /></button>
                </form>
              </li>
            </ul>
            <p className="inset-group-foot">{t('productForm.photoFoot')}</p>
          </section>
        ) : null}
      </div>

      <div className="lg:sticky lg:top-[72px]">
        <section className="inset-group">
          <h2 className="inset-group-head">{t('product.prices')}</h2>
          <ul className="list" role="list">
            <Field label={t('stock.form.price')}>
              <input className="field pt-1 tnum" inputMode="decimal" placeholder={t('productForm.pricePh', { zero })} disabled={!canPrice} value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            {canCost ? (
              <Field label={t('product.cost')} sep>
                <input className="field pt-1 tnum" inputMode="decimal" placeholder={t('productForm.costPh', { zero })} value={cost} onChange={(e) => setCost(e.target.value)} />
              </Field>
            ) : null}
          </ul>
          <p className="inset-group-foot">{canPrice ? t('productForm.priceFoot') : <Why>{t('common:why.setByAdmin')}</Why>}</p>
        </section>
        <section className="inset-group">
          <h2 className="inset-group-head">{t('productForm.vatFor', { country: countryName })}</h2>
          <div className="px-1"><Segmented label={t('product.vat')} value={vat} onChange={setVat} options={rates.map((r) => ({ value: String(r), label: `${r / 100}%` }))} /></div>
        </section>
        <section className="inset-group">
          <ul className="list" role="list">
            <li className="row">
              <span className="row-main row-title">{t('productForm.track')}</span>
              <Switch checked={track} onChange={setTrack} label={t('productForm.track')} />
            </li>
          </ul>
          <p className="inset-group-foot">{t('productForm.trackFoot')}</p>
        </section>
        {error ? <p className="sheet-error" role="alert">{error}</p> : null}
        <button type="button" className="btn btn-primary btn-large" disabled={busy || !name.trim()} onClick={() => void save()}>
          {product ? t('common:action.save') : t('productForm.create')}
        </button>
        {!name.trim() ? <p className="why-line mb-8">{t('productForm.needName')}</p> : <div className="mb-8" />}
      </div>
    </div>
  );
}
