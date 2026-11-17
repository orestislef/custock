import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Share } from 'react-native';

import { api } from '@/lib/api';
import { useOrg } from '@/lib/session';
import { Row, Section } from '@/ui/List';
import { Screen } from '@/ui/Screen';

export default function JoinLinks() {
  const { t } = useTranslation(['mobile', 'common']);
  const org = useOrg();
  const res = useQuery({ queryKey: ['joinLinks', org.orgId], queryFn: () => api.joinLinks(org.orgId) });
  const scopeName = (type: string, id: string) => (type === 'org' ? org.name : org.shops.find((s) => s.shopId === id)?.name ?? '');
  return (
    <>
      <Stack.Screen options={{ title: t('more.joinLinks'), headerLargeTitleEnabled: false }} />
      <Screen>
        <Section footer={t('joinLinks.footer')}>
          {(res.data ?? []).map((l) => (
            <Row
              key={l.id}
              icon="qr"
              iconTint="#1F8A8A"
              title={l.label ?? l.code}
              subtitle={`${scopeName(l.scopeType, l.scopeId)} · ${t('reports.linkLine', { opens: l.opens, signups: l.signups })}`}
              onPress={() => void Share.share({ message: l.url })}
            />
          ))}
        </Section>
      </Screen>
    </>
  );
}
