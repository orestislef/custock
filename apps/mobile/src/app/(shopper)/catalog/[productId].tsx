// a product as a customer sees it. availability follows the merchant's settings, per shop.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import { Pill, WhyNot } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { useSnackbar } from '@/ui/Snackbar';
import { StockBadge } from '@/ui/StockBadge';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function CatalogProduct() {
  const { productId, org } = useLocalSearchParams<{ productId: string; org: string }>();
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const qc = useQueryClient();
  const snack = useSnackbar();
  const key = ['publicProduct', org, productId];
  const res = useQuery({ queryKey: key, queryFn: () => api.publicProduct(org, productId) });
  const pp = res.data;
  if (!pp) return <Screen />;
  const lang = i18n.language;
  const shown = pp.availability.some((a) => a.state);
  const allOut = shown && pp.availability.every((a) => a.state === 'out' || a.state === null);

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerLargeTitleEnabled: false,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pp.saved ? t('catalog.unsave') : t('catalog.save')}
              hitSlop={10}
              onPress={() => {
                void api.setFavorite(pp.id, !pp.saved).then(() => qc.invalidateQueries({ queryKey: key }));
              }}
            >
              <Icon name={pp.saved ? 'heart' : 'heartOutline'} size={22} color={p.accent} />
            </Pressable>
          ),
        }}
      />
      <Screen>
        <Image source={pp.images[0]?.url} style={{ height: 300, marginHorizontal: 16, marginTop: 8, borderRadius: 20 }} contentFit="cover" transition={200} accessibilityLabel={pp.name} />
        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 6 }}>
          <Text variant="footnote" tone="accent" weight="600">
            {pp.orgName}
          </Text>
          <Text variant="title1" display>
            {pp.name}
          </Text>
          {pp.offer ? (
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text variant="title2" tone="accent">{money(pp.offer.priceMinor, pp.currency, lang)}</Text>
                {pp.offer.wasMinor ? <Text tone="ink2" style={{ textDecorationLine: 'line-through' }}>{money(pp.offer.wasMinor, pp.currency, lang)}</Text> : null}
              </View>
              <Text variant="footnote" tone="ink2">
                {t('feed.wasNote')}
                {pp.offer.validUntil ? ` · ${t('catalog.offerUntil', { date: date(pp.offer.validUntil, lang, { weekday: 'long', day: 'numeric', month: 'short' }) })}` : ''}
              </Text>
            </View>
          ) : pp.priceMinor !== null ? (
            <Text variant="title2">{money(pp.priceMinor, pp.currency, lang)}</Text>
          ) : (
            <Pill text={t('catalog.askInShop')} tone="info" />
          )}
        </View>

        {shown ? (
          <Section header={t('catalog.availability')} footer={t('common:stock.changesDuringDay')}>
            {pp.availability.map((a) => (
              <Row
                key={a.shopId}
                icon="shop"
                title={a.shopName}
                trailing={a.qty !== null && a.state !== 'out' ? <Text variant="subheadline" tone="ink2">{t('common:stock.qtyInStock', { count: a.qty })}</Text> : a.state && a.state !== 'in' ? <StockBadge state={a.state} /> : a.state === 'in' ? <Text variant="subheadline" tone="ink2">{t('common:stock.in')}</Text> : undefined}
              />
            ))}
          </Section>
        ) : null}

        <View style={{ marginHorizontal: 16, marginTop: 20, gap: 8 }}>
          {pp.waitingForIt ? (
            <WhyNot icon="bell" text={t('catalog.waiting')} />
          ) : allOut || !shown ? (
            <Button
              title={t('catalog.notifyMe')}
              icon="bell"
              kind={allOut ? 'filled' : 'tinted'}
              onPress={() => {
                void api.notifyMe(pp.variantId, null).then(() => {
                  void qc.invalidateQueries({ queryKey: key });
                  snack({ text: t('catalog.notifySet'), icon: 'bell' });
                });
              }}
            />
          ) : null}
        </View>
      </Screen>
    </>
  );
}
