// the customer side: feed, offers, catalog, shops, profile. tabs never disappear; an empty one
// explains itself instead (apple: do not hide tab bar items).

import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/lib/session';
import { usePalette } from '@/ui/theme';

export default function ShopperTabs() {
  const { t } = useTranslation('mobile');
  const p = usePalette();
  const { me } = useSession();
  if (!me) return <Redirect href="/sign-in" />;
  return (
    <NativeTabs
      tintColor={p.accent}
      iconColor={{ default: p.ink2, selected: p.accent }}
      labelStyle={{ default: { color: p.ink2 }, selected: { color: p.accent } }}
      backgroundColor={p.surface}
      indicatorColor={p.accentTint}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="feed">
        <NativeTabs.Trigger.Label>{t('tabs.home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="offers">
        <NativeTabs.Trigger.Label>{t('tabs.offers')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'tag', selected: 'tag.fill' }} md="local_offer" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="catalog">
        <NativeTabs.Trigger.Label>{t('tabs.catalog')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} md="apps" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="shops">
        <NativeTabs.Trigger.Label>{t('tabs.shops')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'storefront', selected: 'storefront.fill' }} md="storefront" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="me">
        <NativeTabs.Trigger.Label>{t('tabs.profile')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
