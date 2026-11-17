import type { Customer } from '@custock/core';
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { useOrg, useSession } from '@/lib/session';
import { Avatar, Chip, EmptyState, Pill } from '@/ui/Bits';
import { SearchField } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Row } from '@/ui/List';
import { ShopSwitch } from '@/ui/TabStack';
import { Text } from '@/ui/Text';
import { radius, usePalette } from '@/ui/theme';

function ChannelIcons({ c }: { c: Customer }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <Icon name="mail" size={14} color={c.emailOk ? p.success : p.ink3} />
      <Icon name="bell" size={14} color={c.pushOk && c.hasApp ? p.success : p.ink3} />
    </View>
  );
}

export default function Customers() {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const { shopId } = useSession();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setDq(q), 220);
    return () => clearTimeout(id);
  }, [q]);
  const res = useQuery({ queryKey: ['customers', org.orgId, shopId, dq, tag], queryFn: () => api.customers(org.orgId, { q: dq || undefined, shopId: shopId ?? undefined, tag: tag ?? undefined }) });
  const items = res.data?.items ?? [];
  const masked = items[0]?.contactMasked;

  return (
    <>
      <Stack.Screen
        options={{
          title: t('tabs.customers'),
          headerRight: () => <ShopSwitch />,
          headerSearchBarOptions: Platform.OS === 'web' ? undefined : { placeholder: t('customers.search'), onChangeText: (e) => setQ(e.nativeEvent.text), hideWhenScrolling: false, autoCapitalize: 'none' },
        }}
      />
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: p.shelf }}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshing={res.isRefetching}
        onRefresh={() => void res.refetch()}
        ListHeaderComponent={
          <View style={{ gap: 12, paddingVertical: 8 }}>
            {Platform.OS === 'web' ? (
              <View style={{ marginHorizontal: 16 }}>
                <SearchField value={q} onChangeText={setQ} placeholder={t('customers.search')} />
              </View>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
              <Chip label={t('customers.all')} selected={!tag} onPress={() => setTag(null)} />
              {['regulars', 'wholesale'].map((x) => (
                <Chip key={x} label={x} selected={tag === x} onPress={() => setTag(tag === x ? null : x)} />
              ))}
            </ScrollView>
            <Text variant="footnote" tone="ink2" style={{ marginHorizontal: 32 }}>
              {t('customers.count', { count: items.length })}
              {masked ? ` · ${t('customers.maskedNote')}` : ''}
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.line, marginLeft: 68, marginRight: 16 }} />}
        renderItem={({ item, index }) => (
          <View style={[{ marginHorizontal: 16, backgroundColor: p.surface, overflow: 'hidden' }, index === 0 && styles.first, index === items.length - 1 && styles.last]}>
            <Row
              title={item.name ?? item.email ?? ''}
              subtitle={[item.email, relative(item.createdAt, i18n.language)].filter(Boolean).join(' · ')}
              leading={<Avatar name={item.name} />}
              trailing={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <ChannelIcons c={item} />
                  {item.subscriptions.some((s) => s.status === 'pending') ? <Pill text={t('customers.pending')} tone="few" /> : null}
                </View>
              }
              onPress={() => router.push(`/(work)/customers/${item.id}`)}
            />
          </View>
        )}
        ListEmptyComponent={res.isLoading ? undefined : <EmptyState icon="customers" title={t('customers.emptyTitle')} body={t('customers.emptyBody')} />}
      />
    </>
  );
}

const styles = StyleSheet.create({
  first: { borderTopLeftRadius: radius.m, borderTopRightRadius: radius.m },
  last: { borderBottomLeftRadius: radius.m, borderBottomRightRadius: radius.m },
});
