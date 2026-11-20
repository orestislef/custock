'use client';

import type { CustomerCatalogMode, CustomerOrdersMode, CustomerStockMode, OrgSettings, Product, Shop, StockLevel } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Group, Row, Segmented, StockBadge, Switch } from '@/components/ui/kit';
import { Picker, Sheet, useToast } from '@/components/ui/client-kit';
import { IconCopy, IconInfo, IconLink, IconShop } from '@/components/ui/icons';
import { basePath } from '@/lib/api-client';
import { useAsync } from '@/lib/use-async';
import { money, qtyNumber } from '@/lib/format';
import { uploadLogo } from '@/lib/upload';
import { useRef, useState } from 'react';
import { RedirectHome } from '@/components/admin/redirect-home';
import { PolicyGroups, policyText, usePolicySaver } from '@/components/policy/policy-list';
import { LIMITS, cleanLine, featureOn, policyDef, type PolicyEntry } from '@custock/core';
import { LOCALE_NAMES } from '@custock/i18n/client';
import { IconChevronRight } from '@/components/ui/icons';
import { ShopsGroup } from '@/components/admin/shops-group';
import { isOrdersPolicy } from '@/lib/orders-on';

export default function SettingsPage() {
  const { api, org, t, can, refresh } = useAdmin();
  const toast = useToast();
  const loaded = useAsync(() => api.orgSettings(org.orgId), []);
  const shopsQ = useAsync(() => api.shops(org.orgId), []);
  // the preview shows the business's own first product, never a made up one
  const firstQ = useAsync(() => api.products(org.orgId, { limit: 1 }).then((r) => r.items[0] ?? null).catch(() => null), []);
  const first = firstQ.data ?? null;
  const s = loaded.data ?? null;
  const setS = loaded.setData;
  const shops = shopsQ.data ?? [];
  const setShops = shopsQ.setData;
  const canOrg = can('org.settings.manage', null);
  // limits and options from the policy engine: what this person may change, inside the super
  // admin's ceilings. the older switches below follow it too
  const policiesQ = useAsync(() => api.orgPolicies(org.orgId).catch(() => null), []);
  const saver = usePolicySaver(async (p) => {
    const r = await api.setOrgPolicies(org.orgId, p);
    setS(await api.orgSettings(org.orgId));
    toast(t('settings.saved'));
    void refresh();
    return r;
  }, policiesQ.data?.entries ?? null);
  const entries: PolicyEntry[] = saver.entries ?? policiesQ.data?.entries ?? [];
  const entryOf = (key: string) => entries.find((e) => e.key === key);
  // the engine says who may change what. before it answers, the person's own permission decides
  const editable = (key: string) => entryOf(key)?.editable ?? canOrg;
  const valueRow = (key: string, title: string) => {
    const e = entryOf(key);
    const def = policyDef(key);
    return e && def ? <Row title={title} value={policyText(t, def, e.effective)} /> : null;
  };
  // shown in their own places on this page, the rest of the engine's keys get the list below
  const OWN_PLACE = new Set(['catalog.mode', 'catalog.prices', 'catalog.stock', 'stock.allowNegative', 'posts.needApproval', 'orders.mode']);
  const ordersMode: CustomerOrdersMode = s?.customerOrders ?? 'off';
  const ordersFeature = featureOn(org, 'orders');

  async function patch(p: Partial<OrgSettings>) {
    if (!s) return;
    const prev = s;
    setS({ ...s, ...p });
    try {
      setS(await api.updateOrgSettings(org.orgId, p));
      toast(t('settings.saved'));
      void refresh();
    } catch (e) {
      setS(prev);
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  async function patchShop(id: string, p: Partial<Shop>) {
    setShops((x) => (x ?? []).map((y) => (y.id === id ? { ...y, ...p } : y)));
    try {
      await api.updateShop(org.orgId, id, p);
      toast(t('settings.saved'));
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
      void shopsQ.reload();
    }
  }

  // nothing here this person can change: the screen is not theirs
  if (!canOrg && !org.shops.some((x) => can('shop.settings.manage', x.shopId))) return <RedirectHome />;
  if (!s) return <Page title={t('settings.title')}><div className="h-40 skel" /></Page>;

  return (
    <Page title={t('settings.title')} subtitle={org.name}>
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px] gap-x-8">
        <div>
          {canOrg ? <BusinessGroup s={s} onPatch={(p) => void patch(p)} /> : null}
          <ShopsGroup shops={shops} onChanged={(shop, created) => {
            setShops((x) => (created ? [...(x ?? []), shop] : (x ?? []).map((y) => (y.id === shop.id ? shop : y))));
            // the frame reloads the person's shops: picker, stock, scan, transfers and QR codes
            void refresh();
          }} />

          <h2 className="t-title3 m-0 mb-1">{t('settings.customerPage')}</h2>
          {canOrg ? <p className="t-sub t-2 m-0 mb-5">{t('settings.customerPageLead')}</p> : <div className="mb-5" />}

          {canOrg ? <LogoCard logoUrl={s.logoUrl} canOrg onSaved={setS} /> : null}
          <ShopPageCard slug={s.slug} mode={s.customerCatalog} canOrg={canOrg} onPublic={() => void patch({ customerCatalog: 'public' })} />

          {canOrg ? (
          <section className="inset-group">
            <h3 className="inset-group-head">{t('settings.catalog')}</h3>
            <div className="mb-2 overflow-x-auto">
              {editable('catalog.mode') ? (
                <Segmented label={t('settings.catalog')} value={s.customerCatalog} onChange={(v: CustomerCatalogMode) => canOrg && void patch({ customerCatalog: v })}
                  options={(['off', 'subscribers', 'public'] as const).map((v) => ({ value: v, label: t(`settings.catalogMode.${v}`) }))} />
              ) : <p className="t-body m-0">{t(`settings.catalogMode.${s.customerCatalog}`)}</p>}
            </div>
            <p className="inset-group-foot">{t(`settings.catalogFoot.${s.customerCatalog}`)}</p>
          </section>
          ) : null}

          <section className="inset-group lg:hidden">
            <h3 className="inset-group-head">{t('settings.preview')}</h3>
            <Preview s={s} shops={shops} product={first} />
            <p className="inset-group-foot">{t(first ? 'settings.previewFoot' : 'settings.previewFootEmpty')}</p>
          </section>

          {canOrg ? (
          <>
          <Group footer={t('settings.pricesFoot')}>
            {editable('catalog.prices')
              ? <Row title={t('settings.prices')} trailing={<Switch checked={s.customerPrices} label={t('settings.prices')} onChange={(v) => void patch({ customerPrices: v })} />} />
              : valueRow('catalog.prices', t('settings.prices'))}
          </Group>

          <section className="inset-group">
            <h3 className="inset-group-head">{t('settings.stock')}</h3>
            <div className="mb-2 overflow-x-auto">
              {editable('catalog.stock') ? (
                <Segmented label={t('settings.stock')} value={s.customerStock} onChange={(v: CustomerStockMode) => canOrg && void patch({ customerStock: v })}
                  options={(['off', 'availability', 'exact'] as const).map((v) => ({ value: v, label: t(`settings.stockMode.${v}`) }))} />
              ) : <p className="t-body m-0">{t(`settings.stockMode.${s.customerStock}`)}</p>}
            </div>
            <p className="inset-group-foot">{t(`settings.stockFoot.${s.customerStock}`)}</p>
            {s.customerStock === 'exact' ? <div className="tip mt-3"><IconInfo size={18} /><span className="t-sub">{t('settings.competitors')}</span></div> : null}
          </section>

          {ordersFeature ? (
            <section className="inset-group">
              <h3 className="inset-group-head">{t('settings.orders')}</h3>
              <div className="mb-2 overflow-x-auto">
                {editable('orders.mode') ? (
                  <Segmented label={t('settings.orders')} value={ordersMode} onChange={(v: CustomerOrdersMode) => void patch({ customerOrders: v })}
                    options={(['off', 'quote', 'priced'] as const).map((v) => ({ value: v, label: t(`settings.ordersMode.${v}`) }))} />
                ) : <p className="t-body m-0">{t(`settings.ordersMode.${ordersMode}`)}</p>}
              </div>
              <p className="inset-group-foot">{t(`settings.ordersFoot.${ordersMode}`)}</p>
              {ordersMode === 'priced' && !s.customerPrices ? <div className="tip mt-3"><IconInfo size={18} /><span className="t-sub">{t('settings.ordersPricesHidden')}</span></div> : null}
            </section>
          ) : null}
          </>
          ) : null}

          <Group title={t('settings.perShop')} footer={t('settings.perShopFoot')}>
            {shops.filter((sh) => canOrg || can('shop.settings.manage', sh.id)).map((sh) => {
              const value = !sh.customerVisible ? 'hidden' : sh.customerStock ?? 'default';
              return (
                // the choice goes under the shop name when both do not fit on a phone
                <div key={sh.id} className="row flex-wrap gap-y-1">
                  <span className="icon-tile"><IconShop size={18} /></span>
                  <span className="row-main min-w-[7rem]">
                    <span className="row-title block">{sh.name}</span>
                  </span>
                  <Picker variant="plain" label={t('settings.shopStock', { shop: sh.name })} value={value}
                    onChange={(v) => void patchShop(sh.id, v === 'hidden' ? { customerVisible: false } : { customerVisible: true, customerStock: v === 'default' ? null : (v as CustomerStockMode) })}
                    options={[
                      { value: 'default', label: t('settings.useBusiness') },
                      ...(['off', 'availability', 'exact'] as const).map((v) => ({ value: v, label: t(`settings.stockMode.${v}`) })),
                      { value: 'hidden', label: t('settings.hiddenShop') },
                    ]} className="ml-auto" />
                </div>
              );
            })}
          </Group>

          {ordersFeature && ordersMode !== 'off' && shops.length > 1 ? (
            <Group title={t('settings.ordersPerShop')} footer={t('settings.ordersPerShopFoot')}>
              {shops.filter((sh) => canOrg || can('shop.settings.manage', sh.id)).map((sh) => (
                <Row key={sh.id} leading={<span className="icon-tile"><IconShop size={18} /></span>} title={sh.name}
                  trailing={<Switch checked={sh.customerOrders !== 'off'} label={t('settings.ordersAt', { shop: sh.name })} onChange={(v) => void patchShop(sh.id, { customerOrders: v ? null : 'off' })} />} />
              ))}
            </Group>
          ) : null}

          {canOrg ? (
            <>
              <h2 className="t-title3 m-0 mb-4 mt-10">{t('settings.policies')}</h2>
              <Group footer={t('settings.negativeFoot')}>
                {editable('stock.allowNegative')
                  ? <Row title={t('settings.negative')} trailing={<Switch checked={s.allowNegativeStock} label={t('settings.negative')} onChange={(v) => void patch({ allowNegativeStock: v })} />} />
                  : valueRow('stock.allowNegative', t('settings.negative'))}
              </Group>
              <Group footer={t('settings.approvalFoot')}>
                {editable('posts.needApproval') && entryOf('posts.needApproval')?.inherited !== true
                  ? <Row title={t('settings.approval')} trailing={<Switch checked={s.postsNeedApproval} label={t('settings.approval')} onChange={(v) => void patch({ postsNeedApproval: v })} />} />
                  : valueRow('posts.needApproval', t('settings.approval'))}
              </Group>
              {entries.length ? (
                <PolicyGroups entries={entries.filter((e) => !OWN_PLACE.has(e.key) && (ordersFeature && ordersMode !== 'off' || !isOrdersPolicy(e.key)))} busyKey={saver.busyKey} onChange={(k, v) => void saver.change(k, v)} />
              ) : (
                <Group title={t('settings.push')} footer={t('settings.pushFoot')}>
                  <Row title={t('settings.cap')} value={t('settings.capValue', { count: s.pushDailyCap })} />
                  <Row title={t('settings.quiet')} value={t('settings.quietValue', { from: s.quietHours.split('-')[0], to: s.quietHours.split('-')[1] })} />
                </Group>
              )}
              {saver.error ? <p className="sheet-error" role="alert">{t(`common:error.${saver.error}`, { defaultValue: t('common:error.internal') })}</p> : null}
            </>
          ) : null}
        </div>

        <aside className="hidden lg:block lg:sticky lg:top-[72px] self-start mb-8">
          <h3 className="inset-group-head">{t('settings.preview')}</h3>
          <Preview s={s} shops={shops} product={first} />
          <p className="inset-group-foot">{t(first ? 'settings.previewFoot' : 'settings.previewFootEmpty')}</p>
        </aside>
      </div>
    </Page>
  );
}

// a live preview of what a customer sees for one product, so the switches explain themselves. it
// uses the business's own first product and its real shops. before there is a product, the same
// layout with neutral placeholders: no invented names, prices or quantities.
function Preview({ s, shops, product }: { s: OrgSettings; shops: Shop[]; product: (Product & { levels: StockLevel[] }) | null }) {
  const { t, locale, org } = useAdmin();
  if (s.customerCatalog === 'off') {
    return <div className="card p-5"><p className="t-sub t-2 m-0">{t('settings.previewOff')}</p></div>;
  }
  const variant = product?.variants[0] ?? null;
  const price = variant?.priceMinor ?? null;
  return (
    <div className="card overflow-hidden">
      <div className="p-4">
        <p className="t-foot t-2 m-0">{org.name}</p>
        {product ? <p className="t-headline m-0 mt-0.5">{product.displayName ?? product.name}</p>
          : <p className="t-headline t-2 m-0 mt-0.5">{t('settings.previewYourProduct')}</p>}
        <p className="t-title3 tnum m-0 mt-2">
          {!s.customerPrices ? <span className="t-sub t-2" style={{ fontWeight: 400 }}>{t('settings.previewNoPrice')}</span>
            : price != null ? money(price, org.currency, locale)
              : <span className="t-sub t-2" style={{ fontWeight: 400 }}>{t('settings.previewPrice')}</span>}
        </p>
      </div>
      <div style={{ borderTop: '0.5px solid var(--c-line)' }}>
        {shops.filter((sh) => sh.customerVisible).map((sh) => {
          const mode = sh.customerStock ?? s.customerStock;
          const level = product && variant ? product.levels.find((l) => l.shopId === sh.id && l.variantId === variant.id) : undefined;
          const on = product ? Math.max(0, level?.onHand ?? 0) : null;
          const state = on == null ? null : on === 0 ? 'out' : on <= s.fewLeftThreshold ? 'few' : 'in';
          return (
            <div key={sh.id} className="row">
              <span className="row-main row-title">{sh.name}</span>
              {mode === 'off' ? null
                : on == null ? <span className="t-sub t-2">{t(mode === 'exact' ? 'settings.previewExact' : 'settings.previewInOrOut')}</span>
                  : mode === 'exact' && on > 0 ? <span className="t-sub t-2 tnum">{product!.uom === 'piece' ? t('common:stock.qtyInStock', { count: on }) : qtyNumber(on, product!.uom, locale)}</span>
                    : state === 'in' ? <span className="t-sub t-2">{t('common:stock.in')}</span> : <StockBadge state={state as 'few' | 'out'} label={t(`common:stock.${state}`)} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// the business logo: on the shop page header, the home screen icon customers add, and the emails.
// it fits inside a square on a transparent background, so a wide wordmark is never cut.
function LogoCard({ logoUrl, canOrg, onSaved }: { logoUrl: string | null; canOrg: boolean; onSaved: (s: OrgSettings) => void }) {
  const { api, org, t } = useAdmin();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // a failed upload says so in the card, and the old logo stays
  const [err, setErr] = useState<string | null>(null);
  const fail = (e: unknown) => setErr(t(`common:error.${(e as { code?: string }).code ?? 'upload_failed'}`));

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await uploadLogo(api, org.orgId, file);
      onSaved(await api.updateOrgSettings(org.orgId, { logoFileId: r.fileId }));
      toast(t('settings.logo.saved'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      onSaved(await api.updateOrgSettings(org.orgId, { logoFileId: null }));
      toast(t('settings.logo.removed'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4 mb-4">
      <div className="flex items-center gap-4">
        <span className="grid place-items-center flex-none rounded-[14px] overflow-hidden" style={{ width: 64, height: 64, background: logoUrl ? '#FFFFFF' : 'var(--c-fill)', boxShadow: '0 0 0 0.5px var(--c-line)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl ? <img src={logoUrl} alt={t('settings.logo.alt', { org: org.name })} width={56} height={56} className="object-contain" style={{ opacity: busy ? 0.5 : 1 }} />
            : <IconShop size={26} style={{ color: 'var(--c-ink-3)' }} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="t-headline m-0">{t('settings.logo.title')}</p>
          <p className="t-foot t-2 m-0 mt-0.5">{t('settings.logo.foot')}</p>
          {canOrg ? (
            <div className="flex flex-wrap gap-x-4 mt-1">
              <button type="button" className="btn btn-plain" style={{ minHeight: 36, padding: 0 }} disabled={busy} onClick={() => input.current?.click()}>{logoUrl ? t('settings.logo.change') : t('settings.logo.add')}</button>
              {logoUrl ? <button type="button" className="btn btn-plain" style={{ minHeight: 36, padding: 0, color: 'var(--c-error)' }} disabled={busy} onClick={() => void remove()}>{t('settings.logo.remove')}</button> : null}
            </div>
          ) : null}
          {err ? <p className="t-foot m-0" role="alert" style={{ color: 'var(--c-error)' }}>{err}</p> : null}
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void choose(e.target.files?.[0])} />
    </section>
  );
}

// the business's own page for customers, and the one switch that decides whether a stranger can
// browse it. a new business starts with followers only, so this says so and offers the change.
function ShopPageCard({ slug, mode, canOrg, onPublic }: { slug: string; mode: CustomerCatalogMode; canOrg: boolean; onPublic: () => void }) {
  const { t } = useAdmin();
  const toast = useToast();
  const url = typeof window === 'undefined' ? `${basePath}/s/${slug}` : `${window.location.origin}${basePath}/s/${slug}`;
  return (
    <section className="card p-4 mb-7">
      <div className="flex gap-3 items-start">
        <span className="icon-tile flex-none"><IconLink size={18} /></span>
        <div className="flex-1 min-w-0">
          <p className="t-headline m-0">{t('settings.shopPage')}</p>
          <p className="t-sub t-2 m-0 mt-1">{t(`settings.shopPageState.${mode}`)}</p>
          <p className="t-sub m-0 mt-2 truncate tnum"><a href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, '')}</a></p>
          <div className="flex gap-2 mt-3 flex-wrap">
            {mode !== 'public' && canOrg ? <button type="button" className="btn btn-primary" onClick={onPublic}>{t('settings.makePublic')}</button> : null}
            <button type="button" className="btn btn-gray" onClick={() => void navigator.clipboard.writeText(url).then(() => toast(t('links.copied')))}><IconCopy size={18} />{t('settings.copyLink')}</button>
          </div>
        </div>
      </div>
    </section>
  );
}

// the business itself: its name, the language for customers whose own is unknown, and the time
// zone every date, quiet hour and report follows
function zoneLabel(zone: string): string {
  let offset = '';
  try {
    offset = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(Date.now()).find((x) => x.type === 'timeZoneName')?.value ?? '';
  } catch {
    // an alias the browser does not know
  }
  return `${zone.replace(/_/g, ' ').replace(/\//g, ' / ')}${offset ? ` (${offset})` : ''}`;
}

function timeZones(current: string): string[] {
  const all: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Europe/Athens', 'Europe/Nicosia', 'Europe/Moscow', 'Europe/London', 'UTC'];
  return all.includes(current) ? all : [current, ...all];
}

function BusinessGroup({ s, onPatch }: { s: OrgSettings; onPatch: (p: Partial<OrgSettings>) => void }) {
  const { t } = useAdmin();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const clean = cleanLine(name);
  const valid = clean.length >= 1 && clean.length <= LIMITS.businessName && clean !== s.name;
  const zones = timeZones(s.timezone);
  return (
    <>
      <h2 className="t-title3 m-0 mb-4">{t('settings.business.title')}</h2>
      <Group footer={t('settings.business.foot')}>
        <button type="button" className="row" onClick={() => { setName(s.name); setEditing(true); }}>
          <span className="row-main row-title">{t('settings.business.name')}</span>
          <span className="t-body t-2 text-right min-w-0 truncate">{s.name}</span>
          <IconChevronRight size={16} className="chev" />
        </button>
        <div className="row">
          <span className="row-main row-title">{t('settings.business.language')}</span>
          <Picker variant="plain" label={t('settings.business.language')} value={s.defaultLocale}
            onChange={(v) => onPatch({ defaultLocale: v })}
            options={(['en', 'el', 'ru'] as const).map((l) => ({ value: l, label: LOCALE_NAMES[l] }))} />
        </div>
        <div className="row">
          <span className="row-main row-title">{t('settings.business.timezone')}</span>
          <Picker variant="plain" label={t('settings.business.timezone')} value={s.timezone}
            onChange={(v) => onPatch({ timezone: v })}
            options={zones.map((z) => ({ value: z, label: zoneLabel(z) }))} />
        </div>
      </Group>
      <Sheet open={editing} onClose={() => setEditing(false)} title={t('settings.business.name')}
        footer={<>
          <button type="button" className="btn btn-gray" onClick={() => setEditing(false)}>{t('common:action.cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => { onPatch({ name: clean }); setEditing(false); }}>{t('common:action.save')}</button>
        </>}>
        <form onSubmit={(e) => { e.preventDefault(); if (valid) { onPatch({ name: clean }); setEditing(false); } }}>
          <label className="block">
            <span className="t-foot t-2 block mb-1">{t('settings.business.name')}</span>
            <input className="field" type="text" autoComplete="organization" autoCapitalize="words" enterKeyHint="done"
              maxLength={LIMITS.businessName} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setName(cleanLine(name))} data-autofocus />
          </label>
        </form>
      </Sheet>
    </>
  );
}
