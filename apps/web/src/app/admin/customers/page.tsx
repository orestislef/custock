'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Locale } from '@custock/core';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { IconPlus } from '@/components/ui/icons';
import { useAdmin, useShopFilter } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Avatar, Empty, Row, Segmented, Switch, Why } from '@/components/ui/kit';
import { IconBell, IconMail, IconPeople, IconSearch } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { LOCALE_NAMES } from '@custock/i18n';

type Channel = 'all' | 'email' | 'push';

export default function CustomersPage() {
  const { api, org, t, can } = useAdmin();
  const shopId = useShopFilter();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [channel, setChannel] = useState<Channel>('all');
  const [adding, setAdding] = useState(false);
  useEffect(() => { const id = setTimeout(() => setDebounced(q), 180); return () => clearTimeout(id); }, [q]);

  const list = useAsync(() => api.customers(org.orgId, { q: debounced || undefined, shopId, channel: channel === 'all' ? undefined : channel, limit: 200 }), [debounced, shopId, channel]);
  const items = list.data?.items ?? [];
  const masked = items.some((c) => c.contactMasked);

  if (!can('customers.view', null)) {
    return <Page title={t('customers.title')}><Empty icon={<IconPeople size={40} />} title={t('customers.noAccess')} body={t('common:error.forbidden')} /></Page>;
  }

  return (
    <Page title={t('customers.title')} subtitle={list.data ? t('customers.count', { count: items.length }) : undefined}
      actions={can('customers.add', null) ? <button type="button" className="btn btn-tinted" onClick={() => setAdding(true)}><IconPlus size={18} />{t('customers.add')}</button> : null}>
      <div className="flex flex-col gap-3 mb-5">
        <div className="search">
          <IconSearch size={18} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('customers.search')} aria-label={t('customers.search')} />
        </div>
        <div><Segmented label={t('customers.channel')} value={channel} onChange={setChannel} options={[{ value: 'all', label: t('customers.all') }, { value: 'email', label: t('common:channel.email') }, { value: 'push', label: t('common:channel.push') }]} /></div>
      </div>

      {list.data && !items.length ? (
        <Empty icon={<IconPeople size={40} />} title={debounced ? t('customers.noResults') : t('customers.emptyTitle')} body={debounced ? undefined : t('customers.emptyBody')}
          action={!debounced && can('joinlinks.manage', null) ? <Link className="btn btn-tinted" href="/admin/join-links">{t('customers.printQr')}</Link> : undefined} />
      ) : (
        <section className="group">
          <div className="list">
            {items.map((c) => (
              <Link key={c.id} href={`/admin/customers/${c.id}`} className="row has-icon" style={{ '--sep-inset': '64px' } as React.CSSProperties}>
                <Avatar name={c.name} />
                <span className="row-main">
                  <span className="row-title block">{c.name}</span>
                  <span className="row-sub block truncate">{c.email} · {LOCALE_NAMES[c.locale]}</span>
                  {c.tags.length ? (
                    <span className="flex gap-1.5 flex-wrap mt-1">{c.tags.map((tag) => <span key={tag} className="badge badge-gray">{tag}</span>)}</span>
                  ) : null}
                </span>
                <span className="flex gap-1.5" style={{ color: 'var(--c-ink-3)' }}>
                  <span title={t('common:channel.email')} style={{ color: c.emailOk ? 'var(--c-ink-2)' : 'var(--c-line)' }}><IconMail size={18} aria-label={c.emailOk ? t('customers.emailOn') : t('customers.emailOff')} /></span>
                  <span title={t('common:channel.push')} style={{ color: c.pushOk ? 'var(--c-ink-2)' : 'var(--c-line)' }}><IconBell size={18} aria-label={c.pushOk ? t('customers.pushOn') : t('customers.pushOff')} /></span>
                </span>
              </Link>
            ))}
            {!list.data ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="row"><span className="w-9 h-9 rounded-full skel" /><span className="row-main"><span className="block h-4 w-1/2 skel" /><span className="block h-3 w-2/3 skel mt-2" /></span></div>
            )) : null}
          </div>
          {masked ? <p className="group-foot"><Why>{t('customers.maskedWhy')}</Why></p> : null}
        </section>
      )}
      {adding ? <AddCustomer onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void list.reload(); }} /> : null}
    </Page>
  );
}

// adding someone at the counter: they type their own details, nothing is sent until they confirm
function AddCustomer({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { api, org, t, can, shops, shopId } = useAdmin();
  const toast = useToast();
  const allowed = shops.filter((s) => can('customers.add', s.id));
  const [shop, setShop] = useState(shopId && allowed.some((s) => s.id === shopId) ? shopId : allowed[0]?.id ?? '');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [lang, setLang] = useState<Locale>(org.defaultLocale);
  const [emailNews, setEmailNews] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.addCustomer(org.orgId, { name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}), locale: lang, shopId: shop, emailNews, push: false, tags: [] });
      toast(t('customers.added', { name }));
      onAdded();
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('customers.add')} footer={<button type="button" className="btn btn-primary btn-large" disabled={busy || !name.trim() || !shop} onClick={() => void save()}>{t('common:action.add')}</button>}>
      <p className="t-sub t-2 mt-0 mb-4">{t('customers.addLead')}</p>
      <div className="list mb-4">
        <input className="field" placeholder={t('join.name')} aria-label={t('join.name')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <div className="row-sep relative"><input className="field" type="email" inputMode="email" placeholder={t('join.email')} aria-label={t('join.email')} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></div>
        <div className="row-sep relative"><input className="field" type="tel" inputMode="tel" placeholder={t('customer.phone')} aria-label={t('customer.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" /></div>
      </div>
      <div className="list mb-4">
        <label className="row">
          <span className="row-main row-title">{t('stockSheet.shop')}</span>
          <select className="t-body bg-transparent border-0 outline-none text-right" style={{ color: 'var(--c-ink-2)' }} value={shop} onChange={(e) => setShop(e.target.value)}>
            {allowed.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="row">
          <span className="row-main row-title">{t('customer.language')}</span>
          <select className="t-body bg-transparent border-0 outline-none text-right" style={{ color: 'var(--c-ink-2)' }} value={lang} onChange={(e) => setLang(e.target.value as Locale)}>
            <option value="el">Ελληνικά</option><option value="en">English</option><option value="ru">Русский</option>
          </select>
        </label>
        <Row title={t('join.emailNews')} subtitle={t('customers.addConsent')} trailing={<Switch checked={emailNews} onChange={setEmailNews} label={t('join.emailNews')} disabled={!email.trim()} />} />
      </div>
    </Sheet>
  );
}
