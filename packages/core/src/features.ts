// features a super admin can switch off for one business. on unless listed in disabledFeatures.
// no zod here, so every screen that only asks "is this on" stays small in the browser.
export const FEATURES = ['customer_pages', 'posts', 'email', 'push', 'transfers', 'counts', 'reports', 'uploads', 'orders'] as const;
export type FeatureName = (typeof FEATURES)[number];

export function featureOn(access: { disabledFeatures?: readonly string[] } | null | undefined, feature: FeatureName): boolean {
  return !access?.disabledFeatures?.includes(feature);
}
