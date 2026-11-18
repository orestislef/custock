'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cleanLine, cleanText, formatMoneyInput, futureProblem, LIMITS, parseMoneyInput, type AudiencePreview, type Channel, type FieldError, type Locale, type PostKind, type PostInput, type Product, type ScopeType } from '@custock/core';
import { LOCALES, LOCALE_NAMES } from '@custock/i18n';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Chips, Group, Row, Segmented, Switch } from '@/components/ui/kit';
import { Photo, useToast } from '@/components/ui/client-kit';
import { ProductPicker } from '@/components/admin/product-picker';
import { IconBell, IconMail, IconPlus, IconClose, IconInfo } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { productName } from '@/lib/names';
import { money, number } from '@/lib/format';
import { RedirectHome } from '@/components/admin/redirect-home';
import { DatePicker, DateTimePicker } from '@/components/ui/date-time-picker';
import { decimalExample } from '@/lib/fields';
import { Counter, FieldMessage } from '@/components/ui/field-kit';

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
  const [offerErrors, setOfferErrors] = useState<Record<string, FieldError>>({});
  const [scopes, setScopes] = useState<{ scopeType: ScopeType; scopeId: string }[]>(() => {
    const first = shops.find((s) => can('posts.create', s.id));
    return first ? [{ scopeType: 'shop', scopeId: first.id }] : [];
  });
  const [push, setPush] = useState(can('posts.channel.push', null));
  const [email, setEmail] = useState(false);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  // both as moments in time, picked in the business's time zone
  const [at, setAt] = useState<number | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const zone = settings?.timezone ?? org.timezone;
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const valid = Boolean(def?.title?.trim()) && scopes.length > 0 && (when === 'now' || at != null);

  const toggleScope = (scopeType: ScopeType, scopeId: string) =>
    setScopes((x) => (x.some((s) => s.scopeType === scopeType && s.scopeId === scopeId) ? x.filter((s) => !(s.scopeType === scopeType && s.scopeId === scopeId)) : [...x, { scopeType, scopeId }]));
  const has = (scopeType: ScopeType, scopeId: string) => scopes.some((s) => s.scopeType === scopeType && s.scopeId === scopeId);

  async function save(publish: boolean) {
    // offer prices with the shared money rules, a wrong one is marked on its line
    const offers: Record<string, number | null> = {};
    const bad: Record<string, FieldError> = {};
    for (const l of lines) {
      if (kind !== 'offer' || !l.offer.trim()) { offers[l.variantId] = null; continue; }
      const r = parseMoneyInput(l.offer);
      if (r.ok) offers[l.variantId] = r.value;
      else bad[l.variantId] = r.error;
    }
    setOfferErrors(bad);
    if (Object.keys(bad).length) return;
    const late = when === 'later' ? futureProblem(at ?? null) : null;
    if (late) { setError(t(`common:field.${late}`)); return; }
    setBusy(true);
    try {
      // titles are one line, bodies keep their inside, both trimmed at the edges
      const translations = Object.fromEntries(Object.entries(texts)
        .map(([k, v]) => [k, v ? { title: cleanLine(v.title ?? ''), body: cleanText(v.body ?? '') } : v])
        .filter(([, v]) => (v as { title?: string } | undefined)?.title)) as PostInput['translations'];
      const input: PostInput = {
        kind, defaultLocale: org.defaultLocale, translations, channels, audience,
        products: lines.map((l) => ({ variantId: l.variantId, offerPriceMinor: offers[l.variantId] ?? null })),
        coverUrl: lines[0]?.product.images[0]?.url ?? null,
        scheduledAt: when === 'later' && at != null ? at : null,
        validFrom: kind === 'offer' ? Date.now() : null,
        validUntil: kind === 'offer' && until != null ? until : null,
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
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
      setBusy(false);
    }
  }

  if (!can('posts.create', null)) return <RedirectHome />;

  const cur = texts[tab] ?? { title: '', body: '' };

  return (
    <Page title={t('composer.title')}>
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px] gap-x-8">
        <div>
          <section className="inset-group">
            <h2 className="inset-group-head">{t('composer.kind')}</h2>
            <Chips label={t('composer.kind')} value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: t(`common:postKind.${k}`) }))} />
          </section>

          <section className="inset-group">
            <div className="flex items-center gap-3 mb-2 px-1 flex-wrap">
              <Segmented label={t('composer.language')} doneLabel={t('composer.written')} value={tab} onChange={setTab} options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l], done: Boolean(texts[l]?.title) }))} />
              {scopes.length && preview?.byLocale?.[tab] ? <span className="t-foot t-2">{t('composer.readersOf', { count: preview.byLocale[tab], lang: LOCALE_NAMES[tab] })}</span> : null}
            </div>
            <div className="list">
              <input className="field t-headline" placeholder={t('composer.titlePh')} aria-label={t('composer.titlePh')} value={cur.title}
                maxLength={LIMITS.postTitle} autoCapitalize="sentences" autoComplete="off" enterKeyHint="next"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); (e.currentTarget.parentElement?.querySelector('textarea') as HTMLTextAreaElement | null)?.focus(); } }}
                onBlur={() => setTexts((x) => ({ ...x, [tab]: { ...cur, title: cleanLine(cur.title) } }))}
                onChange={(e) => setTexts((x) => ({ ...x, [tab]: { ...cur, title: e.target.value } }))} />
              <Counter value={cur.title} max={LIMITS.postTitle} />
              <div className="row-sep relative">
                <textarea className="field" rows={5} placeholder={t('composer.bodyPh')} aria-label={t('composer.bodyPh')} value={cur.body}
                  maxLength={LIMITS.postBody} autoCapitalize="sentences"
                  onBlur={() => setTexts((x) => ({ ...x, [tab]: { ...cur, body: cleanText(cur.body) } }))}
                  onChange={(e) => setTexts((x) => ({ ...x, [tab]: { ...cur, body: e.target.value } }))} />
                <Counter value={cur.body} max={LIMITS.postBody} />
              </div>
            </div>
            <p className="inset-group-foot">{tab === org.defaultLocale ? t('composer.defaultLangFoot') : t('composer.otherLangFoot')}</p>
          </section>

          <section className="inset-group">
            <h2 className="inset-group-head">{t('composer.products')}</h2>
            <div className="list">
              {lines.map((l, i) => {
                const v = l.product.variants.find((x) => x.id === l.variantId);
                return (
                  <Fragment key={l.variantId}>
                  <div className="row has-icon" style={{ '--sep-inset': '72px' } as React.CSSProperties}>
                    <Photo src={l.product.images[0]?.url} alt={productName(l.product, locale)} size={44} />
                    <span className="row-main">
                      <span className="row-title block">{productName(l.product, locale)}</span>
                      <span className="row-sub block tnum">{money(v?.priceMinor, org.currency, locale)}</span>
                    </span>
                    {kind === 'offer' ? (
                      can('offers.price.set', null) ? (
                        <input className="t-body tnum text-right bg-transparent border-0 outline-none w-24 rounded-[8px] px-2 py-1" style={{ background: 'var(--c-fill)' }} inputMode="decimal"
                          placeholder={t('composer.offerPrice')} aria-label={t('composer.offerPrice')} value={l.offer}
                          autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done"
                          aria-invalid={offerErrors[l.variantId] ? true : undefined} aria-describedby={offerErrors[l.variantId] ? `offer-${l.variantId}` : undefined}
                          onBlur={() => {
                            if (!l.offer.trim()) return;
                            const r = parseMoneyInput(l.offer);
                            setOfferErrors((x) => { const n = { ...x }; if (r.ok) delete n[l.variantId]; else n[l.variantId] = r.error; return n; });
                            if (r.ok) setLines((x) => x.map((y, j) => (j === i ? { ...y, offer: formatMoneyInput(r.value, locale) } : y)));
                          }}
                          onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, offer: e.target.value } : y)))} />
                      ) : null
                    ) : null}
                    <button type="button" className="icon-btn" aria-label={t('common:action.remove')} onClick={() => setLines((x) => x.filter((_, j) => j !== i))}><IconClose size={18} /></button>
                  </div>
                  <FieldMessage id={`offer-${l.variantId}`} kind="money" error={offerErrors[l.variantId]} params={{ example: decimalExample(locale) }} />
                  </Fragment>
                );
              })}
              <button type="button" className="row" onClick={() => setPicker(true)} style={{ color: 'var(--c-accent)' }}>
                <IconPlus size={20} /><span className="row-main row-title">{t('composer.addProduct')}</span>
              </button>
            </div>
            {kind === 'offer' ? <p className="inset-group-foot">{t('composer.wasNote')}</p> : null}
          </section>

          {kind === 'offer' ? (
            <section className="inset-group">
              <div className="list">
                <DatePicker variant="row" label={t('composer.until')} value={until} onChange={setUntil} timeZone={zone} dayEdge="end" future optional placeholder={t('composer.untilNone')} />
              </div>
            </section>
          ) : null}
        </div>

        <div>
          <Group title={t('composer.audience')}>
            {orgScope ? <ScopeRow label={org.name} sub={t('common:scope.org')} on={has('org', org.orgId)} toggle={() => toggleScope('org', org.orgId)} /> : null}
            {(groups.data ?? []).filter((g) => orgScope || g.shopIds.every((s) => can('posts.create', s))).map((g) => (
              <ScopeRow key={g.id} label={g.name} sub={t('common:scope.group')} on={has('group', g.id)} toggle={() => toggleScope('group', g.id)} />
            ))}
            {shops.filter((s) => can('posts.create', s.id)).map((s) => (
              <ScopeRow key={s.id} label={s.name} sub={t('common:scope.shop')} on={has('shop', s.id)} toggle={() => toggleScope('shop', s.id)} />
            ))}
          </Group>

          <Group title={t('composer.channels')}>
            <Row title={t('common:channel.feed')} subtitle={t('composer.feedSub')} trailing={<Switch checked disabled label={t('common:channel.feed')} />} />
            {can('posts.channel.push', null) ? <Row title={t('common:channel.push')} trailing={<Switch checked={push} onChange={setPush} label={t('common:channel.push')} />} /> : null}
            {can('posts.channel.email', null) ? <Row title={t('common:channel.email')} trailing={<Switch checked={email} onChange={setEmail} label={t('common:channel.email')} />} /> : null}
          </Group>

          <section className="inset-group">
            <h2 className="inset-group-head">{t('composer.when')}</h2>
            <div className="px-1 mb-2"><Segmented label={t('composer.when')} value={when} onChange={setWhen} options={[{ value: 'now', label: t('composer.now') }, { value: 'later', label: t('composer.later') }]} /></div>
            {when === 'later' ? (
              <div className="list"><DateTimePicker label={t('composer.later')} value={at} onChange={setAt} timeZone={zone} future quickPicks /></div>
            ) : null}
          </section>

          <AudienceExplainer preview={scopes.length ? preview : null} push={push} email={email} />

          <div className="flex flex-col gap-2 mt-4 mb-8">
            {error ? <p className="sheet-error" role="alert">{error}</p> : null}
            <button type="button" className="btn btn-primary btn-large" disabled={!valid || busy} onClick={() => void save(true)}>
              {mayPublish ? (when === 'later' ? t('composer.schedule') : t('composer.publish')) : t('composer.submit')}
            </button>
            {!valid ? <p className="why-line m-0">{!def?.title?.trim() ? t('composer.needTitle', { lang: LOCALE_NAMES[org.defaultLocale] }) : !scopes.length ? t('composer.needAudience') : t('composer.needTime')}</p> : null}
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
          <IconBell size={18} className="flex-none mt-0.5" style={{ color: 'var(--c-ink-2)' }} />
          <p className="t-sub m-0">
            {t('composer.pushTo', { n: n(preview.push.count) })}
            {preview.push.turnedOff || preview.push.noApp ? <span className="t-2"> {t('composer.pushNot', { off: n(preview.push.turnedOff), noApp: n(preview.push.noApp) })}</span> : null}
            {preview.push.heldForQuietHours ? <span className="block t-2 mt-1">{t('composer.quietHours')}</span> : <span className="block t-2 mt-1">{t('composer.quietHoursRule')}</span>}
          </p>
        </div>
      ) : null}
      {email ? (
        <div className="flex gap-2 mt-3">
          <IconMail size={18} className="flex-none mt-0.5" style={{ color: 'var(--c-ink-2)' }} />
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

