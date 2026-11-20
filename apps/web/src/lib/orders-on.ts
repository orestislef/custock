import { featureOn, type OrgSettings } from '@custock/core';

// orders switched off, by the super admin or by the business: nothing about them shows, not even
// their limits, their alert or their permissions in a role. switching them on brings it all back.
export function ordersOn(org: { disabledFeatures?: readonly string[] } | null | undefined, settings: Pick<OrgSettings, 'customerOrders'> | null | undefined): boolean {
  return featureOn(org, 'orders') && (settings?.customerOrders ?? 'off') !== 'off';
}

// the policy keys and permissions that belong to orders
export const isOrdersPolicy = (key: string) => key.startsWith('orders.') || key === 'alerts.orders';
export const isOrdersPermission = (key: string) => key.startsWith('orders.');
