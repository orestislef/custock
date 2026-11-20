'use client';

import Link from '@/components/admin/org-link';

// create or edit a product. scan or type the barcode, or let us make a shop barcode.
// vat rates come from the business country. variants and photos by url are sent when the api
// contract has them (it does now), and always with the sample data.

import { useMemo, useRef, useState, useId, cloneElement } from 'react';
import { parseMoneyInput } from '@custock/core';
import { clearDraft, readDraft, useDraft } from '@/lib/draft';
import { DraftNote } from '@/components/ui/draft-note';
import { useOrgRouter as useRouter } from '@/components/admin/org-link';
import { cleanLine, featureOn, httpsUrlProblem, LIMITS, ProductInput as ProductInputSchema, type Product, type ProductInput, type StockLevel, type Uom } from '@custock/core';
import { useAdmin } from './admin-context';
import { ScanButton } from './scan-button';
import { Chips, Segmented, Switch } from '@/components/ui/kit';
import { Photo, Picker, useToast } from '@/components/ui/client-kit';
import { IconClose, IconPlus } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { apiMode } from '@/lib/api-client';
import { intlLocale, money } from '@/lib/format';
import { categoryName, forgetCatalog } from '@/lib/use-names';
import { CategorySheet } from './category-sheet';
import { CategoryPicture } from '@/components/ui/category-picture';
import { useBarcodeOwner } from '@/lib/use-barcode-owner';
import { variantLabel } from '@/lib/names';
import { uploadPhoto } from '@/lib/upload';
import { checkAll, decimalExample, useBarcodeField, useLineField, useMoneyField, useTextField } from '@/lib/fields';
import { Counter, FieldMessage, FormNav } from '@/components/ui/field-kit';

const VAT: Record<string, number[]> = { GR: [2400, 1300, 600], CY: [1900, 900, 500], DE: [1900, 700], BG: [2000, 900], RO: [1900, 900, 500] };
const shape = ProductInputSchema.shape as Record<string, unknown>;
const supportsVariants = apiMode === 'fixtures' || 'variants' in shape;
const supportsImages = apiMode === 'fixtures' || 'imageUrls' in shape;

interface Option { name: string; values: string }

const NAME_LOCALES = ['el', 'en', 'ru'] as const;
type NameLocale = (typeof NAME_LOCALES)[number];

// one field pattern for every text input: a small label above, the value below
// the picker entry that opens the new category sheet instead of choosing
const NEW_CATEGORY = '__new_category__';

// the label is tied to its field by id as well, so every screen reader reads the name
function Field({ label, children, sep, after }: { label: string; children: React.ReactElement<{ id?: string }>; sep?: boolean; after?: React.ReactNode }) {
  const auto = useId();
  const id = children.props.id ?? auto;
  return (
    <li>
      <label htmlFor={id} className={`block ${sep ? 'row-sep relative' : ''}`}>
        <span className="field-label">{label}</span>
        {cloneElement(children, { id })}
      </label>
      {after}
    </li>
  );
}

interface ProductDraft {
  name: string; brand: string; description: string; cat: string; uom: Uom; vat: string; track: boolean;
  price: string; cost: string; barcode: string; options: Option[]; images: string[];
}

export function ProductForm({ product, initialBarcode }: { product?: Product & { levels: StockLevel[] }; initialBarcode?: string }) {
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

  // a new product being typed comes back after a sign in in the middle or a reload
  const draftKey = product ? null : `product.new.${org.orgId}`;
  const [draft] = useState(() => (draftKey && !initialBarcode ? readDraft<ProductDraft>(draftKey) : null));
  const minorOf = (txt: string | undefined) => {
    if (!txt?.trim()) return undefined;
    const r = parseMoneyInput(txt);
    return r.ok ? r.value : undefined;
  };
  const nameF = useLineField(draft?.name ?? product?.name, { max: LIMITS.productName, required: true });
  const brandF = useLineField(draft?.brand ?? product?.brand, { max: LIMITS.brand, capitalize: 'words' });
  const descF = useTextField(draft?.description ?? product?.description, { max: LIMITS.description });
  const name = nameF.text;
  const [cat, setCat] = useState(draft?.cat ?? product?.categoryId ?? '');
  // the name in each language, for customers who read it (empty: the main name shows)
  const [names, setNames] = useState<Record<NameLocale, string>>(() => ({
    el: product?.translations?.el?.name ?? '', en: product?.translations?.en?.name ?? '', ru: product?.translations?.ru?.name ?? '',
  }));
  const translations = () => Object.fromEntries(NAME_LOCALES.map((l) => {
    const name = cleanLine(names[l]).slice(0, LIMITS.productName);
    return [l, name ? { name, description: product?.translations?.[l]?.description ?? null } : null];
  })) as ProductInput['translations'];
  const [newCat, setNewCat] = useState(false);
  const [uom, setUom] = useState<Uom>(draft?.uom ?? product?.uom ?? 'piece');
  const [vat, setVat] = useState(draft?.vat ?? String(product?.taxRateBp ?? rates[0]));
  const [track, setTrack] = useState(draft?.track ?? product?.trackStock ?? true);
  const priceF = useMoneyField(minorOf(draft?.price) ?? v0?.priceMinor, locale);
  const costF = useMoneyField(minorOf(draft?.cost) ?? v0?.costMinor, locale);
  const barcodeF = useBarcodeField(initialBarcode ?? draft?.barcode ?? '');
  const setBarcode = barcodeF.setText;
  const owner = useBarcodeOwner(api, org.orgId, barcodeF.text, product?.id ?? null, locale);
  const [imageError, setImageError] = useState<string | null>(null);
  const [options, setOptions] = useState<Option[]>(draft?.options ?? []);
  const [images, setImages] = useState<string[]>(draft?.images ?? product?.images.map((i) => i.url) ?? []);
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the last code made with "Make a shop barcode", so each variant can get its own one on save
  const [ownMade, setOwnMade] = useState<string | null>(null);
  const zero = money(0, org.currency, locale);
  const [startVat] = useState(() => String(rates[0]));
  useDraft(draftKey ?? 'product.none',
    draftKey ? { name: nameF.text, brand: brandF.text, description: descF.text, cat, uom, vat, track, price: priceF.text, cost: costF.text, barcode: barcodeF.text, options, images } satisfies ProductDraft : null,
    draftKey ? { name: '', brand: '', description: '', cat: '', uom: 'piece', vat: startVat, track: true, price: '', cost: '', barcode: initialBarcode ?? '', options: [], images: [] } satisfies ProductDraft : null);

  // every combination of the option values: size S, M x color black, white = 4 variants
  const combos = useMemo(() => {
    const lists = options.map((o) => o.values.split(',').map((v) => cleanLine(v).slice(0, LIMITS.optionValue)).filter(Boolean).map((v) => ({ [cleanLine(o.name).slice(0, LIMITS.optionName) || '?']: v })));
    return lists.filter((l) => l.length).reduce<Record<string, string>[]>((acc, list) => acc.flatMap((a) => list.map((b) => ({ ...a, ...b }))), [{}]).filter((c) => Object.keys(c).length);
  }, [options]);
  const imagesChanged = product ? images.join('|') !== product.images.map((i) => i.url).join('|') : images.length > 0;

  // Enter in the last field and a tap on the button in the same moment start one save, not two
  const saving = useRef(false);
  async function save() {
    if (saving.current) return;
    // every field checked first, the first one that is not right gets the focus
    const checks = [nameF, brandF, descF, barcodeF, ...(canPrice ? [priceF] : []), ...(canCost ? [costF] : [])];
    if (!checkAll(checks)) return;
    const nameV = nameF.check()!;
    const brandV = brandF.check() ?? '';
    const descV = descF.check() ?? '';
    const barcodeV = barcodeF.check() ?? null;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const priceMinor = canPrice ? priceF.check() ?? null : null;
      const costMinor = canCost ? costF.check() ?? null : null;
      if (!product) {
        const input: ProductInput = {
          name: nameV, brand: brandV || null, description: descV || null, categoryId: cat || null,
          uom, taxRateBp: Number(vat), trackStock: track,
          ...(priceMinor != null ? { priceMinor } : {}), ...(costMinor != null ? { costMinor } : {}),
          ...(barcodeV && !(supportsVariants && combos.length > 1) ? { barcode: barcodeV } : {}),
          // with variants the code goes on the first one; a made shop code gets a fresh one for each other variant below
          ...(supportsVariants && combos.length > 1 ? { variants: combos.map((o, i) => ({
            options: o, priceMinor, ...(costMinor != null ? { costMinor } : {}),
            ...(i === 0 && barcodeV ? { barcodes: [{ code: barcodeV, packQty: 1 }] } : {}),
          })) } : {}),
          ...(supportsImages && images.length ? { imageUrls: images } : {}),
          ...(NAME_LOCALES.some((l) => names[l].trim()) ? { translations: translations() } : {}),
        };
        const p = await api.createProduct(org.orgId, input);
        if (draftKey) clearDraft(draftKey);
        if (supportsVariants && combos.length > 1 && barcodeV && barcodeV === ownMade) {
          for (const v of p.variants.slice(1)) {
            const next = await api.nextInternalBarcode(org.orgId);
            await api.attachBarcode(org.orgId, v.id, next.code);
          }
        }
        forgetCatalog(org.orgId);
        toast(t('stock.created', { name: p.name }));
        router.replace(`/admin/stock/${p.id}`);
      } else {
        const patch: Partial<ProductInput> = {
          name: nameV, brand: brandV || null, description: descV || null, categoryId: cat || null,
          uom, taxRateBp: Number(vat), trackStock: track,
          ...(canPrice && priceMinor != null && priceMinor !== v0?.priceMinor ? { priceMinor } : {}),
          ...(canCost && costMinor != null && costMinor !== v0?.costMinor ? { costMinor } : {}),
          ...(barcodeV ? { barcode: barcodeV } : {}),
          ...(supportsImages && imagesChanged ? { imageUrls: images } : {}),
          translations: translations(),
        };
        await api.updateProduct(org.orgId, product.id, patch);
        forgetCatalog(org.orgId);
        toast(t('productForm.saved'));
        router.replace(`/admin/stock/${product.id}`);
      }
    } catch (e) {
      // the api's field errors go under their fields too
      const fields = (e as { problem?: { fields?: Record<string, string> } }).problem?.fields ?? {};
      const show: [string, { setError: (x: never) => void }][] = [['name', nameF], ['brand', brandF], ['description', descF], ['barcode', barcodeF], ['priceMinor', priceF], ['costMinor', costF]];
      for (const [k, f] of show) if (fields[k]) f.setError(fields[k] as never);
      // someone else saved in between: what was typed stays, a second save keeps it
      setError((e as { status?: number }).status === 412 ? t('productForm.conflict') : t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
      setBusy(false);
      saving.current = false;
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setPhotoError(null);
    try {
      for (const f of [...files].slice(0, 10 - images.length)) {
        const url = await uploadPhoto(api, org.orgId, f);
        setImages((x) => [...x, url]);
      }
    } catch (e) {
      // the photos already there stay. a paused bucket gets its own plain line, anything else the retry text
      setPhotoError((e as { code?: string }).code === 'storage_full' ? t('common:error.storage_full') : t('common:error.upload_failed'));
    } finally {
      setUploading(false);
    }
  }

  async function ownCode() {
    try {
      const code = (await api.nextInternalBarcode(org.orgId)).code;
      setBarcode(code);
      setOwnMade(code);
    } catch (e) { setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`)); }
  }

  return (
    <FormNav onDone={() => void save()} last="done">
    {draft && draftKey ? <DraftNote draftKey={draftKey} /> : null}
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px] gap-x-8 items-start">
      <div>
        <section className="inset-group">
          <ul className="list" role="list">
            <Field label={t('stock.form.name')} after={<><FieldMessage id={nameF.errorId} kind="line" error={nameF.error} params={{ max: LIMITS.productName }} /><Counter value={nameF.text} max={LIMITS.productName} /></>}><input className="field pt-1" {...nameF.inputProps} autoComplete="off" required /></Field>
            <Field label={t('productForm.brand')} sep after={<FieldMessage id={brandF.errorId} kind="line" error={brandF.error} params={{ max: LIMITS.brand }} />}><input className="field pt-1" {...brandF.inputProps} autoComplete="off" /></Field>
            <Field label={t('productForm.description')} sep after={<><FieldMessage id={descF.errorId} kind="text" error={descF.error} params={{ max: LIMITS.description }} /><Counter value={descF.text} max={LIMITS.description} /></>}><textarea className="field pt-1" rows={3} {...descF.inputProps} /></Field>
            <li className="row row-sep">
              <span className="row-main row-title">{t('stock.form.category')}</span>
              <Picker variant="plain" label={t('stock.form.category')} value={cat}
                icon={(() => { const c = (cats.data ?? []).find((x) => x.id === cat); return c ? <CategoryPicture iconKey={c.iconKey} imageUrl={c.imageUrl} size={24} rounded={6} /> : undefined; })()}
                onChange={(v) => (v === NEW_CATEGORY ? setNewCat(true) : setCat(v))}
                options={[
                  { value: '', label: t('productForm.noCategory') },
                  ...(cats.data ?? []).map((c) => ({ value: c.id, label: categoryName(c, locale) })),
                  ...(can('categories.manage', null) ? [{ value: NEW_CATEGORY, label: t('categories.newInPicker') }] : []),
                ]} />
            </li>
          </ul>
        </section>

        <section className="inset-group">
          <h2 className="inset-group-head">{t('productForm.otherNames')}</h2>
          <ul className="list" role="list">
            {NAME_LOCALES.map((l, i) => (
              <Field key={l} label={t(`categories.nameIn.${l}`)} sep={i > 0}>
                <input className="field pt-1" value={names[l]} maxLength={LIMITS.productName} placeholder={t('categories.optional')} autoComplete="off" autoCapitalize="sentences"
                  lang={l} onChange={(e) => setNames((x) => ({ ...x, [l]: e.target.value }))} />
              </Field>
            ))}
          </ul>
          <p className="inset-group-foot">{t('categories.foot')}</p>
        </section>

        <section className="inset-group">
          <h2 className="inset-group-head">{t('productForm.barcode')}</h2>
          <ul className="list" role="list">
            <li className="flex items-center pr-1">
              <label className="block flex-1">
                <span className="sr-only">{t('productForm.barcode')}</span>
                <input className="field tnum" aria-label={t('productForm.barcode')} placeholder={t('productForm.barcodePh')} {...barcodeF.inputProps} />
              </label>
              <ScanButton onCode={(c) => setBarcode(c)} />
            </li>
            {barcodeF.error ? <li><FieldMessage id={barcodeF.errorId} kind="barcode" error={barcodeF.error} /></li> : null}
            {owner ? (
              <li className="row row-sep" role="status">
                <span className="row-main min-w-0 t-sub" style={{ color: 'var(--c-error)' }}>
                  {t('productForm.barcodeOn', { name: owner.name })}{' '}
                  <Link href={`/admin/stock/${owner.productId}`} className="link">{t('productForm.barcodeOpen')}</Link>
                </span>
              </li>
            ) : null}
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
                  <input className="t-body bg-transparent border-0 outline-none w-32 min-w-0" placeholder={t('productForm.optionName')} aria-label={t('productForm.optionName')} value={o.name} maxLength={LIMITS.optionName} autoComplete="off" autoCapitalize="words"
                    onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                  <input className="t-body bg-transparent border-0 outline-none flex-1 min-w-0" placeholder={t('productForm.optionValues')} aria-label={t('productForm.optionValues')} value={o.values} maxLength={400} autoComplete="off"
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
                  <Photo src={u} alt={t('productForm.photoN', { n: i + 1 })} size={44} />
                  <span className="row-main min-w-0">
                    <span className="row-title block truncate">{t('productForm.photoN', { n: i + 1 })}</span>
                    {i === 0 ? <span className="row-sub block">{t('productForm.coverPhoto')}</span> : null}
                  </span>
                  <button type="button" className="icon-btn" aria-label={t('common:action.remove')} onClick={() => setImages((x) => x.filter((_, j) => j !== i))}><IconClose size={18} /></button>
                </li>
              ))}
              {featureOn(org, 'uploads') ? (
                <li>
                  <label className="row" style={{ color: 'var(--c-accent)', cursor: 'pointer' }}>
                    <IconPlus size={20} />
                    <span className="row-main row-title">{uploading ? t('productForm.uploading') : t('productForm.upload')}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={uploading} onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
                  </label>
                </li>
              ) : null}
              <li>
                <form className="flex items-center pr-1 row-sep relative" onSubmit={(e) => {
                  e.preventDefault();
                  const link = imageUrl.trim();
                  const problem = httpsUrlProblem(link, { required: true });
                  if (problem) { setImageError(problem); return; }
                  setImageError(null);
                  setImages((x) => [...x, link]);
                  setImageUrl('');
                }}>
                  <label className="block flex-1"><span className="sr-only">{t('productForm.photoPh')}</span>
                    <input className="field" type="url" inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" data-enter-hint="own"
                      maxLength={LIMITS.url} placeholder={t('productForm.photoPh')} value={imageUrl} aria-invalid={imageError ? true : undefined}
                      onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) => { setImageUrl(e.target.value); if (imageError) setImageError(null); }} /></label>
                  <button type="submit" className="icon-btn" aria-label={t('common:action.add')} disabled={!imageUrl.trim()}><IconPlus size={20} /></button>
                </form>
                {imageError ? <FieldMessage id="photo-link-error" kind="url" error={imageError} /> : null}
              </li>
            </ul>
            {photoError ? <p className="why-line" role="alert" style={{ color: 'var(--c-error)' }}>{photoError}</p> : null}
            <p className="inset-group-foot">{t('productForm.photoFoot')}</p>
          </section>
        ) : null}
      </div>

      <div className="lg:sticky lg:top-[72px]">
        {canPrice || canCost ? (
        <section className="inset-group">
          <h2 className="inset-group-head">{t('product.prices')}</h2>
          <ul className="list" role="list">
            {canPrice ? (
              <Field label={t('stock.form.price')}>
                <input className="field pt-1 tnum" placeholder={t('productForm.pricePh', { zero })} {...priceF.inputProps} />
              </Field>
            ) : null}
            {canPrice && priceF.error ? <li><FieldMessage id={priceF.errorId} kind="money" error={priceF.error} params={{ example: decimalExample(locale) }} /></li> : null}
            {canCost ? (
              <Field label={t('product.cost')} sep={canPrice}>
                <input className="field pt-1 tnum" placeholder={t('productForm.costPh', { zero })} {...costF.inputProps} />
              </Field>
            ) : null}
            {canCost && costF.error ? <li><FieldMessage id={costF.errorId} kind="money" error={costF.error} params={{ example: decimalExample(locale) }} /></li> : null}
          </ul>
          {canPrice ? <p className="inset-group-foot">{t('productForm.priceFoot')}</p> : null}
        </section>
        ) : null}
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
        <button type="button" className="btn btn-primary btn-large" disabled={busy || !name.trim() || !!owner} onClick={() => void save()}>
          {product ? t('common:action.save') : t('productForm.create')}
        </button>
        {!name.trim() ? <p className="why-line mb-8">{t('productForm.needName')}</p> : <div className="mb-8" />}
      </div>
      <CategorySheet open={newCat} onClose={() => setNewCat(false)}
        onSaved={(c) => { forgetCatalog(org.orgId); void cats.reload(); setCat(c.id); }} />
    </div>
    </FormNav>
  );
}
