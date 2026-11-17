// reports summary for the phone. money only with reports.financial.view.
// charts are simple bars drawn with views: one categorical color, direct labels, no color-only meaning.

import { chart } from '@custock/tokens';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { api } from '@/lib/api';
import { date, money, num } from '@/lib/format';
import { useOrg, useSession } from '@/lib/session';
import { WhyNot } from '@/ui/Bits';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { ShopSwitch } from '@/ui/TabStack';
import { Text } from '@/ui/Text';
import { radius, usePalette } from '@/ui/theme';

export default function Reports() {
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const { shopId, can } = useSession();
  const lang = i18n.language;
  const shop = shopId ?? undefined;
  const sales = useQuery({ queryKey: ['sales', org.orgId, shopId], queryFn: () => api.salesSeries(org.orgId, shop, 14) });
  const top = useQuery({ queryKey: ['top', org.orgId, shopId], queryFn: () => api.topSellers(org.orgId, shop, 30) });
  const wanted = useQuery({ queryKey: ['wanted', org.orgId, shopId], queryFn: () => api.mostWanted(org.orgId, shop) });
  const links = useQuery({ queryKey: ['links', org.orgId], queryFn: () => api.joinLinkStats(org.orgId) });
  const shrink = useQuery({ queryKey: ['shrink', org.orgId, shopId], queryFn: () => api.shrinkage(org.orgId, shop, 30) });
  const showMoney = can('reports.financial.view', null);
  const series = sales.data ?? [];
  const max = Math.max(1, ...series.map((s) => s.value));
  const best = series.reduce((b, s) => (s.value > (b?.value ?? 0) ? s : b), series[0]);

  return (
    <>
      <Stack.Screen options={{ title: t('more.reports'), headerRight: () => <ShopSwitch /> }} />
      <Screen>
        <Section header={t('reports.sales14')} footer={showMoney && best ? t('reports.bestDay', { day: date(Date.parse(best.day), lang, { weekday: 'long', day: 'numeric', month: 'short' }), value: money(best.value, org.currency, lang) }) : undefined}>
          {showMoney ? (
            <View style={styles.chart} accessible accessibilityLabel={t('reports.sales14')}>
              {series.map((s) => (
                <View key={s.day} style={styles.barCol}>
                  <View style={[styles.bar, { height: `${(s.value / max) * 100}%`, backgroundColor: s === best ? chart[0] : p.accentTint }]} />
                  <Text variant="caption2" tone="ink2">
                    {new Date(s.day).getDate()}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={{ padding: 16 }}>
              <WhyNot icon="hidden" text={t('reports.moneyHidden')} />
            </View>
          )}
        </Section>

        <Section header={t('reports.mostWanted')} footer={t('reports.mostWantedFooter')}>
          {(wanted.data ?? []).map((w) => (
            <Row key={w.variantId} icon="bell" title={w.name} subtitle={t('common:stock.waiting', { count: w.waiting })} value={w.onHand <= 0 ? t('common:stock.out') : num(w.onHand, lang)} />
          ))}
        </Section>

        <Section header={t('reports.topSellers')}>
          {(top.data ?? []).map((x, i) => (
            <Row key={x.variantId} title={`${i + 1}. ${x.name}`} value={x.valueMinor !== null ? money(x.valueMinor, org.currency, lang) : `${num(x.qty, lang)} ${t('common:uom.piece')}`} subtitle={x.valueMinor !== null ? `${num(x.qty, lang)} ${t('common:uom.piece')}` : undefined} />
          ))}
        </Section>

        <Section header={t('reports.joinLinks')} footer={t('reports.joinLinksFooter')}>
          {(links.data ?? []).map((l) => (
            <Row key={l.joinLinkId} icon="qr" iconTint="#1F8A8A" title={l.label ?? ''} subtitle={t('reports.linkLine', { opens: l.opens, signups: l.signups })} value={`${Math.round((l.signups / Math.max(1, l.opens)) * 100)}%`} />
          ))}
        </Section>

        <Section header={t('reports.shrinkage')}>
          {(shrink.data ?? []).map((s) => (
            <Row key={s.reason} title={t(`common:reason.${s.reason}`)} value={s.valueMinor !== null ? money(s.valueMinor, org.currency, lang) : `${s.qty}`} subtitle={s.valueMinor !== null ? `${s.qty} ${t('common:uom.piece')}` : undefined} />
          ))}
        </Section>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  chart: { height: 160, flexDirection: 'row', alignItems: 'flex-end', gap: 4, padding: 14 },
  barCol: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  bar: { width: '100%', borderRadius: radius.s / 2, minHeight: 4 },
});
