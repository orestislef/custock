'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AudiencePreview, Channel, Locale, PostKind, PostInput, Product, ScopeType } from '@custock/core';
import { LOCALES } from '@custock/i18n';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Group, Row, Segmented, Switch, Why } from '@/components/ui/kit';
import { Photo, useToast } from '@/components/ui/client-kit';
import { ProductPicker } from '@/components/admin/product-picker';
import { IconBell, IconMail, IconPlus, IconClose, IconInfo } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { productName } from '@/lib/names';
import { money, number } from '@/lib/format';

const KINDS: PostKind[] = ['news', 'offer', 'new_arrival', 'back_in_stock', 'event'];

interface Line { product: Product; variantId: string; offer: string }

export default function ComposerPage() {
  const { api, org, t, locale, can, shops, settings } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const groups = useAsync(() => api.groups(org.orgId), []);

  const [kind, setKind] = useState<PostKind>('news');
  const [tab, setTab] = useState<Locale>(org.defaultLocale);
  const [texts, setTexts] = useState<Partial<Record<Locale, { title: string; body: string }>>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [scopes, setScopes] = useState<{ scopeType: ScopeType; scopeId: string }[]>(() => {
    const first = shops.find((s) => can('posts.create', s.id));
    return first ? [{ scopeType: 'shop', scopeId: first.id }] : [];
  });
  const [push, setPush] = useState(can('posts.channel.push', null));
  const [email, setEmail] = useState(false);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [until, setUntil] = useState('');
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [busy, setBusy] = useState(false);

  const channels: Channel[] = ['feed', ...(push ? ['push' as const] : []), ...(email ? ['email' as const] : [])];
  const audience = useMemo(() => ({ scopes, tags: [], interests: [], locales: [], savedAnyLinked: false, joinedWithinDays: null }), [scopes]);

  useEffect(() => {
    if (!scopes.length) return;
    const id = setTimeout(() => { void api.previewAudience(org.orgId, audience, channels).then(setPreview).catch(() => setPreview(null)); }, 250);
    return () => clearTimeout(id);
    // channels is derived from push and email
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, push, email]);

  const orgScope = org.orgPerms.includes('posts.create');
  const selectedShopIds = scopes.flatMap((s) => s.scopeType === 'org' ? shops.map((x) => x.id) : s.scopeType === 'group' ? groups.data?.find((g) => g.id === s.scopeId)?.shopIds ?? [] : [s.scopeId]);
  const mayPublish = !settings?.postsNeedApproval && selectedShopIds.length > 0 && selectedShopIds.every((id) => can('posts.publish', id));
  const def = texts[org.defaultLocale];
  const valid = Boolean(def?.title?.trim()) && scopes.length > 0 && (when === 'now' || Boolean(at));

  const toggleScope = (scopeType: ScopeType, scopeId: string) =>
    setScopes((x) => (x.some((s) => s.scopeType === scopeType && s.scopeId === scopeId) ? x.filter((s) => !(s.scopeType === scopeType && s.scopeId === scopeId)) : [...x, { scopeType, scopeId }]));
  const has = (scopeType: ScopeType, scopeId: string) => scopes.some((s) => s.scopeType === scopeType && s.scopeId === scopeId);

  async function save(publish: boolean) {
    setBusy(true);
    try {
      const translations = Object.fromEntries(Object.entries(texts).filter(([, v]) => v?.title?.trim())) as PostInput['translations'];
      const input: PostInput = {
        kind, defaultLocale: org.defaultLocale, translations, channels, audience,
        products: lines.map((l) => ({ variantId: l.variantId, offerPriceMinor: kind === 'offer' && l.offer ? Math.round(Number(l.offer.replace(',', '.')) * 100) : null })),
        coverUrl: lines[0]?.product.images[0]?.url ?? null,
        scheduledAt: when === 'later' && at ? new Date(at).getTime() : null,
        validFrom: kind === 'offer' ? Date.now() : null,
        validUntil: kind === 'offer' && until ? new Date(until).getTime() : null,
      };
      const post = await api.createPost(org.orgId, input);
      if (publish) {
        const done = await api.publishPost(org.orgId, post.id);
        toast(done.status === 'pending_approval' ? t('composer.submitted') : done.status === 'scheduled' ? t('composer.scheduled') : t('composer.published', { count: done.recipientsCount ?? 0 }));
      } else {
        toast(t('composer.savedDraft'));
      }
      router.push(`/admin/posts/${post.id}`);
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
      setBusy(false);
    }
  }

  if (!can('posts.create', null)) {
    return <Page title={t('composer.title')}><Why>{t('common:error.forbidden')}</Why></Page>;
  }

  const cur = texts[tab] ?? { title: '', body: '' };

  return (
    <Page title={t('composer.title')}>
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px] gap-x-8">
        <div>
          <section className="group">
            <h2 className="group-head">{t('composer.kind')}</h2>
            <div className="overflow-x-auto"><Segmented label={t('composer.kind')} value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: t(`common:postKind.${k}`) }))} /></div>
          </section>

          <section className="group">
            <div className="flex items-center gap-3 mb-2 px-1 flex-wrap">
              <Segmented label={t('composer.language')} doneLabel={t('composer.written')} value={tab} onChange={setTab} options={LOCALES.map((l) => ({ value: l, label: l.toUpperCase(), done: Boolean(texts[l]?.title) }))} />
              {scopes.length && preview?.byLocale?.[tab] ? <span className="t-foot t-2">{t('composer.readers', { count: preview.byLocale[tab], lang: tab.toUpperCase() })}</span> : null}
            </div>
            <div className="list">
              <input className="field t-headline" placeholder={t('composer.titlePh')} aria-label={t('composer.titlePh')} value={cur.title}
                onChange={(e) => setTexts((x) => ({ ...x, [tab]: { ...cur, title: e.target.value } }))} />
              <div className="row-sep relative">
                <textarea className="field" rows={5} placeholder={t('composer.bodyPh')} aria-label={t('composer.bodyPh')} value={cur.body}
                  onChange={(e) => setTexts((x) => ({ ...x, [tab]: { ...cur, body: e.target.value } }))} />
              </div>
            </div>
            <p className="group-foot">{tab === org.defaultLocale ? t('composer.defaultLangFoot') : t('composer.otherLangFoot')}</p>
          </section>

          <section className="group">
            <h2 className="group-head">{t('composer.products')}</h2>
            <div className="list">
              {lines.map((l, i) => {
                const v = l.product.variants.find((x) => x.id === l.variantId);
                return (
                  <div key={l.variantId} className="row has-icon" style={{ '--sep-inset': '72px' } as React.CSSProperties}>
                    <Photo src={l.product.images[0]?.url} alt={productName(l.product, locale)} size={44} />
                    <span className="row-main">
                      <span className="row-title block">{productName(l.product, locale)}</span>
                      <span className="row-sub block tnum">{money(v?.priceMinor, org.currency, locale)}</span>
                    </span>
                    {kind === 'offer' ? (
                      can('offers.price.set', null) ? (
                        <input className="t-body tnum text-right bg-transparent border-0 outline-none w-24 rounded-[8px] px-2 py-1" style={{ background: 'var(--c-fill)' }} inputMode="decimal"
                          placeholder={t('composer.offerPrice')} aria-label={t('composer.offerPrice')} value={l.offer}
                          onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, offer: e.target.value } : y)))} />
                      ) : <Why>{t('common:why.youDoNotHave')}</Why>
                    ) : null}
                    <button type="button" className="icon-btn" aria-label={t('common:action.remove')} onClick={() => setLines((x) => x.filter((_, j) => j !== i))}><IconClose size={18} /></button>
                  </div>
                );
              })}
              <button type="button" className="row" onClick={() => setPicker(true)} style={{ color: 'var(--c-accent)' }}>
                <IconPlus size={20} /><span className="row-main row-title">{t('composer.addProduct')}</span>
              </button>
            </div>
            {kind === 'offer' ? <p className="group-foot">{t('composer.wasNote')}</p> : null}
          </section>

          {kind === 'offer' ? (
            <section className="group">
              <div className="list">
                <label className="row">
                  <span className="row-main row-title">{t('composer.until')}</span>
                  <input type="date" className="t-body bg-transparent border-0 outline-none" style={{ color: 'var(--c-ink-2)' }} value={until} onChange={(e) => setUntil(e.target.value)} />
                </label>
              </div>
            </section>
          ) : null}
        </div>

        <div>
          <Group title={t('composer.audience')} footer={t('composer.audienceFoot')}>
            {orgScope ? <ScopeRow label={org.name} sub={t('common:scope.org')} on={has('org', org.orgId)} toggle={() => toggleScope('org', org.orgId)} /> : null}
            {(groups.data ?? []).filter((g) => orgScope || g.shopIds.every((s) => can('posts.create', s))).map((g) => (
              <ScopeRow key={g.id} label={g.name} sub={t('common:scope.group')} on={has('group', g.id)} toggle={() => toggleScope('group', g.id)} />
            ))}
            {shops.map((s) => (
              can('posts.create', s.id)
                ? <ScopeRow key={s.id} label={s.name} sub={t('common:scope.shop')} on={has('shop', s.id)} toggle={() => toggleScope('shop', s.id)} />
                : <Row key={s.id} title={<span className="t-2">{s.name}</span>} subtitle={<Why>{t('common:why.notYourShop')}</Why>} />
            ))}
          </Group>

          <Group title={t('composer.channels')}>
            <Row title={t('common:channel.feed')} subtitle={t('composer.feedSub')} trailing={<Switch checked disabled label={t('common:channel.feed')} />} />
            <Row title={t('common:channel.push')} subtitle={can('posts.channel.push', null) ? undefined : <Why>{t('common:why.hiddenForRole')}</Why>}
              trailing={<Switch checked={push} onChange={setPush} disabled={!can('posts.channel.push', null)} label={t('common:channel.push')} />} />
            <Row title={t('common:channel.email')} subtitle={can('posts.channel.email', null) ? undefined : <Why>{t('common:why.hiddenForRole')}</Why>}
              trailing={<Switch checked={email} onChange={setEmail} disabled={!can('posts.channel.email', null)} label={t('common:channel.email')} />} />
          </Group>

          <section className="group">
            <h2 className="group-head">{t('composer.when')}</h2>
            <div className="px-1 mb-2"><Segmented label={t('composer.when')} value={when} onChange={setWhen} options={[{ value: 'now', label: t('composer.now') }, { value: 'later', label: t('composer.later') }]} /></div>
            {when === 'later' ? (
              <div className="list"><input type="datetime-local" className="field" value={at} onChange={(e) => setAt(e.target.value)} aria-label={t('composer.later')} /></div>
            ) : null}
          </section>

          <AudienceExplainer preview={scopes.length ? preview : null} push={push} email={email} />

          <div className="flex flex-col gap-2 mt-4 mb-8">
            <button type="button" className="btn btn-primary btn-large" disabled={!valid || busy} onClick={() => void save(true)}>
              {mayPublish ? (when === 'later' ? t('composer.schedule') : t('composer.publish')) : t('composer.submit')}
            </button>
            <button type="button" className="btn btn-gray btn-large" disabled={!def?.title?.trim() || busy} onClick={() => void save(false)}>{t('composer.saveDraft')}</button>
            {!mayPublish && scopes.length ? <p className="t-foot t-2 m-0 mt-1 text-center">{t(settings?.postsNeedApproval ? 'composer.approvalOrg' : 'composer.approvalRole')}</p> : null}
            {push ? <p className="t-foot t-2 m-0 text-center">{t('composer.cantRecall')}</p> : null}
          </div>
        </div>
      </div>

      <ProductPicker open={picker} title={t('composer.addProduct')} onClose={() => setPicker(false)} onPick={({ product, variantId }) => {
        if (!lines.some((l) => l.variantId === variantId)) setLines((x) => [...x, { product, variantId, offer: '' }]);
        setPicker(false);
      }} />
    </Page>
  );
}

function ScopeRow({ label, sub, on, toggle }: { label: string; sub: string; on: boolean; toggle: () => void }) {
  return <Row title={label} subtitle={sub} trailing={<Switch checked={on} onChange={toggle} label={label} />} />;
}

function AudienceExplainer({ preview, push, email }: { preview: AudiencePreview | null; push: boolean; email: boolean }) {
  const { t, locale } = useAdmin();
  if (!preview) {
    return <div className="card p-4"><p className="t-sub t-2 m-0">{t('composer.pickAudience')}</p></div>;
  }
  const n = (x: number) => number(x, locale);
  return (
    <div className="card p-4" aria-live="polite">
      <p className="t-title3 m-0 tnum">{t('composer.willSee', { count: preview.total, n: n(preview.total) })}</p>
      <p className="t-sub t-2 m-0 mt-1">{preview.byScope.filter((s) => s.count > 0).map((s) => t('composer.follow', { count: s.count, n: n(s.count), name: s.name })).join(', ')}</p>
      {push ? (
        <div className="flex gap-2 mt-3">
          <IconBell size={18} className="flex-none mt-0.5" style={{ color: 'var(--c-accent)' }} />
          <p className="t-sub m-0">
            {t('composer.pushTo', { n: n(preview.push.count) })}
            {preview.push.turnedOff || preview.push.noApp ? <span className="t-2"> {t('composer.pushNot', { off: n(preview.push.turnedOff), noApp: n(preview.push.noApp) })}</span> : null}
            {preview.push.heldForQuietHours ? <span className="block t-2 mt-1">{t('composer.quietHours')}</span> : <span className="block t-2 mt-1">{t('composer.quietHoursRule')}</span>}
          </p>
        </div>
      ) : null}
      {email ? (
        <div className="flex gap-2 mt-3">
          <IconMail size={18} className="flex-none mt-0.5" style={{ color: 'var(--c-accent)' }} />
          <p className="t-sub m-0">
            {t('composer.emailTo', { n: n(preview.email.count) })}
            {preview.email.unconfirmed ? <span className="t-2"> {t('composer.emailUnconfirmed', { n: n(preview.email.unconfirmed) })}</span> : null}
          </p>
        </div>
      ) : null}
      <p className="t-foot t-2 m-0 mt-3 flex gap-1.5"><IconInfo size={15} className="flex-none mt-px" />{t('composer.capRule')}</p>
    </div>
  );
}

