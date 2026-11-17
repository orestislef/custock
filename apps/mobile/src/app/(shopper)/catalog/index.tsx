import type { PublicProduct } from '@custock/core';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { useSession } from '@/lib/session';
import { EmptyState, Pill } from '@/ui/Bits';
import { SearchField } from '@/ui/Field';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { radius, usePalette } from '@/ui/theme';

// the best state across shops, for the grid. the product page shows each shop.
function bestState(pp: PublicProduct): 'in' | 'few' | 'out' | null {
  const states = pp.availability.map((a) => a.state).filter(Boolean);
  if (!states.length) return null;
  if (states.includes('in')) return 'in';
  if (states.includes('few')) return 'few';
  return 'out';
}

function Tile({ pp }: { pp: PublicProduct }) {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const state = bestState(pp);
  return (
    <Pressable onPress={() => router.push({ pathname: '/(shopper)/catalog/[productId]', params: { productId: pp.id, org: pp.orgId } })} accessibilityRole="button" accessibilityLabel={pp.name} style={({ pressed }) => [styles.tile, { backgroundColor: p.surface, opacity: pressed ? 0.85 : 1 }]}>
      <Image source={pp.images[0]?.url} style={styles.img} contentFit="cover" transition={150} />
      <View style={{ padding: 10, gap: 4 }}>
        <Text variant="subheadline" numberOfLines={2} style={{ minHeight: 40 }}>
          {pp.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          {pp.offer ? (
            <>
              <Text variant="headline" tone="accent">{money(pp.offer.priceMinor, pp.currency, i18n.language)}</Text>
              {pp.offer.wasMinor ? <Text variant="caption1" tone="ink2" style={{ textDecorationLine: 'line-through' }}>{money(pp.offer.wasMinor, pp.currency, i18n.language)}</Text> : null}
            </>
          ) : pp.priceMinor !== null ? (
            <Text variant="headline">{money(pp.priceMinor, pp.currency, i18n.language)}</Text>
          ) : null}
        </View>
        {state && state !== 'in' ? <Pill text={t(`common:stock.${state}`)} tone={state === 'few' ? 'few' : 'info'} /> : null}
      </View>
    </Pressable>
  );
}

export default function Catalog() {
  const { t } = useTranslation('mobile');
  const { me } = useSession();
  const org = me?.following[0];
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDq(q), 220);
    return () => clearTimeout(id);
  }, [q]);
  const res = useQuery({ queryKey: ['catalog', org?.orgId, dq], queryFn: () => api.catalog(org!.orgId, { q: dq || undefined }), enabled: !!org });
  const items = res.data ?? [];
  return (
    <>
      <Stack.Screen
        options={{
          title: org?.orgName ?? t('tabs.catalog'),
          headerSearchBarOptions: Platform.OS === 'web' ? undefined : { placeholder: t('catalog.search'), onChangeText: (e) => setQ(e.nativeEvent.text), hideWhenScrolling: false, autoCapitalize: 'none' },
        }}
      />
      <Screen refreshing={res.isRefetching} onRefresh={() => void res.refetch()}>
        {Platform.OS === 'web' ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <SearchField value={q} onChangeText={setQ} placeholder={t('catalog.search')} />
          </View>
        ) : null}
        <View style={styles.grid}>
          {items.map((pp) => (
            <Tile key={pp.id} pp={pp} />
          ))}
        </View>
        {!items.length && !res.isLoading ? (
          org ? <EmptyState icon="shop" title={dq ? t('stock.empty.searchTitle') : t('catalog.offTitle')} body={dq ? t('stock.empty.searchBody', { q: dq }) : t('catalog.offBody', { org: org.orgName })} /> : <EmptyState icon="shop" title={t('feed.emptyTitle')} body={t('feed.emptyBody')} />
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, paddingTop: 12 },
  tile: { width: '47%', flexGrow: 1, borderRadius: radius.l, overflow: 'hidden' },
  img: { width: '100%', aspectRatio: 1 },
});
