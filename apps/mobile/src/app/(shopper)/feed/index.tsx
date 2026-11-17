import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { EmptyState } from '@/ui/Bits';
import { PostCard } from '@/ui/PostCard';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';

export default function Feed() {
  const { t } = useTranslation('mobile');
  const { me } = useSession();
  const res = useQuery({ queryKey: ['feed'], queryFn: () => api.feed(), enabled: !!me?.following.length });
  const items = res.data?.items ?? [];
  const first = me?.user.displayName?.split(' ')[0] ?? '';
  return (
    <>
      <Stack.Screen options={{ title: t('feed.title') }} />
      <Screen refreshing={res.isRefetching} onRefresh={() => void res.refetch()}>
        {first ? (
          <Text tone="ink2" style={{ marginHorizontal: 20, marginTop: 4 }}>
            {t('feed.hello', { name: first })}
          </Text>
        ) : null}
        <View style={{ gap: 16, marginHorizontal: 16, marginTop: 12 }}>
          {items.map((it) => (
            <PostCard key={it.post.id} item={it} currency="EUR" onPress={() => router.push(`/(shopper)/feed/${it.post.id}`)} />
          ))}
        </View>
        {!items.length && !res.isLoading ? (
          <EmptyState icon="shop" title={t('feed.emptyTitle')} body={t('feed.emptyBody')} action={t('shops.join')} onAction={() => router.push('/(shopper)/shops/join')} />
        ) : null}
      </Screen>
    </>
  );
}
