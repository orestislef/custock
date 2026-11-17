// the ledger for one product: every movement, who, when, why.

import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useOrg, useSession } from '@/lib/session';
import { EmptyState } from '@/ui/Bits';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function History() {
  const { variantId, name } = useLocalSearchParams<{ variantId: string; name?: string }>();
  const { t, i18n } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const org = useOrg();
  const { shopId } = useSession();
  const res = useQuery({ queryKey: ['movements', org.orgId, shopId, variantId], queryFn: () => api.movements(org.orgId, { shopId: shopId ?? undefined, variantId }) });
  const items = res.data?.items ?? [];
  return (
    <>
      <Stack.Screen options={{ title: t('product.history'), headerLargeTitleEnabled: false }} />
      <Screen refreshing={res.isRefetching} onRefresh={() => void res.refetch()}>
        {name ? (
          <Text variant="footnote" tone="ink2" style={{ marginHorizontal: 32, marginTop: 16 }}>
            {name}
          </Text>
        ) : null}
        {items.length ? (
          <Section footer={t('history.footer')}>
            {items.map((m) => (
              <Row
                key={m.id}
                title={t(`common:movement.${m.kind}`) + (m.reason ? ` · ${t(`common:reason.${m.reason}`)}` : '')}
                subtitle={`${m.createdByName ?? ''} · ${dateTime(m.occurredAt, i18n.language)}`}
                trailing={
                  <View style={{ minWidth: 44, alignItems: 'flex-end' }}>
                    <Text variant="headline" tabular style={{ color: m.qtyDelta > 0 ? p.success : p.ink }}>
                      {m.qtyDelta > 0 ? `+${m.qtyDelta}` : String(m.qtyDelta)}
                    </Text>
                  </View>
                }
              />
            ))}
          </Section>
        ) : res.isLoading ? null : (
          <EmptyState icon="history" title={t('history.emptyTitle')} body={t('history.emptyBody')} />
        )}
      </Screen>
    </>
  );
}
