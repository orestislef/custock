// a post in the customer feed: who, photo, words, products with prices and offers.

import type { FeedItem } from '@custock/core';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { money, relative } from '@/lib/format';
import { postText } from '@/lib/posts';
import { Card, Pill } from './Bits';
import { Text } from './Text';
import { usePalette } from './theme';

export function PostCard({ item, currency, onPress }: { item: FeedItem; currency: string; onPress?: () => void }) {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const { post } = item;
  const tx = postText(post, i18n.language);
  const lang = i18n.language;
  const shops = item.shopNames.length ? item.shopNames.join(', ') : item.orgName;
  return (
    <Card onPress={onPress} label={tx.title}>
      {post.coverUrl ? <Image source={post.coverUrl} style={styles.cover} contentFit="cover" transition={200} accessibilityLabel={tx.title} /> : null}
      <View style={styles.body}>
        <View style={styles.meta}>
          <Text variant="footnote" weight="600" tone="accent" numberOfLines={1} style={{ flexShrink: 1 }}>
            {shops}
          </Text>
          <Text variant="footnote" tone="ink2">
            {relative(post.sentAt ?? post.createdAt, lang)}
          </Text>
        </View>
        {post.kind === 'offer' && post.validUntil ? <Pill icon="clock" tone="few" text={t('feed.endsOn', { date: new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(post.validUntil) })} /> : null}
        <Text variant="title3" display>
          {tx.title}
        </Text>
        <Text tone="ink2">{tx.body}</Text>
        {post.products.length ? (
          <View style={{ gap: 8, marginTop: 4 }}>
            {post.products.map((x) => (
              <View key={x.variantId} style={[styles.product, { backgroundColor: p.shelf }]}>
                {x.imageUrl ? <Image source={x.imageUrl} style={styles.thumb} contentFit="cover" /> : null}
                <Text variant="subheadline" style={{ flex: 1 }} numberOfLines={2}>
                  {x.name}
                </Text>
                <View style={{ alignItems: 'flex-end' }}>
                  {x.offerPriceMinor ? (
                    <>
                      <Text variant="headline" tone="accent">
                        {money(x.offerPriceMinor, currency, lang)}
                      </Text>
                      {x.wasMinor ? (
                        <Text variant="caption1" tone="ink2" style={{ textDecorationLine: 'line-through' }}>
                          {money(x.wasMinor, currency, lang)}
                        </Text>
                      ) : null}
                    </>
                  ) : x.priceMinor !== null ? (
                    <Text variant="headline">{money(x.priceMinor, currency, lang)}</Text>
                  ) : null}
                </View>
              </View>
            ))}
            {post.products.some((x) => x.offerPriceMinor && x.wasMinor) ? (
              <Text variant="caption1" tone="ink2">
                {t('feed.wasNote')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cover: { width: '100%', height: 190 },
  body: { padding: 16, gap: 8 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  product: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12 },
  thumb: { width: 40, height: 40, borderRadius: 8 },
});
