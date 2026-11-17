'use client';

import type { CustomerCatalogMode, CustomerStockMode, OrgSettings, Shop } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Group, Row, Segmented, StockBadge, Switch, Why } from '@/components/ui/kit';
import { useToast } from '@/components/ui/client-kit';
import { IconInfo, IconShop } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { money } from '@/lib/format';

export default function SettingsPage() {
  const { api, org, t, can, refresh } = useAdmin();
  const toast = useToast();
  const loaded = useAsync(() => api.orgSettings(org.orgId), []);
  const shopsQ = useAsync(() => api.shops(org.orgId), []);
  const s = loaded.data ?? null;
  const setS = loaded.setData;
  const shops = shopsQ.data ?? [];
  const setShops = shopsQ.setData;
  const canOrg = can('org.settings.manage', null);

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

  if (!s) return <Page title={t('settings.title')}><div className="h-40 skel" /></Page>;

  return (
    <Page title={t('settings.title')} subtitle={org.name}>
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px] gap-x-8">
        <div>
          <h2 className="t-title3 m-0 mb-1">{t('settings.customerPage')}</h2>
          <p className="t-sub t-2 m-0 mb-5">{t('settings.customerPageLead')}</p>

          <section className="group">
            <h3 className="group-head">{t('settings.catalog')}</h3>
            <div className="px-1 mb-2 overflow-x-auto">
              <Segmented label={t('settings.catalog')} value={s.customerCatalog} onChange={(v: CustomerCatalogMode) => canOrg && void patch({ customerCatalog: v })}
                options={(['off', 'subscribers', 'public'] as const).map((v) => ({ value: v, label: t(`settings.catalogMode.${v}`) }))} />
            </div>
            <p className="group-foot">{t(`settings.catalogFoot.${s.customerCatalog}`)}</p>
          </section>

          <Group footer={t('settings.pricesFoot')}>
            <Row title={t('settings.prices')} trailing={<Switch checked={s.customerPrices} disabled={!canOrg} label={t('settings.prices')} onChange={(v) => void patch({ customerPrices: v })} />} />
          </Group>

          <section className="group">
            <h3 className="group-head">{t('settings.stock')}</h3>
            <div className="px-1 mb-2 overflow-x-auto">
              <Segmented label={t('settings.stock')} value={s.customerStock} onChange={(v: CustomerStockMode) => canOrg && void patch({ customerStock: v })}
                options={(['off', 'availability', 'exact'] as const).map((v) => ({ value: v, label: t(`settings.stockMode.${v}`) }))} />
            </div>
            <p className="group-foot">{t(`settings.stockFoot.${s.customerStock}`)}</p>
            {s.customerStock === 'exact' ? <div className="tip mt-3"><IconInfo size={18} className="flex-none mt-0.5" /><span className="t-sub">{t('settings.competitors')}</span></div> : null}
          </section>

          <Group title={t('settings.perShop')} footer={t('settings.perShopFoot')}>
            {shops.map((sh) => {
              const editable = canOrg || can('shop.settings.manage', sh.id);
              return (
                <div key={sh.id} className="row flex-wrap">
                  <span className="icon-tile" style={{ background: 'var(--c-fill)', color: 'var(--c-ink-2)' }}><IconShop size={18} /></span>
                  <span className="row-main min-w-[120px]">
                    <span className="row-title block">{sh.name}</span>
                    {!editable ? <span className="row-sub block"><Why>{t('common:why.notYourShop')}</Why></span> : null}
                  </span>
                  <select className="t-sub bg-transparent border-0 outline-none text-right" style={{ color: 'var(--c-ink-2)' }} disabled={!editable} aria-label={t('settings.shopStock', { shop: sh.name })}
                    value={sh.customerStock ?? 'default'} onChange={(e) => void patchShop(sh.id, { customerStock: e.target.value === 'default' ? null : (e.target.value as CustomerStockMode) })}>
                    <option value="default">{t('settings.useBusiness')}</option>
                    {(['off', 'availability', 'exact'] as const).map((v) => <option key={v} value={v}>{t(`settings.stockMode.${v}`)}</option>)}
                  </select>
                  <Switch checked={sh.customerVisible} disabled={!editable} label={t('settings.shopVisible', { shop: sh.name })} onChange={(v) => void patchShop(sh.id, { customerVisible: v })} />
                </div>
              );
            })}
          </Group>

          <h2 className="t-title3 m-0 mb-4 mt-10">{t('settings.policies')}</h2>
          <Group footer={t('settings.negativeFoot')}>
            <Row title={t('settings.negative')} trailing={<Switch checked={s.allowNegativeStock} disabled={!canOrg} label={t('settings.negative')} onChange={(v) => void patch({ allowNegativeStock: v })} />} />
          </Group>
          <Group footer={t('settings.approvalFoot')}>
            <Row title={t('settings.approval')} trailing={<Switch checked={s.postsNeedApproval} disabled={!canOrg} label={t('settings.approval')} onChange={(v) => void patch({ postsNeedApproval: v })} />} />
          </Group>
          <Group title={t('settings.push')} footer={t('settings.pushFoot')}>
            <Row title={t('settings.cap')} value={t('settings.capValue', { count: s.pushDailyCap })} />
            <Row title={t('settings.quiet')} value={t('settings.quietValue', { from: s.quietHours.split('-')[0], to: s.quietHours.split('-')[1] })} />
          </Group>
          {!canOrg ? <p><Why>{t('settings.readOnly')}</Why></p> : null}
        </div>

        <aside className="lg:sticky lg:top-[72px] self-start mb-8">
          <h3 className="group-head">{t('settings.preview')}</h3>
          <Preview s={s} shops={shops} />
          <p className="group-foot">{t('settings.previewFoot')}</p>
        </aside>
      </div>
    </Page>
  );
}

// a live preview of what a customer sees for one product, so the switches explain themselves
function Preview({ s, shops }: { s: OrgSettings; shops: Shop[] }) {
  const { t, locale, org } = useAdmin();
  const sample = [{ id: 'a', on: 7 }, { id: 'b', on: 2 }, { id: 'c', on: 0 }];
  if (s.customerCatalog === 'off') {
    return <div className="card p-5"><p className="t-sub t-2 m-0">{t('settings.previewOff')}</p></div>;
  }
  return (
    <div className="card overflow-hidden">
      <div className="p-4">
        <p className="t-foot t-2 m-0">{org.name}</p>
        <p className="t-headline m-0 mt-0.5">{t('settings.previewProduct')}</p>
        <p className="t-title3 tnum m-0 mt-2">{s.customerPrices ? money(1290, org.currency, locale) : <span className="t-sub t-2" style={{ fontWeight: 400 }}>{t('settings.previewNoPrice')}</span>}</p>
      </div>
      <div style={{ borderTop: '0.5px solid var(--c-line)' }}>
        {shops.filter((sh) => sh.customerVisible).map((sh, i) => {
          const mode = sh.customerStock ?? s.customerStock;
          const on = sample[i % 3]!.on;
          const state = on === 0 ? 'out' : on <= s.fewLeftThreshold ? 'few' : 'in';
          return (
            <div key={sh.id} className="row">
              <span className="row-main row-title">{sh.name}</span>
              {mode === 'off' ? null : mode === 'exact' && on > 0 ? <span className="t-sub t-2 tnum">{t('common:stock.qtyInStock', { count: on })}</span>
                : state === 'in' ? <span className="t-sub t-2">{t('common:stock.in')}</span> : <StockBadge state={state} label={t(`common:stock.${state}`)} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
