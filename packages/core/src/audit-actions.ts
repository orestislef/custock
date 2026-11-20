// every action the api writes to the audit logs. the api's audit writers only accept these keys,
// so a new action must be added here, and a test checks that each one has a sentence in en, el
// and ru (web.json audit.action, and platform.audit.action for the platform only ones).

// written to a business's audit log (and copied to the platform audit when a super admin acts)
export const BUSINESS_AUDIT_ACTIONS = [
  'category.created',
  'category.updated',
  'category.deleted',
  'customer.added',
  'customer.erased',
  'customer.erased_by_self',
  'member.active',
  'member.suspended',
  'member.removed',
  'member.deleted_account',
  'member.rejoined_by_invite',
  'invite.sent',
  'invite.accepted',
  'invite.revoked',
  'role.created',
  'role.updated',
  'role.assigned',
  'role.unassigned',
  'post.published',
  'post.scheduled',
  'post.submitted',
  'post.cancelled',
  'post.deleted',
  'post.edited_after_send',
  'product.created',
  'product.updated',
  'product.archived',
  'product.price_changed',
  'product.shop_price_changed',
  'variant.archived',
  'barcode.detached',
  'stock.count_applied',
  'stock.transfer_shortage',
  'stock.negative_accepted_offline',
  'stock.movement_on_archived',
  'org.created',
  'org.settings_changed',
  'shop.created',
  'shop.updated',
  'joinlink.created',
  'order.quoted',
  'order.confirmed',
  'order.declined',
  'order.ready',
  'order.completed',
  'order.cancelled',
  'policies.business_changed',
  'policies.shop_changed',
  'policies.role_changed',
  'policies.user_changed',
] as const;

// written only to the platform audit
export const PLATFORM_AUDIT_ACTIONS = [
  'business.created',
  'business.controls_changed',
  'business.deleted',
  'owner.invited',
  'owner.invite_resent',
  'owner.invite_revoked',
  'platform.settings_changed',
  'superadmin.invited',
  'superadmin.invite_accepted',
  'superadmin.invite_revoked',
  'superadmin.removed',
  'superadmin.granted_cli',
  'superadmin.device_signed_out',
  'superadmin.others_signed_out',
  'policies.platform_changed',
  'policies.business_controls_changed',
] as const;

export type BusinessAuditAction = (typeof BUSINESS_AUDIT_ACTIONS)[number];
export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];
export type AuditAction = BusinessAuditAction | PlatformAuditAction;

export function isAuditAction(action: string): action is AuditAction {
  return (BUSINESS_AUDIT_ACTIONS as readonly string[]).includes(action) || (PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(action);
}
