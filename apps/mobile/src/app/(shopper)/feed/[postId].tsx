import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { EmptyState } from '@/ui/Bits';
import { PostCard } from '@/ui/PostCard';
import { Screen } from '@/ui/Screen';

// opened from the feed or from a push. the feed already has it, so no extra request.
export default function FeedPost() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { t } = useTranslation(['mobile', 'common']);
  const res = useQuery({ queryKey: ['feed'], queryFn: () => api.feed() });
  const item = res.data?.items.find((x) => x.post.id === postId);
  return (
    <>
      <Stack.Screen options={{ title: item ? t(`common:postKind.${item.post.kind}`) : '', headerLargeTitleEnabled: false }} />
      <Screen>
        {item ? (
          <View style={{ margin: 16 }}>
            <PostCard item={item} currency="EUR" />
          </View>
        ) : res.isLoading ? null : (
          <EmptyState icon="posts" title={t('feed.goneTitle')} body={t('feed.goneBody')} />
        )}
      </Screen>
    </>
  );
}
