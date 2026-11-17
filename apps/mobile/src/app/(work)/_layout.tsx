// the work side. tabs come from the member's permissions and stay fixed for a role.
// scan sits in the trailing slot on ios 26 (the search role), as the one prominent action.

import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/lib/session';
import { usePalette } from '@/ui/theme';

export default function WorkTabs() {
  const { t } = useTranslation('mobile');
  const p = usePalette();
  const { me, org, can } = useSession();
  if (!me) return <Redirect href="/sign-in" />;
  if (!org) return <Redirect href="/(shopper)/feed" />;

  const anyShop = (perm: string) => can(perm, null);
  const canScan = ['stock.receive', 'stock.sell', 'stock.count', 'stock.adjust'].some(anyShop);
  const staffLike = !anyShop('stock.adjust') && canScan; // staff: their home is "today"
  const showStock = anyShop('stock.view') || can('products.view');
  const showCustomers = anyShop('customers.view');
  const showPosts = anyShop('posts.create') || anyShop('posts.publish');

  return (
    <NativeTabs
      tintColor={p.accent}
      iconColor={{ default: p.ink2, selected: p.accent }}
      labelStyle={{ default: { color: p.ink2 }, selected: { color: p.accent } }}
      backgroundColor={p.surface}
      indicatorColor={p.accentTint}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Label>{staffLike ? t('tabs.today') : t('tabs.home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="stock" hidden={!showStock}>
        <NativeTabs.Trigger.Label>{t('tabs.stock')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'shippingbox', selected: 'shippingbox.fill' }} md="inventory_2" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="customers" hidden={!showCustomers}>
        <NativeTabs.Trigger.Label>{t('tabs.customers')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="posts" hidden={!showPosts}>
        <NativeTabs.Trigger.Label>{t('tabs.posts')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'megaphone', selected: 'megaphone.fill' }} md="campaign" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Label>{t('tabs.more')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'ellipsis.circle', selected: 'ellipsis.circle.fill' }} md="more_horiz" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="scan" role="search" disableAutomaticSearchActivation hidden={!canScan}>
        <NativeTabs.Trigger.Label>{t('tabs.scan')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="barcode.viewfinder" md="barcode_scanner" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
