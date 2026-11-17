// write a post. one thing to write, many places it goes. the audience is explained in words.

import { parseMoney, type Audience, type Channel, type Locale, type PostKind } from '@custock/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

import { api, errorCode } from '@/lib/api';
import { money } from '@/lib/format';
import { useOrg, useSession } from '@/lib/session';
import { Chip, Segmented, WhyNot } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { useSnackbar } from '@/ui/Snackbar';
import { Text } from '@/ui/Text';
import { Toggle } from '@/ui/Toggle';
import { textStyle, usePalette } from '@/ui/theme';

const KINDS: PostKind[] = ['news', 'offer', 'new_arrival', 'event'];
const LOCALES: Locale[] = ['el', 'en', 'ru'];

export default function Compose() {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const { can } = useSession();
  const qc = useQueryClient();
  const snack = useSnackbar();

  const postShops = org.shops.filter((s) => s.perms.includes('posts.create'));
  const wholeOrg = org.shops.length > 1 && postShops.length === org.shops.length;
  const [kind, setKind] = useState<PostKind>('news');
  const [lang, setLang] = useState<Locale>(org.defaultLocale);
  const [texts, setTexts] = useState<Partial<Record<Locale, { title: string; body: string }>>>({});
  const [scopes, setScopes] = useState<string[]>(wholeOrg ? ['org'] : postShops.slice(0, 1).map((s) => s.shopId));
  const [push, setPush] = useState(can('posts.channel.push', null));
  const [email, setEmail] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({}); // variantId -> offer price text
  const [showProducts, setShowProducts] = useState(false);
  const [busy, setBusy] = useState(false);

  const audience: Audience = useMemo(() => ({
    scopes: scopes.map((s) => (s === 'org' ? { scopeType: 'org' as const, scopeId: org.orgId } : { scopeType: 'shop' as const, scopeId: s })),
    tags: [], interests: [], locales: [], savedAnyLinked: false, joinedWithinDays: null,
  }), [scopes, org.orgId]);
  const channels: Channel[] = ['feed', ...(push ? (['push'] as const) : []), ...(email ? (['email'] as const) : [])];
  const preview = useQuery({
    queryKey: ['preview', org.orgId, audience, channels.join()],
    queryFn: () => api.previewAudience(org.orgId, audience, channels),
    enabled: scopes.length > 0,
  });
  const products = useQuery({ queryKey: ['products', org.orgId, 'compose'], queryFn: () => api.products(org.orgId, {}), enabled: showProducts });

  const shopIds = scopes.includes('org') ? org.shops.map((s) => s.shopId) : scopes;
  const canPublish = shopIds.length > 0 && shopIds.every((s) => can('posts.publish', s));
  const def = texts[org.defaultLocale];
  const valid = !!def?.title?.trim() && scopes.length > 0;
  const pv = preview.data;
  const scopeLabel = (id: string) => (id === 'org' ? t('compose.allOf', { org: org.name }) : org.shops.find((s) => s.shopId === id)?.name ?? id);

  async function submit() {
    setBusy(true);
    try {
      const translations = Object.fromEntries(Object.entries(texts).filter(([, v]) => v?.title?.trim())) as Record<Locale, { title: string; body: string }>;
      const created = await api.createPost(org.orgId, {
        kind, defaultLocale: org.defaultLocale, translations, channels, audience,
        products: Object.entries(picked).map(([variantId, price]) => ({ variantId, offerPriceMinor: kind === 'offer' ? parseMoney(price) : null })),
        coverUrl: null, scheduledAt: null, validFrom: kind === 'offer' ? Date.now() : null, validUntil: kind === 'offer' ? Date.now() + 7 * 86_400_000 : null,
      });
      const published = await api.publishPost(org.orgId, created.id);
      void qc.invalidateQueries({ queryKey: ['posts'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      snack({ text: published.status === 'pending_approval' ? t('compose.submitted') : t('compose.published', { count: published.recipientsCount ?? 0 }), icon: 'checkCircle' });
      router.back();
    } catch (e) {
      snack({ text: t(`common:error.${errorCode(e)}`), icon: 'warning' });
    } finally {
      setBusy(false);
    }
  }

  const cur = texts[lang] ?? { title: '', body: '' };
  const field = [textStyle('body'), { color: p.ink, paddingHorizontal: 16, paddingVertical: 12, minHeight: 44 }];

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('compose.title'),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={10}>
              <Text tone="accent">{t('common:action.cancel')}</Text>
            </Pressable>
          ),
        }}
      />
      <Screen keyboardShouldPersistTaps="handled">
        <Section header={t('compose.kind')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 }}>
            {KINDS.map((k) => (
              <Chip key={k} label={t(`common:postKind.${k}`)} selected={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>
        </Section>

        <View style={{ marginHorizontal: 16, marginTop: 24 }}>
          <Segmented value={lang} onChange={setLang} options={LOCALES.map((l) => ({ value: l, label: `${l.toUpperCase()}${pv?.byLocale[l] ? ` · ${pv.byLocale[l]}` : ''}` }))} />
        </View>
        <Section footer={lang === org.defaultLocale ? t('compose.defaultLangFooter') : t('compose.otherLangFooter', { count: pv?.byLocale[lang] ?? 0 })}>
          <TextInput value={cur.title} onChangeText={(s) => setTexts((x) => ({ ...x, [lang]: { ...cur, title: s } }))} placeholder={t('compose.titlePlaceholder')} placeholderTextColor={p.ink3} style={[field, textStyle('headline')]} accessibilityLabel={t('compose.titlePlaceholder')} />
          <TextInput value={cur.body} onChangeText={(s) => setTexts((x) => ({ ...x, [lang]: { ...cur, body: s } }))} placeholder={t('compose.bodyPlaceholder')} placeholderTextColor={p.ink3} multiline style={[field, { minHeight: 110, textAlignVertical: 'top' }]} accessibilityLabel={t('compose.bodyPlaceholder')} />
        </Section>

        <Section header={t('compose.products')} footer={kind === 'offer' ? (can('offers.price.set', null) ? t('compose.offerFooter') : undefined) : undefined}>
          <Row icon="plus" title={showProducts ? t('compose.hideProducts') : t('compose.addProducts', { count: Object.keys(picked).length })} onPress={() => setShowProducts((x) => !x)} chevron={false} />
          {showProducts
            ? (products.data?.items ?? []).slice(0, 14).map((prod) => {
                const v = prod.variants[0]!;
                const on = v.id in picked;
                return (
                  <Row
                    key={prod.id}
                    title={prod.name}
                    subtitle={money(v.priceMinor, org.currency, i18n.language)}
                    trailing={
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {on && kind === 'offer' && can('offers.price.set', null) ? (
                          <TextInput value={picked[v.id]} onChangeText={(s) => setPicked((x) => ({ ...x, [v.id]: s }))} placeholder={t('compose.offerPrice')} placeholderTextColor={p.ink3} keyboardType="decimal-pad" style={[textStyle('subheadline'), { color: p.accent, minWidth: 70, textAlign: 'right' }]} />
                        ) : null}
                        <Icon name={on ? 'checkCircle' : 'plus'} size={20} color={on ? p.accent : p.ink3} />
                      </View>
                    }
                    onPress={() => setPicked((x) => { const n = { ...x }; if (on) delete n[v.id]; else n[v.id] = ''; return n; })}
                    chevron={false}
                  />
                );
              })
            : null}
        </Section>
        {kind === 'offer' && !can('offers.price.set', null) ? (
          <View style={{ marginHorizontal: 32, marginTop: 6 }}>
            <WhyNot text={t('compose.offerPriceLocked')} />
          </View>
        ) : null}

        <Section header={t('compose.audience')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 }}>
            {wholeOrg ? <Chip label={scopeLabel('org')} selected={scopes.includes('org')} onPress={() => setScopes(scopes.includes('org') ? [] : ['org'])} /> : null}
            {org.shops.map((s) => {
              const allowed = s.perms.includes('posts.create');
              return (
                <Chip
                  key={s.shopId}
                  label={s.name}
                  icon={allowed ? undefined : 'lock'}
                  selected={scopes.includes(s.shopId)}
                  onPress={allowed ? () => setScopes((x) => (x.includes(s.shopId) ? x.filter((y) => y !== s.shopId) : [...x.filter((y) => y !== 'org'), s.shopId])) : undefined}
                />
              );
            })}
          </View>
        </Section>

        <Section header={t('compose.channels')}>
          <Row icon="posts" title={t('common:channel.feed')} value={t('compose.always')} />
          <Row icon="bell" title={t('common:channel.push')} trailing={<Toggle value={push} onValueChange={setPush} disabled={!can('posts.channel.push', null)} />} />
          <Row icon="mail" iconTint={p.info} title={t('common:channel.email')} trailing={<Toggle value={email} onValueChange={setEmail} disabled={!can('posts.channel.email', null)} />} />
        </Section>
        {!can('posts.channel.email', null) ? (
          <View style={{ marginHorizontal: 32, marginTop: 6 }}>
            <WhyNot text={t('compose.emailLocked')} />
          </View>
        ) : null}

        {pv ? (
          <Section header={t('compose.whoGetsIt')}>
            <View style={{ padding: 16, gap: 6 }}>
              <Text variant="title3" display>
                {t('compose.preview.total', { count: pv.total })}
              </Text>
              <Text variant="subheadline" tone="ink2">
                {pv.byScope.map((s) => t('compose.preview.scope', { count: s.count, name: s.name })).join(', ')}
              </Text>
              {push ? (
                <Text variant="subheadline">
                  {t('compose.preview.push', { count: pv.push.count })} <Text variant="subheadline" tone="ink2">{t('compose.preview.pushWhy', { off: pv.push.turnedOff, noApp: pv.push.noApp })}</Text>
                </Text>
              ) : null}
              {push ? (
                <Text variant="footnote" tone="ink2">
                  {pv.push.heldForQuietHours ? t('compose.preview.quietNow') : t('compose.preview.quiet')}
                </Text>
              ) : null}
              {email ? (
                <Text variant="subheadline">
                  {t('compose.preview.email', { count: pv.email.count })} <Text variant="subheadline" tone="ink2">{t('compose.preview.emailWhy', { count: pv.email.unconfirmed })}</Text>
                </Text>
              ) : null}
            </View>
          </Section>
        ) : null}

        <View style={{ marginHorizontal: 16, marginTop: 20, gap: 8 }}>
          <Button title={canPublish ? t('compose.publish') : t('compose.submit')} icon={canPublish ? 'send' : 'clock'} onPress={() => void submit()} busy={busy} disabled={!valid} />
          {!canPublish ? <WhyNot icon="info" text={t('compose.approvalWhy')} /> : null}
        </View>
      </Screen>
    </>
  );
}
