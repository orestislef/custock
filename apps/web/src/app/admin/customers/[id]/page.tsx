'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdmin } from '@/components/admin/admin-context';
import { Avatar, Group, Row, Why } from '@/components/ui/kit';
import { useToast } from '@/components/ui/client-kit';
import { IconBell, IconChevronLeft, IconHeart, IconMail, IconPhone, IconPlus } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { date, dateTime, relative } from '@/lib/format';
import { LOCALE_NAMES } from '@custock/i18n';

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, locale, can, shops } = useAdmin();
  const toast = useToast();
  const c = useAsync(() => api.customer(org.orgId, id), [id]);
  const groups = useAsync(() => api.groups(org.orgId), []);
  const [note, setNote] = useState('');
  const [tag, setTag] = useState('');
  const editable = can('customers.edit', null);
  const [erasing, setErasing] = useState(false);
  const router = useRouter();

  const d = c.data;
  if (!d) return <div className="pt-6"><div className="h-16 w-16 rounded-full skel mb-4" /><div className="h-8 w-1/2 skel" /></div>;

  const scopeName = (type: string, sid: string) =>
    type === 'org' ? org.name : type === 'group' ? groups.data?.find((g) => g.id === sid)?.name ?? sid : shops.find((s) => s.id === sid)?.name ?? sid;

  async function addNote() {
    if (!note.trim()) return;
    await api.addCustomerNote(org.orgId, id, note.trim());
    setNote('');
    void c.reload();
    toast(t('customer.noteSaved'));
  }

  async function addTag() {
    const v = tag.trim().toLowerCase();
    if (!v || !d) return;
    await api.setCustomerTags(org.orgId, id, [...new Set([...d.tags, v])]);
    setTag('');
    void c.reload();
  }

  async function removeTag(x: string) {
    if (!d) return;
    await api.setCustomerTags(org.orgId, id, d.tags.filter((y) => y !== x));
    void c.reload();
  }

  return (
    <div className="page-in pt-2">
      <Link href="/admin/customers" className="inline-flex items-center min-h-[44px] -ml-2 t-body"><IconChevronLeft size={24} />{t('customers.title')}</Link>
      <div className="flex items-center gap-4 mt-3 mb-8">
        <Avatar name={d.name} size={64} />
        <div className="min-w-0">
          <h1 className="t-title1 m-0">{d.name}</h1>
          <p className="t-sub t-2 m-0 mt-1">{t('customer.since', { date: date(d.createdAt, locale, { day: 'numeric', month: 'long', year: 'numeric' }) })} · {t(`customer.source.${d.source}`)}</p>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-x-6">
        <div>
          <Group title={t('customer.contact')} footer={d.contactMasked ? <Why>{t('customers.maskedWhy')}</Why> : undefined}>
            <Row leading={<span className="icon-tile"><IconMail size={18} /></span>} title={d.email ?? '-'} subtitle={t('common:channel.email')} />
            <Row leading={<span className="icon-tile"><IconPhone size={18} /></span>} title={<span className="tnum">{d.phone ?? '-'}</span>} subtitle={t('customer.phone')} />
            <Row title={t('customer.language')} value={LOCALE_NAMES[d.locale]} />
          </Group>

          <Group title={t('customer.channels')} footer={t('customer.channelsFoot')}>
            {(['email', 'push', 'sms'] as const).map((ch) => {
              const on = ch === 'email' ? d.emailOk : ch === 'push' ? d.pushOk : d.smsOk;
              return <Row key={ch} title={t(`common:channel.${ch}`)} value={<span style={{ color: on ? 'var(--c-success)' : 'var(--c-ink-3)' }}>{on ? t('customer.on') : t('customer.off')}</span>} />;
            })}
          </Group>

          <Group title={t('customer.follows')}>
            {d.subscriptions.map((s) => (
              <Row key={`${s.scopeType}:${s.scopeId}`} title={scopeName(s.scopeType, s.scopeId)} subtitle={t(`common:scope.${s.scopeType}`)} value={t(`customer.sub.${s.status}`)} />
            ))}
          </Group>

          <Group title={t('customer.tags')} footer={editable ? undefined : <Why>{t('common:why.hiddenForRole')}</Why>}>
            <div className="row flex-wrap gap-2">
              {d.tags.length ? d.tags.map((x) => (
                <span key={x} className="badge badge-gray" style={{ fontSize: 15, padding: '4px 10px' }}>
                  {x}
                  {editable ? <button type="button" className="ml-1 border-0 bg-transparent cursor-pointer t-2" aria-label={t('customer.removeTag', { tag: x })} onClick={() => void removeTag(x)}>×</button> : null}
                </span>
              )) : <span className="t-sub t-2">{t('customer.noTags')}</span>}
            </div>
            {editable ? (
              <form className="row-sep relative flex items-center" onSubmit={(e) => { e.preventDefault(); void addTag(); }}>
                <input className="field" value={tag} onChange={(e) => setTag(e.target.value)} placeholder={t('customer.addTag')} aria-label={t('customer.addTag')} />
                <button type="submit" className="icon-btn mr-1" aria-label={t('common:action.add')} disabled={!tag.trim()}><IconPlus size={20} /></button>
              </form>
            ) : null}
          </Group>
        </div>

        <div>
          {d.waitingFor.length ? (
            <Group title={t('customer.waitingFor')} footer={t('customer.waitingFoot')}>
              {d.waitingFor.map((w) => <Row key={w.variantId} leading={<span className="icon-tile"><IconBell size={18} /></span>} title={w.productName} subtitle={w.shopId ? scopeName('shop', w.shopId) : t('customer.anyShop')} />)}
            </Group>
          ) : null}
          {d.favorites.length ? (
            <Group title={t('customer.saved')}>
              {d.favorites.map((f) => <Row key={f.productId} leading={<span className="icon-tile"><IconHeart size={18} /></span>} title={f.productName} href={`/admin/stock/${f.productId}`} />)}
            </Group>
          ) : null}

          <Group title={t('customer.notes')}>
            {d.notes.map((n) => <Row key={n.id} title={n.body} subtitle={`${n.authorName ?? ''} · ${relative(n.createdAt, locale)}`} />)}
            {editable ? (
              <form className={`${d.notes.length ? 'row-sep' : ''} relative`} onSubmit={(e) => { e.preventDefault(); void addNote(); }}>
                <textarea className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('customer.addNote')} aria-label={t('customer.addNote')} rows={2} />
                <div className="flex justify-end px-3 pb-3"><button className="btn btn-tinted" type="submit" disabled={!note.trim()}>{t('common:action.save')}</button></div>
              </form>
            ) : !d.notes.length ? <Row title={<span className="t-2">{t('customer.noNotes')}</span>} /> : null}
          </Group>

          <Group title={t('customer.consents')} footer={t('customer.consentsFoot')}>
            {d.consents.length ? d.consents.map((x, i) => (
              <Row key={i} title={`${t(`common:channel.${x.channel}`)}: ${x.granted ? t('customer.granted') : t('customer.withdrawn')}`} subtitle={`${dateTime(x.createdAt, locale)} · ${x.source} · ${x.textVersion}`} />
            )) : <Row title={<span className="t-2">{t('customer.noConsents')}</span>} />}
          </Group>


          <Group title={t('customer.messages')}>
            {d.deliveries.length ? d.deliveries.map((x, i) => (
              <Row key={i} title={t(`common:channel.${x.channel}`, { defaultValue: x.channel })} subtitle={relative(x.createdAt, locale)} value={t(`customer.delivery.${x.status}`, { defaultValue: x.status })} />
            )) : <Row title={<span className="t-2">{t('customer.noMessages')}</span>} />}
          </Group>
        </div>
      </div>
      {can('customers.erase', null) ? (
        <section className="inset-group max-w-[560px]">
          <h2 className="inset-group-head">{t('customer.privacy')}</h2>
          {erasing ? (
            <div className="card p-4" role="group" aria-label={t('customer.erase')}>
              <p className="t-sub m-0">{t('customer.eraseConsequence', { name: d.name ?? '' })}</p>
              <div className="flex gap-2 mt-4 flex-wrap">
                <button type="button" className="btn btn-danger-fill" onClick={() => void api.eraseCustomer(org.orgId, id).then(() => { toast(t('customer.erased')); router.push('/admin/customers'); }).catch((e: { code?: string }) => toast(t(`common:error.${e.code ?? 'internal'}`)))}>
                  {t('customer.eraseButton', { name: d.name ?? '' })}
                </button>
                <button type="button" className="btn btn-gray" onClick={() => setErasing(false)}>{t('common:action.cancel')}</button>
              </div>
            </div>
          ) : (
            <ul className="list" role="list"><li>
              <button type="button" className="row" style={{ color: 'var(--c-error)' }} onClick={() => setErasing(true)}><span className="row-main row-title">{t('customer.erase')}</span></button>
            </li></ul>
          )}
          <p className="inset-group-foot">{t('customer.eraseFoot')}</p>
        </section>
      ) : null}

    </div>
  );
}
