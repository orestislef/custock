// pick the shop the work side looks at. "all shops" when the member covers more than one.

import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { useSession } from '@/lib/session';
import { Icon } from '@/ui/Icon';
import { Row, Section } from '@/ui/List';
import { Text } from '@/ui/Text';
import { usePalette } from '@/ui/theme';

export default function ShopPicker() {
  const { t } = useTranslation(['mobile', 'common']);
  const p = usePalette();
  const { org, shopId, setShop, me, setOrg } = useSession();
  if (!org) return null;
  const pick = (id: string | null) => {
    setShop(id);
    router.back();
  };
  const check = <Icon name="check" size={16} color={p.accent} weight="bold" />;
  return (
    <ScrollView style={{ backgroundColor: p.elevated }} contentContainerStyle={{ paddingVertical: 20 }}>
      <Text variant="title3" weight="700" style={{ marginHorizontal: 20 }}>
        {t('shopPicker.title')}
      </Text>
      <Section footer={t('shopPicker.footer')}>
        <Row title={t('common:scope.allShops')} subtitle={t('shopPicker.allSub', { count: org.shops.length })} trailing={shopId === null ? check : undefined} onPress={() => pick(null)} chevron={false} />
        {org.shops.map((s) => (
          <Row key={s.shopId} icon="shop" title={s.name} trailing={shopId === s.shopId ? check : undefined} onPress={() => pick(s.shopId)} chevron={false} />
        ))}
      </Section>
      {me && me.orgs.length > 1 ? (
        <Section header={t('shopPicker.business')}>
          {me.orgs.map((o) => (
            <Row key={o.orgId} title={o.name} trailing={o.orgId === org.orgId ? check : undefined} onPress={() => { setOrg(o.orgId); router.back(); }} chevron={false} />
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}
