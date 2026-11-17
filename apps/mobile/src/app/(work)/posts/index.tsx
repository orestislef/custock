import type { Post } from '@custock/core';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { postText } from '@/lib/posts';
import { useOrg, useSession } from '@/lib/session';
import { Chip, EmptyState, Pill } from '@/ui/Bits';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { radius, usePalette } from '@/ui/theme';

function statusTone(s: Post['status']): 'accent' | 'info' | 'success' | 'few' {
  return s === 'sent' ? 'success' : s === 'pending_approval' ? 'few' : s === 'scheduled' ? 'info' : 'accent';
}

export default function Posts() {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const { can } = useSession();
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState<string | null>(params.status ?? null);
  const res = useQuery({ queryKey: ['posts', org.orgId], queryFn: () => api.posts(org.orgId) });
  const items = (res.data?.items ?? []).filter((x) => !status || x.status === status);
  const canWrite = can('posts.create', null);

  return (
    <>
      <Stack.Screen
        options={{
          title: t('tabs.posts'),
          headerRight: canWrite
            ? () => (
                <Pressable onPress={() => router.push('/compose')} accessibilityRole="button" accessibilityLabel={t('posts.new')} hitSlop={10}>
                  <Text variant="headline" tone="accent">
                    {t('posts.new')}
                  </Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <Screen refreshing={res.isRefetching} onRefresh={() => void res.refetch()}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
          {[null, 'pending_approval', 'scheduled', 'sent', 'draft'].map((s) => (
            <Chip key={s ?? 'all'} label={s ? t(`common:postStatus.${s}`) : t('customers.all')} selected={status === s} onPress={() => setStatus(s)} />
          ))}
        </ScrollView>
        <View style={{ gap: 12, marginHorizontal: 16, marginTop: 16 }}>
          {items.map((post) => {
            const tx = postText(post, i18n.language);
            return (
              <Pressable key={post.id} onPress={() => router.push(`/(work)/posts/${post.id}`)} accessibilityRole="button" style={({ pressed }) => [styles.card, { backgroundColor: p.surface, opacity: pressed ? 0.85 : 1 }]}>
                {post.coverUrl ? <Image source={post.coverUrl} style={styles.cover} contentFit="cover" transition={150} /> : null}
                <View style={{ padding: 14, gap: 6 }}>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    <Pill text={t(`common:postStatus.${post.status}`)} tone={statusTone(post.status)} />
                    <Pill text={t(`common:postKind.${post.kind}`)} tone="info" />
                  </View>
                  <Text variant="headline">{tx.title}</Text>
                  <Text variant="subheadline" tone="ink2" numberOfLines={2}>
                    {tx.body}
                  </Text>
                  <Text variant="footnote" tone="ink2">
                    {[post.authorName, relative(post.sentAt ?? post.scheduledAt ?? post.createdAt, i18n.language), post.recipientsCount ? t('posts.reached', { count: post.recipientsCount }) : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        {!items.length && !res.isLoading ? (
          <EmptyState icon="posts" title={t('posts.emptyTitle')} body={t('posts.emptyBody')} action={canWrite ? t('posts.new') : undefined} onAction={() => router.push('/compose')} />
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.l, overflow: 'hidden' },
  cover: { width: '100%', height: 150 },
});
