// mail about the account itself: the forgot password link and the notice once it was changed

import { pickLocale, translator, type AppLocale } from '@custock/i18n';
import { renderEmail, type RenderedEmail } from './layout';

type Locale = AppLocale | string | null | undefined;

function tr(locale: Locale) {
  const l = pickLocale(locale ?? undefined);
  return { l, t: translator(l, 'server') };
}

const footer = (t: ReturnType<typeof translator>) => ({ lines: [t('email.layout.tagline'), t('email.layout.accountReason')] });

export function passwordResetEmail(locale: Locale, p: { email: string; url: string }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.passwordReset.subject'), preheader: t('email.passwordReset.preheader'), heading: t('email.passwordReset.heading'),
    paragraphs: [t('email.passwordReset.lead', p)], button: { label: t('email.passwordReset.button'), url: p.url }, note: t('email.passwordReset.note'),
    fallback: { label: t('email.layout.linkFallback'), url: p.url }, footer: footer(t),
  }, opts);
}

// url points at the forgot password page, for when it was not them
export function passwordChangedEmail(locale: Locale, p: { email: string; url: string }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.passwordChanged.subject'), preheader: t('email.passwordChanged.preheader'), heading: t('email.passwordChanged.heading'),
    paragraphs: [t('email.passwordChanged.lead', p)], button: { label: t('email.passwordChanged.button'), url: p.url }, note: t('email.passwordChanged.note'),
    footer: footer(t),
  }, opts);
}

// the code that confirms deleting an account without a password
export function deleteCodeEmail(locale: Locale, p: { code: string }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.deleteCode.subject', p), preheader: t('email.deleteCode.preheader'), heading: t('email.deleteCode.heading'),
    paragraphs: [t('email.deleteCode.lead')], code: p.code, note: t('email.deleteCode.note'), footer: footer(t),
  }, opts);
}

// after the old address used the way back: the email is the old one again, everyone signed out
export function emailRevertedEmail(locale: Locale, p: { email: string }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.emailReverted.subject'), preheader: t('email.emailReverted.preheader', p), heading: t('email.emailReverted.heading'),
    paragraphs: [t('email.emailReverted.lead', p)], note: t('email.emailReverted.note'), footer: footer(t),
  }, opts);
}
