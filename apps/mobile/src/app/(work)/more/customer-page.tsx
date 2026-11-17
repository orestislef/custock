// what customers can see: catalog, prices, stock. with the consequences written next to each switch.

import type { CustomerCatalogMode, CustomerStockMode, OrgSettings } from '@custock/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { useOrg } from '@/lib/session';
import { Pill, Segmented } from '@/ui/Bits';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Toggle } from '@/ui/Toggle';

export default function CustomerPage() {
  const { t } = useTranslation(['mobile', 'common']);
  const org = useOrg();
  const qc = useQueryClient();
  const res = useQuery({ queryKey: ['settings', org.orgId], queryFn: () => api.orgSettings(org.orgId) });
  const s = res.data;
  const save = async (patch: Partial<OrgSettings>) => {
    qc.setQueryData(['settings', org.orgId], { ...s, ...patch });
    await api.updateOrgSettings(org.orgId, patch);
    void qc.invalidateQueries({ queryKey: ['settings', org.orgId] });
  };
  if (!s) return <Screen />;

  // the live preview of one product line, as a customer would see it
  const previewState = s.customerStock === 'off' ? null : s.customerStock === 'exact' ? t('common:stock.qtyInStock', { count: 7 }) : t('common:stock.in');

  return (
    <>
      <Stack.Screen options={{ title: t('more.customerPage'), headerLargeTitleEnabled: false }} />
      <Screen>
        <Section header={t('customerPage.catalog')} footer={t(`customerPage.catalogFooter.${s.customerCatalog}`)}>
          <View style={{ padding: 12 }}>
            <Segmented<CustomerCatalogMode>
              value={s.customerCatalog}
              onChange={(v) => void save({ customerCatalog: v })}
              options={(['off', 'subscribers', 'public'] as const).map((v) => ({ value: v, label: t(`customerPage.catalogMode.${v}`) }))}
            />
          </View>
        </Section>
        <Section footer={t('customerPage.pricesFooter')}>
          <Row title={t('customerPage.prices')} trailing={<Toggle value={s.customerPrices} onValueChange={(v) => void save({ customerPrices: v })} />} />
        </Section>
        <Section header={t('customerPage.stock')} footer={t(`customerPage.stockFooter.${s.customerStock}`)}>
          <View style={{ padding: 12 }}>
            <Segmented<CustomerStockMode>
              value={s.customerStock}
              onChange={(v) => void save({ customerStock: v })}
              options={(['off', 'availability', 'exact'] as const).map((v) => ({ value: v, label: t(`customerPage.stockMode.${v}`) }))}
            />
          </View>
        </Section>
        <Section header={t('customerPage.preview')}>
          <Row
            title={t('customerPage.previewProduct')}
            subtitle={s.customerPrices ? '12,90 €' : t('customerPage.priceHidden')}
            trailing={previewState ? <Pill text={previewState} tone="success" /> : <Text variant="footnote" tone="ink2">{t('customerPage.noStockShown')}</Text>}
          />
        </Section>
      </Screen>
    </>
  );
}
