'use client';

// one business seen from the platform: its owners and owner invites, its numbers, and what the
// super admin decides for it (features, limits, paused). opening it switches the admin into it.

import { BusinessMark } from '@/components/ui/business-mark';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FEATURES, type Feature, type Locale, type OrgControlsPatch } from '@custock/core';
import { usePlatform } from '@/components/admin/admin-context';
import { BusinessPolicies } from '@/components/platform/business-policies';
import { Page } from '@/components/admin/shell';
import { PlatformShell } from '@/components/platform/platform-shell';
import { LinkActions, bytes } from '@/components/platform/bits';
import { Avatar, Group, Row, Switch } from '@/components/ui/kit';
import { Picker, Sheet, useToast } from '@/components/ui/client-kit';
import { IconChart, IconMail, IconPlus, IconShop } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { date, number, relative } from '@/lib/format';
import { isEmail, normalizeEmail } from '@custock/core';
import { EmailInput } from '@/components/ui/field-kit';

export default function BusinessPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  return (
    <PlatformShell>
      <Business orgId={orgId} />
    </PlatformShell>
  );
}

function Business({ orgId }: { orgId: string }) {
  const { api, t, locale, openOrg } = usePlatform();
  const toast = useToast();
  const b = useAsync(() => api.platformBusiness(orgId), [orgId]);
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ link: string; emailed: boolean; email: string } | null>(null);
  const [pausing, setPausing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [limits, setLimits] = useState<{ shops: string; staff: string }>({ shops: '', staff: '' });
  const d = b.data;

  // the limit fields follow the loaded business, set while rendering when it changes
  const [seen, setSeen] = useState(d);
  if (d !== seen) {
    setSeen(d);
    if (d) setLimits({ shops: d.controls.maxShops?.toString() ?? '', staff: d.controls.maxStaff?.toString() ?? '' });
  }

  const err = (e: unknown) => toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));

  const save = async (patch: OrgControlsPatch, done?: string) => {
    try {
      const controls = await api.setOrgControls(orgId, patch);
      b.setData((cur) => (cur ? { ...cur, controls, status: controls.status, disabledFeatures: controls.disabledFeatures } : cur));
      if (done) toast(done);
    } catch (e) {
      err(e);
    }
  };

  const toggleFeature = (f: Feature, on: boolean) => {
    const off = new Set(d!.controls.disabledFeatures);
    if (on) off.delete(f);
    else off.add(f);
    void save({ disabledFeatures: FEATURES.filter((x) => off.has(x)) });
  };

  const limitValue = (v: string) => (v.trim() === '' ? null : Math.max(1, Math.floor(Number(v))));
  const limitsChanged = d && (limitValue(limits.shops) !== d.controls.maxShops || limitValue(limits.staff) !== d.controls.maxStaff);
  const limitsValid = [limits.shops, limits.staff].every((v) => v.trim() === '' || (Number.isFinite(Number(v)) && Number(v) >= 1));

  const resend = async (id: string, email: string) => {
    try {
      const r = await api.resendOwnerInvite(orgId, id);
      setLink({ link: r.link, emailed: r.emailed, email });
      void b.reload();
    } catch (e) { err(e); }
  };
  const revoke = async (id: string) => {
    try {
      await api.revokeOwnerInvite(orgId, id);
      toast(t('platform.invite.revoked'));
      void b.reload();
    } catch (e) { err(e); }
  };

  if (b.error) return <Page title={t('platform.title')} back={{ href: '/admin/platform', label: t('platform.title') }}><p className="t-sub t-2">{t('common:error.not_found')}</p></Page>;
  if (!d) return <div className="pt-6"><div className="h-64 rounded-[16px] skel" aria-busy="true" /></div>;

  const paused = d.controls.status === 'suspended';
  return (
    <Page title={d.name} back={{ href: '/admin/platform', label: t('platform.title') }}
      subtitle={<span className="inline-flex items-center gap-2 flex-wrap"><BusinessMark logoUrl={d.logoUrl} size={24} tile={false} />/s/{d.slug} · {t('platform.detail.since', { date: date(d.createdAt, locale, { day: 'numeric', month: 'short', year: 'numeric' }) })}{paused ? <span className="badge badge-neg">{t('platform.pausedBadge')}</span> : null}</span>}
      actions={<>
        <button type="button" className="btn btn-gray" onClick={() => openOrg(orgId, '/admin/reports')}><IconChart size={18} />{t('platform.detail.reports')}</button>
        <button type="button" className="btn btn-primary" onClick={() => openOrg(orgId)}>{t('platform.detail.open')}</button>
      </>}
      phoneAction={<button type="button" className="btn btn-primary" onClick={() => openOrg(orgId)}>{t('platform.detail.openShort')}</button>}>

      <div className="grid gap-8 lg:grid-cols-2 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <Group title={t('platform.detail.owners')} footer={!d.owners.length && !d.pendingOwnerInvites.length ? t('platform.detail.noOwnerFoot') : undefined}>
            {d.owners.map((o) => (
              <Row key={o.userId} chevron={false} leading={<Avatar name={o.name ?? o.email} size={32} />} title={o.name ?? o.email ?? ''} subtitle={o.name ? o.email ?? undefined : undefined} />
            ))}
            {d.pendingOwnerInvites.map((i) => (
              <Row key={i.id} chevron={false} leading={<span className="icon-tile"><IconMail size={18} /></span>} title={i.email}
                subtitle={i.expired ? t('platform.invite.expired') : t('platform.invite.sent', { when: relative(i.createdAt, locale) })}
                trailing={<span className="flex gap-1">
                  <button type="button" className="btn btn-plain" onClick={() => void resend(i.id, i.email)}>{t('platform.invite.resend')}</button>
                  <button type="button" className="btn btn-plain" style={{ color: 'var(--c-error)' }} onClick={() => void revoke(i.id)}>{t('platform.invite.revoke')}</button>
                </span>} />
            ))}
            <Row onClick={() => setInviting(true)} chevron={false} leading={<span className="icon-tile"><IconPlus size={18} /></span>} title={<span style={{ color: 'var(--c-accent)' }}>{t('platform.detail.inviteOwner')}</span>} />
          </Group>

          <Group title={t('platform.detail.numbers')}>
            <Row chevron={false} title={t('platform.stat.shops')} value={number(d.counts.shops, locale)} />
            <Row chevron={false} title={t('platform.stat.staff')} value={number(d.counts.staff, locale)} />
            <Row chevron={false} title={t('platform.stat.products')} value={number(d.counts.products, locale)} />
            <Row chevron={false} title={t('platform.stat.customers')} value={number(d.counts.customers, locale)} />
            <Row chevron={false} title={t('platform.storage.photos')} value={bytes(d.storageBytes, locale)} />
          </Group>

          <Group title={t('platform.detail.shops')}>
            {d.shops.map((s) => <Row key={s.id} chevron={false} leading={<span className="icon-tile"><IconShop size={18} /></span>} title={s.name} />)}
          </Group>
        </div>

        <div className="flex flex-col gap-6 min-w-0">
          <Group title={t('platform.features.title')} footer={t('platform.features.foot')}>
            {FEATURES.map((f) => {
              const on = !d.controls.disabledFeatures.includes(f);
              return (
                <Row key={f} chevron={false} title={t(`platform.features.${f}.title`)} subtitle={t(`platform.features.${f}.sub`)}
                  trailing={<Switch label={t(`platform.features.${f}.title`)} checked={on} onChange={(v) => toggleFeature(f, v)} />} />
              );
            })}
          </Group>

          <section className="inset-group">
            <h2 className="inset-group-head">{t('platform.limits.title')}</h2>
            <div className="list">
              <label className="row">
                <span className="row-main row-title">{t('platform.limits.shops', { count: d.controls.shops })}</span>
                <input className="field text-right tnum" style={{ maxWidth: 110 }} inputMode="numeric" placeholder={t('platform.limits.none')} value={limits.shops} pattern="[0-9]*" autoComplete="off" enterKeyHint="next"
                  onChange={(e) => setLimits((l) => ({ ...l, shops: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) }))} aria-label={t('platform.limits.shopsLabel')} />
              </label>
              <label className="row row-sep">
                <span className="row-main row-title">{t('platform.limits.staff', { count: d.controls.staff })}</span>
                <input className="field text-right tnum" style={{ maxWidth: 110 }} inputMode="numeric" placeholder={t('platform.limits.none')} value={limits.staff} pattern="[0-9]*" autoComplete="off" enterKeyHint="done"
                  onChange={(e) => setLimits((l) => ({ ...l, staff: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) }))} aria-label={t('platform.limits.staffLabel')} />
              </label>
            </div>
            <div className="flex items-center gap-3 mt-2 px-4">
              <p className="inset-group-foot m-0 p-0 flex-1">{t('platform.limits.foot')}</p>
              <button type="button" className="btn btn-tinted" disabled={!limitsChanged || !limitsValid}
                onClick={() => void save({ maxShops: limitValue(limits.shops), maxStaff: limitValue(limits.staff) }, t('platform.limits.saved'))}>{t('common:action.save')}</button>
            </div>
          </section>

          <BusinessPolicies orgId={orgId} />

          <section className="inset-group">
            <h2 className="inset-group-head">{t('platform.status.title')}</h2>
            <div className="card p-4 flex flex-col gap-3">
              <p className="t-body m-0">{paused ? t('platform.status.pausedBody') : t('platform.status.activeBody')}</p>
              {paused ? (
                <button type="button" className="btn btn-primary self-start" onClick={() => void save({ status: 'active' }, t('platform.status.resumed'))}>{t('platform.status.resume')}</button>
              ) : (
                <button type="button" className="btn btn-danger self-start" onClick={() => setPausing(true)}>{t('platform.status.pause')}</button>
              )}
            </div>
          </section>

          <section className="inset-group">
            <h2 className="inset-group-head">{t('platform.delete.title')}</h2>
            <div className="card p-4 flex flex-col gap-3">
              <p className="t-body m-0">{t('platform.delete.lead')}</p>
              <button type="button" className="btn btn-danger self-start" onClick={() => setDeleting(true)}>{t('platform.delete.button')}</button>
            </div>
          </section>
        </div>
      </div>

      <DeleteSheet open={deleting} orgId={orgId} name={d.name} slug={d.slug} onClose={() => setDeleting(false)} />

      <OwnerInviteSheet open={inviting} orgId={orgId} name={d.name} onClose={() => setInviting(false)} onDone={(r) => { setLink(r); void b.reload(); }} />

      <Sheet open={pausing} onClose={() => setPausing(false)} title={t('platform.status.pauseTitle', { name: d.name })}
        footer={<>
          <button type="button" className="btn btn-gray" onClick={() => setPausing(false)}>{t('common:action.cancel')}</button>
          <button type="button" className="btn btn-danger-fill" onClick={() => { setPausing(false); void save({ status: 'suspended' }, t('platform.status.pausedToast')); }}>{t('platform.status.pause')}</button>
        </>}>
        <p className="t-body m-0">{t('platform.status.pauseBody')}</p>
      </Sheet>

      <Sheet open={!!link} onClose={() => setLink(null)} title={t('platform.invite.newLink')}
        footer={<button type="button" className="btn btn-primary" onClick={() => setLink(null)}>{t('common:action.done')}</button>}>
        {link ? (
          <div className="flex flex-col gap-4">
            <p className="t-body m-0">{link.emailed ? t('platform.invite.emailed', { email: link.email }) : t('platform.invite.shareIt', { email: link.email })}</p>
            <p className="t-foot t-2 m-0 break-all">{link.link}</p>
            <LinkActions link={link.link} t={t} title={t('platform.new.shareTitle', { name: d.name })} />
          </div>
        ) : null}
      </Sheet>
    </Page>
  );
}

function OwnerInviteSheet({ open, orgId, name, onClose, onDone }: { open: boolean; orgId: string; name: string; onClose: () => void; onDone: (r: { link: string; emailed: boolean; email: string }) => void }) {
  const { api, t, locale } = usePlatform();
  const [email, setEmail] = useState('');
  const [lang, setLang] = useState<Locale>((['en', 'el', 'ru'].includes(locale) ? locale : 'el') as Locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (!open) { setEmail(''); setError(null); setBusy(false); } }
  const valid = isEmail(email);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.inviteOwner(orgId, { email: normalizeEmail(email), locale: lang });
      onClose();
      onDone({ link: r.link, emailed: r.emailed, email: normalizeEmail(email) });
    } catch (e) {
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('platform.detail.inviteOwner')} error={error}
      footer={<>
        <button type="button" className="btn btn-gray" onClick={onClose}>{t('common:action.cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={() => void send()}>{t('platform.detail.sendInvite')}</button>
      </>}>
      <div className="list mb-2">
        <label className="block">
          <span className="field-label">{t('platform.new.ownerEmail')}</span>
          <EmailInput value={email} onChange={setEmail} enterKeyHint="done" />
        </label>
        <div className="row row-sep">
          <span className="row-main row-title">{t('platform.new.language')}</span>
          <Picker label={t('platform.new.language')} value={lang} onChange={(v) => setLang(v as Locale)}
            options={[{ value: 'el', label: 'Ελληνικά' }, { value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }]} />
        </div>
      </div>
      <p className="t-foot t-2 m-0 px-4">{t('platform.detail.inviteFoot', { name })}</p>
    </Sheet>
  );
}

// deleting the whole business: what goes, then the web address typed again
function DeleteSheet({ open, orgId, name, slug, onClose }: { open: boolean; orgId: string; name: string; slug: string; onClose: () => void }) {
  const { api, t } = usePlatform();
  const toast = useToast();
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (!open) { setTyped(''); setError(null); setBusy(false); } }
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteBusiness(orgId, typed.trim());
      toast(t('platform.delete.done', { name }));
      onClose();
      router.replace('/admin/platform');
    } catch (e) {
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('platform.delete.sheetTitle', { name })} error={error}
      footer={<>
        <button type="button" className="btn btn-gray" onClick={onClose}>{t('common:action.cancel')}</button>
        <button type="button" className="btn btn-danger-fill" disabled={busy || typed.trim() !== slug} onClick={() => void go()}>{t('platform.delete.confirm')}</button>
      </>}>
      <p className="t-body m-0 mb-4">{t('platform.delete.body')}</p>
      <div className="list mb-2">
        <label className="block">
          <span className="field-label">{t('platform.delete.type', { slug })}</span>
          <input className="field pt-1" autoCapitalize="none" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" maxLength={60} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={slug} />
        </label>
      </div>
    </Sheet>
  );
}

