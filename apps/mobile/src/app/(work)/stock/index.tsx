import type { Product, StockLevel } from '@custock/core';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { api } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { useOrg, useSession } from '@/lib/session';
import { Chip, EmptyState, Pill } from '@/ui/Bits';
import { SearchField } from '@/ui/Field';
import { StockBadge, stockState } from '@/ui/StockBadge';
import { ShopSwitch } from '@/ui/TabStack';
import { Tally } from '@/ui/Tally';
import { Text } from '@/ui/Text';
import { radius, usePalette } from '@/ui/theme';

type Filter = 'all' | 'low' | 'out' | 'negative' | 'waiting';

function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function totals(levels: StockLevel[], shopIds: string[]) {
  const mine = levels.filter((l) => shopIds.includes(l.shopId));
  return {
    onHand: mine.reduce((n, l) => n + l.onHand, 0),
    waiting: Math.max(0, ...mine.map((l) => l.waiting)),
    worst: mine.some((l) => l.onHand < 0) ? -1 : mine.reduce((n, l) => n + l.onHand, 0),
    reorder: mine[0]?.reorderPoint ?? null,
  };
}

function ProductRow({ item, shopIds }: { item: Product & { levels: StockLevel[] }; shopIds: string[] }) {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const tot = totals(item.levels, shopIds);
  const state = stockState(tot.worst, tot.reorder, item.uom === 'kg' ? 1000 : 3);
  const price = item.variants[0]?.priceMinor ?? null;
  return (
    <Pressable
      onPress={() => router.push(`/(work)/stock/${item.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${qty(tot.onHand, item.uom, i18n.language)} ${t(`common:uom.${item.uom}`)}`}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? p.fill : p.surface }]}
    >
      <Image source={item.images[0]?.url} style={[styles.thumb, { backgroundColor: p.fill }]} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={2}>{item.name}</Text>
        <Text variant="footnote" tone="ink2" numberOfLines={1}>
          {[item.categoryName, price !== null ? money(price, org.currency, i18n.language) : null].filter(Boolean).join(' · ')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <StockBadge state={state} />
          {tot.waiting > 0 ? <Pill icon="bell" text={t('common:stock.waiting', { count: tot.waiting })} /> : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Tally value={tot.onHand} format={(n) => qty(n, item.uom, i18n.language)} variant="title3" />
        <Text variant="caption1" tone="ink2">
          {t(`common:uom.${item.uom}`)}
        </Text>
      </View>
    </Pressable>
  );
}

export default function StockList() {
  const { t } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const { shopId } = useSession();
  const params = useLocalSearchParams<{ filter?: Filter }>();
  const [filter, setFilter] = useState<Filter>(params.filter ?? 'all');
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  // a filter from a link (home cards) wins over the last one picked
  const [linkedFilter, setLinkedFilter] = useState(params.filter);
  if (params.filter !== linkedFilter) {
    setLinkedFilter(params.filter);
    if (params.filter) setFilter(params.filter);
  }

  const shopIds = shopId ? [shopId] : org.shops.filter((s) => s.perms.includes('stock.view')).map((s) => s.shopId);
  const res = useQuery({
    queryKey: ['products', org.orgId, shopId, filter, query],
    queryFn: () => api.products(org.orgId, { q: query || undefined, shopId: shopId ?? undefined, filter: filter === 'all' ? undefined : filter }),
  });
  const items = res.data?.items ?? [];
  const filters: Filter[] = ['all', 'low', 'out', 'negative', 'waiting'];

  return (
    <>
      <Stack.Screen
        options={{
          title: t('tabs.stock'),
          headerRight: () => <ShopSwitch />,
          headerSearchBarOptions: Platform.OS === 'web' ? undefined : {
            placeholder: t('stock.searchPlaceholder'),
            onChangeText: (e) => setQ(e.nativeEvent.text),
            hideWhenScrolling: false,
            autoCapitalize: 'none',
          },
        }}
      />
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        style={{ backgroundColor: p.shelf }}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshing={res.isRefetching}
        onRefresh={() => void res.refetch()}
        ListHeaderComponent={
          <View style={{ gap: 12, paddingTop: 8, paddingBottom: 8 }}>
            {Platform.OS === 'web' ? (
              <View style={{ marginHorizontal: 16 }}>
                <SearchField value={q} onChangeText={setQ} placeholder={t('stock.searchPlaceholder')} />
              </View>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
              {filters.map((f) => (
                <Chip key={f} label={t(`stock.filter.${f}`)} selected={filter === f} onPress={() => setFilter(f)} />
              ))}
            </ScrollView>
            <Text variant="footnote" tone="ink2" style={{ marginHorizontal: 32 }}>
              {t('stock.count', { count: items.length })}
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.line, marginLeft: 92, marginRight: 16 }} />}
        renderItem={({ item, index }) => (
          <View style={[{ marginHorizontal: 16, overflow: 'hidden' }, index === 0 && styles.first, index === items.length - 1 && styles.last]}>
            <ProductRow item={item} shopIds={shopIds} />
          </View>
        )}
        ListEmptyComponent={
          res.isLoading ? undefined : (
            <EmptyState
              icon={q ? 'search' : 'stock'}
              title={q ? t('stock.empty.searchTitle') : t('stock.empty.title')}
              body={q ? t('stock.empty.searchBody', { q }) : t('stock.empty.body')}
            />
          )
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 72 },
  thumb: { width: 56, height: 56, borderRadius: 10 },
  first: { borderTopLeftRadius: radius.m, borderTopRightRadius: radius.m },
  last: { borderBottomLeftRadius: radius.m, borderBottomRightRadius: radius.m },
});
