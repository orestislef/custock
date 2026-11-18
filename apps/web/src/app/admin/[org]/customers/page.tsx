'use client';

import Link from '@/components/admin/org-link';
import { useOrgRouter as useRouter } from '@/components/admin/org-link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Customer, Locale } from '@custock/core';
import { LOCALES, LOCALE_NAMES } from '@custock/i18n';
import { Picker, Sheet, isMac, useShortcuts, useToast } from '@/components/ui/client-kit';
import { useAdmin, useShopFilter } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Avatar, Empty, Segmented, Switch } from '@/components/ui/kit';
import { IconBell, IconBellOff, IconMail, IconMailOff, IconPeople, IconPlus, IconSearch } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { useMedia } from '@/lib/use-media';
import { date } from '@/lib/format';
import { RedirectHome } from '@/components/admin/redirect-home';
import { LIMITS } from '@custock/core';
import { checkAll, useEmailField, useLineField, usePhoneField } from '@/lib/fields';
import { FieldMessage, FormNav } from '@/components/ui/field-kit';

type Channel = 'all' | 'email' | 'push';

// channel state never by color alone: on is the plain glyph in secondary ink, off is the slashed glyph
function Channels({ c }: { c: Customer }) {
  const { t } = useAdmin();
  return (
    <span className="inline-flex gap-2 items-center">
      <span title={c.emailOk ? t('customers.emailOn') : t('customers.emailOff')} style={{ color: c.emailOk ? 'var(--c-ink-2)' : 'var(--c-ink-3)' }}>
        {c.emailOk ? <IconMail size={18} aria-label={t('customers.emailOn')} /> : <IconMailOff size={18} aria-label={t('customers.emailOff')} />}
      </span>
      <span title={c.pushOk ? t('customers.pushOn') : t('customers.pushOff')} style={{ color: c.pushOk ? 'var(--c-ink-2)' : 'var(--c-ink-3)' }}>
        {c.pushOk ? <IconBell size={18} aria-label={t('customers.pushOn')} /> : <IconBellOff size={18} aria-label={t('customers.pushOff')} />}
      </span>
    </span>
  );
}

export default function CustomersPage() {
  const { api, org, t, locale, can, shops } = useAdmin();
  const shopId = useShopFilter();
  const router = useRouter();
  const wide = useMedia('(min-width: 1024px)');
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [channel, setChannel] = useState<Channel>('all');
  const [adding, setAdding] = useState(false);
  useEffect(() => { const id = setTimeout(() => setDebounced(q), 180); return () => clearTimeout(id); }, [q]);
  const canAdd = can('customers.add', null);
  useShortcuts({ search: useCallback(() => searchRef.current?.focus(), []), create: useCallback(() => { if (canAdd) setAdding(true); }, [canAdd]) });

  const list = useAsync(() => api.customers(org.orgId, { q: debounced || undefined, shopId, channel: channel === 'all' ? undefined : channel, limit: 200 }), [debounced, shopId, channel]);
  const groups = useAsync(() => api.groups(org.orgId), []);
  const items = list.data?.items ?? [];
  // contact details only for those who may see them. nobody else gets a column of stars
  const showEmail = items.some((c) => !c.contactMasked);
  const scopeName = (c: Customer) => c.subscriptions.filter((s) => s.status !== 'unsubscribed').map((s) =>
    s.scopeType === 'org' ? t('common:scope.org') : s.scopeType === 'group' ? groups.data?.find((g) => g.id === s.scopeId)?.name ?? '' : shops.find((x) => x.id === s.scopeId)?.name ?? t('transfers.otherShop')).join(', ');

  if (!can('customers.view', null)) return <RedirectHome />;

  return (
    <Page title={t('customers.title')} subtitle={list.data ? t('customers.count', { count: items.length }) : undefined}
      actions={canAdd ? <button type="button" className="btn btn-tinted" title={`${t('customers.add')} (${isMac() ? '⌘' : 'Ctrl+'}N)`} onClick={() => setAdding(true)}><IconPlus size={18} />{t('customers.add')}</button> : null}
      phoneAction={canAdd ? <button type="button" className="icon-btn" style={{ background: 'var(--c-accent-tint)' }} aria-label={t('customers.add')} onClick={() => setAdding(true)}><IconPlus size={22} /></button> : undefined}>
      <div className="sticky top-[52px] z-10 -mx-4 px-4 md:mx-0 md:px-0 pt-1 pb-3 flex flex-col gap-3" style={{ background: 'var(--c-shelf)' }}>
        <div className="search" style={{ height: 40 }}>
          <IconSearch size={18} />
          <input ref={searchRef} type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={LIMITS.search}
            value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('customers.search')} aria-label={t('customers.search')} title={t('stock.searchKey')} />
        </div>
        <div><Segmented label={t('customers.channel')} value={channel} onChange={setChannel} options={[{ value: 'all', label: t('customers.all') }, { value: 'email', label: t('common:channel.email') }, { value: 'push', label: t('common:channel.push') }]} /></div>
      </div>

      {list.data && !items.length ? (
        <Empty icon={<IconPeople size={40} />} title={debounced ? t('customers.noResults') : t('customers.emptyTitle')} body={debounced ? undefined : t('customers.emptyBody')}
          action={!debounced && can('joinlinks.manage', null) ? <Link className="btn btn-tinted" href="/admin/join-links">{t('customers.printQr')}</Link> : undefined} />
      ) : wide ? (
        <>
          <table className="table mb-2">
            <thead>
              <tr>
                <th>{t('customers.col.name')}</th>{showEmail ? <th>{t('join.email')}</th> : null}<th>{t('customer.language')}</th><th>{t('customers.col.follows')}</th><th>{t('customer.channels')}</th><th className="num">{t('customers.col.joined')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} onClick={() => router.push(`/admin/customers/${c.id}`)}>
                  <td>
                    <Link href={`/admin/customers/${c.id}`} className="flex items-center gap-3 hover:no-underline" style={{ color: 'var(--c-ink)' }} onClick={(e) => e.stopPropagation()}>
                      <Avatar name={c.name} size={30} src={c.avatarUrl} /><span>{c.name}</span>
                    </Link>
                    {c.tags.length ? <span className="block mt-1 pl-[42px]">{c.tags.map((tag) => <span key={tag} className="badge badge-gray mr-1">{tag}</span>)}</span> : null}
                  </td>
                  {showEmail ? <td className="t-2">{c.contactMasked ? '' : c.email}</td> : null}
                  <td>{LOCALE_NAMES[c.locale]}</td>
                  <td className="t-2">{scopeName(c)}</td>
                  <td><Channels c={c} /></td>
                  <td className="num t-2">{date(c.createdAt, locale, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <section className="inset-group">
          <ul className="list" role="list">
            {items.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/customers/${c.id}`} className="row has-icon" style={{ '--sep-inset': '64px' } as React.CSSProperties}>
                  <Avatar name={c.name} src={c.avatarUrl} />
                  <span className="row-main">
                    <span className="row-title block">{c.name}</span>
                    <span className="row-sub block truncate">{c.contactMasked || !c.email ? LOCALE_NAMES[c.locale] : `${c.email} · ${LOCALE_NAMES[c.locale]}`}</span>
                    {c.tags.length ? <span className="flex gap-1.5 flex-wrap mt-1">{c.tags.map((tag) => <span key={tag} className="badge badge-gray">{tag}</span>)}</span> : null}
                  </span>
                  <Channels c={c} />
                </Link>
              </li>
            ))}
            {!list.data ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="row"><span className="w-9 h-9 rounded-full skel" /><span className="row-main"><span className="block h-4 w-1/2 skel" /><span className="block h-3 w-2/3 skel mt-2" /></span></li>
            )) : null}
          </ul>
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
  const nameF = useLineField('', { max: 120, required: true, capitalize: 'words' });
  const emailF = useEmailField('', { required: false, autoComplete: 'off' });
  const phoneF = usePhoneField('');
  const name = nameF.text;
  const email = emailF.text;
  const [lang, setLang] = useState<Locale>(org.defaultLocale);
  const [emailNews, setEmailNews] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!checkAll([nameF, emailF, phoneF])) return;
    const nameV = nameF.check()!;
    const emailV = emailF.check() || '';
    const phoneV = phoneF.check() ?? null;
    setBusy(true);
    setError(null);
    try {
      await api.addCustomer(org.orgId, { name: nameV, ...(emailV ? { email: emailV } : {}), ...(phoneV ? { phone: phoneV } : {}), locale: lang, shopId: shop, emailNews: emailNews && !!emailV, push: false, tags: [] });
      toast(t('customers.added', { name: nameV }));
      onAdded();
    } catch (e) {
      const fields = (e as { problem?: { fields?: Record<string, string> } }).problem?.fields ?? {};
      if (fields.name) nameF.setError(fields.name as never);
      if (fields.email) emailF.setError(fields.email as never);
      if (fields.phone) phoneF.setError(fields.phone as never);
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('customers.add')} error={error}
      footer={<>
        <button type="button" className="btn btn-primary btn-large" disabled={busy || !name.trim() || !shop} onClick={() => void save()}>{t('common:action.add')}</button>
        {!name.trim() ? <p className="why-line">{t('customers.needName')}</p> : null}
      </>}>
      <p className="t-sub t-2 mt-0 mb-4">{t('customers.addLead')}</p>
      <FormNav onDone={() => void save()} last="done" className="list mb-4">
        <label className="block"><span className="field-label">{t('join.name')}</span><input className="field pt-1" {...nameF.inputProps} autoComplete="off" /></label>
        <FieldMessage id={nameF.errorId} kind="line" error={nameF.error} params={{ max: 120 }} />
        <label className="block row-sep relative"><span className="field-label">{t('join.email')}</span><input className="field pt-1" {...emailF.inputProps} /></label>
        <FieldMessage id={emailF.errorId} kind="email" error={emailF.error} />
        <label className="block row-sep relative"><span className="field-label">{t('customer.phone')}</span><input className="field pt-1" {...phoneF.inputProps} autoComplete="off" /></label>
        <FieldMessage id={phoneF.errorId} kind="phone" error={phoneF.error} />
      </FormNav>
      <ul className="list mb-4" role="list">
        <li className="row">
          <span className="row-main row-title">{t('stockSheet.shop')}</span>
          <Picker variant="plain" label={t('stockSheet.shop')} value={shop} onChange={setShop} options={allowed.map((s) => ({ value: s.id, label: s.name }))} />
        </li>
        <li className="row">
          <span className="row-main row-title">{t('customer.language')}</span>
          <Picker variant="plain" label={t('customer.language')} value={lang} onChange={setLang} options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))} />
        </li>
        <li className="row">
          <span className="row-main"><span className="row-title block">{t('join.emailNews')}</span><span className="row-sub block">{t('customers.addConsent')}</span></span>
          <Switch checked={emailNews} onChange={setEmailNews} label={t('join.emailNews')} disabled={!email.trim()} />
        </li>
      </ul>
    </Sheet>
  );
}
