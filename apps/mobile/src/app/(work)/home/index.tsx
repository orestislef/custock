import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useOrg, useSession } from '@/lib/session';
import { Tip, useTip } from '@/ui/Bits';
import { Icon, type IconName } from '@/ui/Icon';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { ShopSwitch } from '@/ui/TabStack';
import { Tally } from '@/ui/Tally';
import { Text } from '@/ui/Text';
import { radius, usePalette } from '@/ui/theme';

function greeting(h: number): 'morning' | 'afternoon' | 'evening' {
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

function Stat({ label, value, icon, tone, onPress, format }: { label: string; value: number; icon: IconName; tone?: string; onPress?: () => void; format?: (n: number) => string }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'summary'}
      accessibilityLabel={`${label}: ${format ? format(value) : value}`}
      style={({ pressed }) => [styles.stat, { backgroundColor: p.surface, opacity: pressed ? 0.8 : 1 }]}
    >
      <Icon name={icon} size={18} color={tone ?? p.ink2} />
      <Tally value={value} format={format} variant="title1" />
      <Text variant="footnote" tone="ink2" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function Home() {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const { me, shopId, can } = useSession();
  const [tipOpen, closeTip] = useTip();
  const [today] = useState(() => Date.now());
  const q = useQuery({ queryKey: ['dashboard', org.orgId, shopId], queryFn: () => api.dashboard(org.orgId, shopId ?? undefined) });
  const d = q.data;
  const first = me?.user.displayName?.split(' ')[0] ?? '';
  const staffLike = !can('stock.adjust', null) && (can('stock.sell', null) || can('stock.receive', null));
  const fmtMoney = (n: number) => money(n, org.currency, i18n.language);

  const modes = [
    { mode: 'sell', perm: 'stock.sell', icon: 'sell' as const },
    { mode: 'receive', perm: 'stock.receive', icon: 'receive' as const },
    { mode: 'count', perm: 'stock.count', icon: 'count' as const },
  ].filter((m) => can(m.perm, null));

  return (
    <>
      <Stack.Screen options={{ title: staffLike ? t('tabs.today') : org.name, headerRight: () => <ShopSwitch /> }} />
      <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
        <View style={styles.greeting}>
          <Text variant="title3" display>
            {t(`home.greeting.${greeting(new Date(today).getHours())}`, { name: first })}
          </Text>
          <Text tone="ink2">{date(today, i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
        </View>

        {modes.length ? (
          <View style={styles.modes}>
            {modes.map((m) => (
              <Pressable
                key={m.mode}
                onPress={() => router.push({ pathname: '/(work)/scan', params: { mode: m.mode } })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.mode, { backgroundColor: p.accentFill, opacity: pressed ? 0.85 : 1 }]}
              >
                <Icon name={m.icon} size={24} color={p.onAccent} />
                <Text variant="headline" style={{ color: p.onAccent }}>
                  {t(`scan.mode.${m.mode}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {tipOpen && staffLike ? <Tip text={t('home.tipUndo')} onClose={closeTip} closeLabel={t('common:action.close')} /> : null}

        {d ? (
          <View style={styles.grid}>
            <Stat label={t('home.cards.lowStock')} value={d.lowStock} icon="few" tone={p.fewText} onPress={() => router.push({ pathname: '/(work)/stock', params: { filter: 'low' } })} />
            <Stat label={t('home.cards.outOfStock')} value={d.outOfStock} icon="out" onPress={() => router.push({ pathname: '/(work)/stock', params: { filter: 'out' } })} />
            <Stat label={t('home.cards.peopleWaiting')} value={d.peopleWaiting} icon="bell" tone={p.accent} onPress={() => router.push({ pathname: '/(work)/stock', params: { filter: 'waiting' } })} />
            {can('customers.view', null) ? <Stat label={t('home.cards.newFollowers')} value={d.newFollowersWeek} icon="customers" tone={p.info} onPress={() => router.push('/(work)/customers')} /> : null}
            {d.stockValueCostMinor !== null ? <Stat label={t('home.cards.stockValue')} value={Math.round(d.stockValueCostMinor / 100) * 100} icon="chart" format={fmtMoney} /> : null}
            {d.salesTodayMinor !== null ? <Stat label={t('home.cards.salesToday')} value={d.salesTodayMinor} icon="bag" format={fmtMoney} /> : null}
          </View>
        ) : null}

        {d ? (
          <Section header={t('home.needsYou')} footer={t('home.needsYouFooter')}>
            {d.pendingApprovals > 0 ? <Row icon="posts" title={t('home.needs.approvals', { count: d.pendingApprovals })} onPress={() => router.push({ pathname: '/(work)/posts', params: { status: 'pending_approval' } })} /> : null}
            {d.negativeStock > 0 ? <Row icon="warning" iconTint={p.negText} title={t('home.needs.negative', { count: d.negativeStock })} onPress={() => router.push({ pathname: '/(work)/stock', params: { filter: 'negative' } })} /> : null}
            {d.unknownCodes > 0 ? <Row icon="barcode" iconTint={p.ink2} title={t('home.needs.unknownCodes', { count: d.unknownCodes })} subtitle={t('home.needs.unknownCodesSub')} /> : null}
            {d.transfersOnTheWay > 0 ? <Row icon="truck" iconTint={p.info} title={t('home.needs.transfers', { count: d.transfersOnTheWay })} /> : null}
            {d.scheduledPosts > 0 && can('posts.view', null) ? <Row icon="clock" iconTint={p.ink2} title={t('home.needs.scheduled', { count: d.scheduledPosts })} onPress={() => router.push('/(work)/posts')} /> : null}
            {d.pendingApprovals + d.negativeStock + d.unknownCodes + d.transfersOnTheWay + d.scheduledPosts === 0 ? <Row icon="checkCircle" iconTint={p.success} title={t('home.needs.nothing')} /> : null}
          </Section>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  greeting: { paddingHorizontal: 20, paddingTop: 8, gap: 2 },
  modes: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 16 },
  mode: { flex: 1, minHeight: 84, borderRadius: radius.l, padding: 14, justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginHorizontal: 16, marginTop: 16 },
  stat: { flexBasis: '47%', flexGrow: 1, borderRadius: radius.l, padding: 14, gap: 6, minHeight: 112 },
});
