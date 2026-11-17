import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Card, EmptyState } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function Shops() {
  const { t } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const qc = useQueryClient();
  const { me } = useSession();
  const res = useQuery({ queryKey: ['followedShops'], queryFn: () => api.followedShops(), enabled: !!me?.following.length });
  const items = res.data ?? [];

  const unfollow = (shopId: string, name: string) => {
    const go = () => void api.unfollow('shop', shopId).then(() => qc.invalidateQueries());
    if (Platform.OS === 'web') return go();
    Alert.alert(t('shops.unfollowTitle', { name }), t('shops.unfollowBody'), [
      { text: t('common:action.cancel'), style: 'cancel' },
      { text: t('shops.unfollow'), style: 'destructive', onPress: go },
    ]);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: t('tabs.shops'),
          headerRight: () => (
            <Pressable onPress={() => router.push('/(shopper)/shops/join')} accessibilityRole="button" accessibilityLabel={t('shops.join')} hitSlop={10}>
              <Icon name="qr" size={22} color={p.accent} />
            </Pressable>
          ),
        }}
      />
      <Screen refreshing={res.isRefetching} onRefresh={() => void res.refetch()}>
        <View style={{ gap: 16, margin: 16 }}>
          {items.map((s) => (
            <Card key={s.id}>
              {s.imageUrl ? <Image source={s.imageUrl} style={styles.img} contentFit="cover" transition={150} accessibilityLabel={s.name} /> : null}
              <View style={{ padding: 16, gap: 4 }}>
                <Text variant="title3" display>
                  {s.name}
                </Text>
                <Text tone="ink2">{[s.address, s.city].filter(Boolean).join(', ')}</Text>
                <View style={styles.actions}>
                  {s.phone ? <Button title={t('shops.call')} kind="tinted" icon="phone" onPress={() => void Linking.openURL(`tel:${s.phone}`)} style={{ flex: 1 }} /> : null}
                  <Button title={t('shops.directions')} kind="tinted" icon="map" onPress={() => void Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(`${s.address ?? ''} ${s.city ?? ''}`)}`)} style={{ flex: 1 }} />
                </View>
                <Button title={t('shops.unfollow')} kind="plain" onPress={() => unfollow(s.id, s.name)} />
              </View>
            </Card>
          ))}
        </View>
        {!items.length && !res.isLoading ? <EmptyState icon="qr" title={t('feed.emptyTitle')} body={t('feed.emptyBody')} action={t('shops.join')} onAction={() => router.push('/(shopper)/shops/join')} /> : null}
        {items.length ? <Button title={t('shops.join')} kind="tinted" icon="qr" onPress={() => router.push('/(shopper)/shops/join')} style={{ marginHorizontal: 16 }} /> : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  img: { width: '100%', height: 150 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
});
