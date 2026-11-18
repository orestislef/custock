// mail from the platform itself (not from a business): the invite to become a super admin

import { pickLocale, translator, type AppLocale } from '@custock/i18n';
import { renderEmail, type RenderedEmail } from './layout';

export function superadminInviteEmail(locale: AppLocale | string | null | undefined, p: { inviter: string; url: string }, opts?: { forceDark?: boolean }): RenderedEmail {
  const l = pickLocale(locale ?? undefined);
  const t = translator(l, 'server');
  return renderEmail({
    locale: l, subject: t('email.superadminInvite.subject', p), preheader: t('email.superadminInvite.preheader', p), heading: t('email.superadminInvite.heading'),
    paragraphs: [t('email.superadminInvite.lead', p)], button: { label: t('email.superadminInvite.button'), url: p.url }, note: t('email.superadminInvite.note'),
    fallback: { label: t('email.layout.linkFallback'), url: p.url }, footer: { lines: [t('email.layout.tagline'), t('email.layout.accountReason')] },
  }, opts);
}
