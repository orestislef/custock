// the notice a super admin gets when a brand new error shows up in production. short, scrubbed,
// with a button to the issue. repeats of the same issue never send another one.

import type { IssueKind } from '@custock/core';
import { pickLocale, translator, type AppLocale } from '@custock/i18n';
import { renderEmail, type RenderedEmail } from './layout';

export function errorNoticeEmail(
  locale: AppLocale | string | null | undefined,
  p: { kind: IssueKind; title: string; route: string | null; url: string },
  opts?: { forceDark?: boolean },
): RenderedEmail {
  const l = pickLocale(locale ?? undefined);
  const t = translator(l, 'server');
  const kind = t(`email.errorNotice.kind.${p.kind}`);
  const where = p.route ? t('email.errorNotice.where', { route: p.route }) : null;
  return renderEmail({
    locale: l,
    subject: t('email.errorNotice.subject', { kind }),
    preheader: p.title.slice(0, 120),
    heading: t('email.errorNotice.heading'),
    paragraphs: [t('email.errorNotice.lead', { kind }), p.title, ...(where ? [where] : [])],
    button: { label: t('email.errorNotice.button'), url: p.url },
    note: t('email.errorNotice.note'),
    fallback: { label: t('email.layout.linkFallback'), url: p.url },
    footer: { lines: [t('email.layout.tagline'), t('email.errorNotice.reason')] },
  }, opts);
}
