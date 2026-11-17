import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { postText } from '@/lib/posts';
import { useOrg, useSession } from '@/lib/session';
import { Pill, WhyNot } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { useSnackbar } from '@/ui/Snackbar';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function PostDetail() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const { can } = useSession();
  const qc = useQueryClient();
  const snack = useSnackbar();
  const res = useQuery({ queryKey: ['post', org.orgId, postId], queryFn: () => api.post(org.orgId, postId) });
  const post = res.data;
  if (!post) return <Screen />;
  const tx = postText(post, i18n.language);
  const lang = i18n.language;
  const canApprove = post.status === 'pending_approval' && can('posts.publish', null);

  return (
    <>
      <Stack.Screen options={{ title: t(`common:postKind.${post.kind}`), headerLargeTitleEnabled: false }} />
      <Screen>
        {post.coverUrl ? <Image source={post.coverUrl} style={{ height: 200, marginHorizontal: 16, marginTop: 12, borderRadius: 16 }} contentFit="cover" /> : null}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 8 }}>
          <Pill text={t(`common:postStatus.${post.status}`)} />
          <Text variant="title2" display>
            {tx.title}
          </Text>
          <Text>{tx.body}</Text>
        </View>

        {post.products.length ? (
          <Section header={t('posts.products')} footer={post.kind === 'offer' ? t('posts.wasFooter') : undefined}>
            {post.products.map((x) => (
              <Row
                key={x.variantId}
                title={x.name}
                subtitle={x.offerPriceMinor && x.wasMinor ? t('posts.was', { price: money(x.wasMinor, org.currency, lang) }) : undefined}
                value={money(x.offerPriceMinor ?? x.priceMinor, org.currency, lang)}
              />
            ))}
          </Section>
        ) : null}

        <Section header={t('posts.delivery')}>
          <Row icon="send" iconTint={p.info} title={t('posts.channels')} value={post.channels.map((c) => t(`common:channel.${c}`)).join(', ')} />
          {post.sentAt ? <Row icon="clock" iconTint={p.ink2} title={t('posts.sentAt')} value={dateTime(post.sentAt, lang)} /> : null}
          {post.scheduledAt && !post.sentAt ? <Row icon="clock" iconTint={p.ink2} title={t('posts.scheduledFor')} value={dateTime(post.scheduledAt, lang)} /> : null}
          {post.validUntil ? <Row icon="offer" title={t('posts.validUntil')} value={dateTime(post.validUntil, lang)} /> : null}
          {post.stats ? (
            <>
              <Row icon="checkCircle" iconTint={p.success} title={t('posts.stats.sent')} value={String(post.stats.sent)} />
              <Row icon="person" iconTint={p.info} title={t('posts.stats.opened')} value={String(post.stats.opened)} />
              <Row icon="info" iconTint={p.ink2} title={t('posts.stats.skipped')} value={String(post.stats.skipped)} subtitle={t('posts.stats.skippedWhy')} />
            </>
          ) : null}
          <Row icon="person" iconTint={p.ink2} title={t('posts.author')} value={post.authorName ?? ''} />
        </Section>

        {post.status === 'pending_approval' ? (
          <View style={{ marginHorizontal: 16, marginTop: 16, gap: 8 }}>
            {canApprove ? (
              <Button
                title={t('posts.approve')}
                icon="check"
                onPress={() => {
                  void api.approvePost(org.orgId, post.id).then(() => {
                    void qc.invalidateQueries({ queryKey: ['posts'] });
                    void qc.invalidateQueries({ queryKey: ['post', org.orgId, postId] });
                    snack({ text: t('posts.approved'), icon: 'checkCircle' });
                  });
                }}
              />
            ) : (
              <WhyNot icon="clock" text={t('posts.waitingApproval')} />
            )}
          </View>
        ) : null}
        {post.status === 'sent' ? (
          <View style={{ marginHorizontal: 32, marginTop: 10 }}>
            <WhyNot icon="info" text={t('posts.cannotRecall')} />
          </View>
        ) : null}
      </Screen>
    </>
  );
}
