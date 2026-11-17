import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { api } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { useOrg, useSession } from '@/lib/session';
import { Pill, WhyNot } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { StockBadge, stockState } from '@/ui/StockBadge';
import { Tally } from '@/ui/Tally';
import { Text } from '@/ui/Text';
import { radius, usePalette } from '@/ui/theme';

// prices include vat, costs do not
function marginPct(grossMinor: number, costMinor: number, vatBp: number): number {
  const net = grossMinor / (1 + vatBp / 10000);
  return Math.round(((net - costMinor) / net) * 100);
}

export default function ProductDetail() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const { can, shopId } = useSession();
  const res = useQuery({ queryKey: ['product', org.orgId, productId], queryFn: () => api.product(org.orgId, productId) });
  const prod = res.data;
  const lang = i18n.language;

  if (!prod) {
    return (
      <>
        <Stack.Screen options={{ title: '', headerLargeTitleEnabled: false }} />
        <Screen />
      </>
    );
  }

  const v = prod.variants[0]!;
  const visibleShops = org.shops.filter((s) => s.perms.includes('stock.view'));
  const workShop = shopId ?? visibleShops[0]?.shopId ?? null;
  const fmtQty = (n: number) => qty(n, prod.uom, lang);
  const showHistory = can('stock.history.view', workShop);
  const canAdjust = can('stock.adjust', workShop);
  const canReceive = can('stock.receive', workShop);

  return (
    <>
      <Stack.Screen options={{ title: '', headerLargeTitleEnabled: false }} />
      <Screen>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}>
          {prod.images.map((img) => (
            <Image key={img.id} source={img.url} style={[styles.photo, { backgroundColor: p.fill }]} contentFit="cover" transition={200} accessibilityLabel={prod.name} />
          ))}
        </ScrollView>

        <View style={styles.head}>
          <Text variant="title1" display>
            {prod.name}
          </Text>
          <Text tone="ink2">{[prod.categoryName, v.barcodes[0]?.code].filter(Boolean).join(' · ')}</Text>
        </View>

        <Section header={t('product.stockPerShop')} footer={t('common:stock.changesDuringDay')}>
          {visibleShops.map((s) => {
            const lv = prod.levels.filter((l) => l.shopId === s.shopId && prod.variants.some((x) => x.id === l.variantId));
            const onHand = lv.reduce((n, l) => n + l.onHand, 0);
            const waiting = Math.max(0, ...lv.map((l) => l.waiting));
            const state = stockState(onHand, lv[0]?.reorderPoint ?? null, prod.uom === 'kg' ? 1000 : 3);
            return (
              <Row
                key={s.shopId}
                title={s.name}
                leading={null}
                trailing={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Tally value={onHand} format={fmtQty} variant="title3" />
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <StockBadge state={state} />
                      {waiting > 0 ? <Pill icon="bell" text={t('common:stock.waiting', { count: waiting })} /> : null}
                    </View>
                  </View>
                }
              />
            );
          })}
        </Section>

        <View style={styles.actions}>
          {canReceive ? <Button title={t('scan.mode.receive')} icon="receive" onPress={() => router.push({ pathname: '/(work)/scan', params: { mode: 'receive', variantId: v.id } })} style={{ flex: 1 }} /> : null}
          {canAdjust && workShop ? <Button title={t('product.adjust')} kind="tinted" icon="tune" onPress={() => router.push({ pathname: '/sheet/adjust', params: { variantId: v.id, shopId: workShop, productId: prod.id } })} style={{ flex: 1 }} /> : null}
        </View>

        <Section header={t('product.prices')}>
          <Row
            title={t('product.basePrice')}
            value={money(v.priceMinor, org.currency, lang)}
            trailing={!can('products.price.edit') ? <Pill icon="lock" text={t('common:why.setByAdmin')} tone="info" /> : undefined}
          />
          {v.costMinor !== undefined ? (
            <Row title={t('product.cost')} value={money(v.costMinor ?? null, org.currency, lang)} subtitle={v.costMinor && v.priceMinor ? t('product.margin', { pct: marginPct(v.priceMinor, v.costMinor, prod.taxRateBp) }) : undefined} />
          ) : null}
          <Row title={t('product.vat')} value={`${prod.taxRateBp / 100}%`} />
        </Section>
        {v.costMinor === undefined ? (
          <View style={{ marginHorizontal: 32, marginTop: 6 }}>
            <WhyNot icon="hidden" text={t('product.costHidden')} />
          </View>
        ) : null}

        {prod.variants.length > 1 ? (
          <Section header={t('product.variants')}>
            {prod.variants.map((x) => (
              <Row key={x.id} title={Object.values(x.options ?? {}).join(' · ') || x.sku || ''} value={money(x.priceMinor, org.currency, lang)} subtitle={x.sku ?? undefined} />
            ))}
          </Section>
        ) : null}

        <Section header={t('product.barcodes')}>
          {prod.variants.flatMap((x) => x.barcodes).map((b) => (
            <Row key={b.id} icon="barcode" iconTint={p.ink2} title={b.code} subtitle={b.packQty > 1 ? t('product.packOf', { count: b.packQty }) : (b.symbology ?? '').toUpperCase()} />
          ))}
        </Section>

        {showHistory ? (
          <Section>
            <Row icon="history" iconTint={p.info} title={t('product.history')} onPress={() => router.push({ pathname: '/(work)/stock/history', params: { variantId: v.id, name: prod.name } })} />
          </Section>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  photo: { width: 300, height: 220, borderRadius: radius.l },
  head: { paddingHorizontal: 20, paddingTop: 16, gap: 4 },
  actions: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 16 },
});
