import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { EmptyState } from '@/ui/Bits';
import { PostCard } from '@/ui/PostCard';
import { Screen } from '@/ui/Screen';

export default function Offers() {
  const { t } = useTranslation('mobile');
  const { me } = useSession();
  const res = useQuery({ queryKey: ['offers'], queryFn: () => api.offers(), enabled: !!me?.following.length });
  const items = res.data ?? [];
  return (
    <>
      <Stack.Screen options={{ title: t('tabs.offers') }} />
      <Screen refreshing={res.isRefetching} onRefresh={() => void res.refetch()}>
        <View style={{ gap: 16, marginHorizontal: 16, marginTop: 12 }}>
          {items.map((it) => (
            <PostCard key={it.post.id} item={it} currency="EUR" onPress={() => router.push(`/(shopper)/feed/${it.post.id}`)} />
          ))}
        </View>
        {!items.length && !res.isLoading ? <EmptyState icon="offer" title={t('offers.emptyTitle')} body={t('offers.emptyBody')} /> : null}
      </Screen>
    </>
  );
}
