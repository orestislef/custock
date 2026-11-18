// every email the api sends, one builder each. texts come from the server namespace in the
// reader's language (en, el, ru), the look from layout.ts.

import { formatMoney, intlLocale } from '@custock/core';
import { pickLocale, translator, type AppLocale } from '@custock/i18n';
import { renderEmail, type EmailProduct, type RenderedEmail } from './layout';

export type EmailKind = 'otp' | 'joinConfirm' | 'invite' | 'ownerInvite' | 'changeCode' | 'emailChanged' | 'post' | 'backInStock' | 'passwordReset' | 'passwordChanged';
export const EMAIL_KINDS: readonly EmailKind[] = ['otp', 'joinConfirm', 'invite', 'ownerInvite', 'changeCode', 'emailChanged', 'post', 'backInStock', 'passwordReset', 'passwordChanged'];

type Locale = AppLocale | string | null | undefined;
const tr = (locale: Locale) => {
  const l = pickLocale(locale ?? undefined);
  return { l, t: translator(l, 'server') };
};

function system(l: AppLocale, t: ReturnType<typeof translator>) {
  return { lines: [t('email.layout.tagline'), t('email.layout.accountReason')] };
}

export function otpEmail(locale: Locale, p: { code: string }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.otp.subject', p), preheader: t('email.otp.preheader'), heading: t('email.otp.heading'),
    paragraphs: [t('email.otp.lead')], code: p.code, note: t('email.otp.note'), footer: system(l, t),
  }, opts);
}

export function changeCodeEmail(locale: Locale, p: { code: string }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.changeCode.subject', p), preheader: t('email.changeCode.preheader'), heading: t('email.changeCode.heading'),
    paragraphs: [t('email.changeCode.lead')], code: p.code, note: t('email.changeCode.note'), footer: system(l, t),
  }, opts);
}

export function emailChangedEmail(locale: Locale, p: { email: string }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.emailChanged.subject'), preheader: t('email.emailChanged.preheader', p), heading: t('email.emailChanged.heading'),
    paragraphs: [t('email.emailChanged.lead', p)], note: t('email.emailChanged.note'), footer: system(l, t),
  }, opts);
}

export function inviteEmail(locale: Locale, p: { inviter: string; org: string; role: string; scope: string; url: string }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.invite.subject', p), preheader: t('email.invite.preheader', p), eyebrow: p.org, heading: t('email.invite.heading', p),
    paragraphs: [t('email.invite.lead', p)], button: { label: t('email.invite.button'), url: p.url }, note: t('email.invite.note'),
    fallback: { label: t('email.layout.linkFallback'), url: p.url }, footer: system(l, t),
  }, opts);
}

export function ownerInviteEmail(locale: Locale, p: { org: string; url: string }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.ownerInvite.subject', p), preheader: t('email.ownerInvite.preheader', p), heading: t('email.ownerInvite.heading', p),
    paragraphs: [t('email.ownerInvite.lead', p)], button: { label: t('email.ownerInvite.button'), url: p.url }, note: t('email.ownerInvite.note'),
    fallback: { label: t('email.layout.linkFallback'), url: p.url }, footer: system(l, t),
  }, opts);
}

// business mail: the shop's name on top and in the footer
function business(t: ReturnType<typeof translator>, sender: string, extra: string[] = []) {
  return { lines: [sender, ...extra, t('email.layout.sentWith')] };
}

export function joinConfirmEmail(locale: Locale, p: { name: string; scope: string; url: string; logoUrl?: string | null }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.joinConfirm.subject', p), preheader: t('email.joinConfirm.preheader'), eyebrow: p.scope, eyebrowLogo: p.logoUrl ?? null, heading: t('email.joinConfirm.heading'),
    paragraphs: [t('email.joinConfirm.lead', p)], button: { label: t('email.joinConfirm.button'), url: p.url }, note: t('email.joinConfirm.note'),
    fallback: { label: t('email.layout.linkFallback'), url: p.url }, footer: business(t, p.scope),
  }, opts);
}

export function backInStockEmail(
  locale: Locale,
  p: { shop: string; product: string; url: string | null; imageUrl?: string | null; price?: string | null; logoUrl?: string | null },
  opts?: { forceDark?: boolean },
): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.backInStock.subject', p), preheader: t('email.backInStock.preheader'), eyebrow: p.shop, eyebrowLogo: p.logoUrl ?? null, heading: t('email.backInStock.heading', p),
    paragraphs: [t('email.backInStock.lead', p)],
    products: p.imageUrl || p.price ? { title: '', items: [{ name: p.product, url: p.url, imageUrl: p.imageUrl ?? null, price: p.price ?? null, offerPrice: null, was: null }] } : null,
    button: p.url ? { label: t('email.backInStock.button'), url: p.url } : null, note: t('email.backInStock.note'), footer: business(t, p.shop),
  }, opts);
}

export interface PostEmailProduct {
  name: string;
  url: string | null;
  imageUrl: string | null;
  priceMinor: number | null;
  offerPriceMinor: number | null;
  wasMinor: number | null;
}

export function postEmail(
  locale: Locale,
  p: {
    sender: string; // "Lemoni Kifisia"
    senderLogo?: string | null;
    kind: string;
    title: string;
    body: string;
    coverUrl: string | null;
    url: string | null;
    products: PostEmailProduct[];
    currency: string;
    timezone: string;
    validUntil: number | null;
    unsubscribeUrl: string;
  },
  opts?: { forceDark?: boolean },
): RenderedEmail {
  const { l, t } = tr(locale);
  const money = (m: number) => formatMoney(m, p.currency, l);
  const items: EmailProduct[] = p.products.map((x) => ({
    name: x.name,
    url: x.url,
    imageUrl: x.imageUrl,
    price: x.priceMinor != null ? money(x.priceMinor) : null,
    offerPrice: x.offerPriceMinor != null ? money(x.offerPriceMinor) : null,
    // the reference price of a reduction, shown only when it is really higher
    was: x.offerPriceMinor != null && x.wasMinor != null && x.wasMinor > x.offerPriceMinor ? t('email.layout.lowest30', { price: money(x.wasMinor) }) : null,
  }));
  const until = p.validUntil
    ? t('email.layout.offerUntil', { date: new Intl.DateTimeFormat(intlLocale(l), { day: 'numeric', month: 'long', timeZone: p.timezone }).format(new Date(p.validUntil)) })
    : null;
  const paragraphs = p.body.split(/\r?\n\s*\r?\n/).map((x) => x.trim()).filter(Boolean);
  const first = paragraphs[0] ?? '';
  return renderEmail({
    locale: l,
    subject: p.title,
    preheader: first.length > 120 ? `${first.slice(0, 117)}...` : first,
    eyebrow: p.sender,
    eyebrowLogo: p.senderLogo ?? null,
    heading: p.title,
    paragraphs,
    cover: p.coverUrl ? { url: p.coverUrl, alt: p.title } : null,
    products: items.length ? { title: t('email.layout.inThisPost'), items } : null,
    extraLine: p.kind === 'offer' ? until : null,
    button: p.url ? { label: t(p.kind === 'offer' ? 'email.post.buttonOffer' : 'email.post.buttonNews'), url: p.url } : null,
    footer: { lines: [t('email.layout.followReason', { scope: p.sender }), t('email.layout.sentWith')], unsubscribe: { label: t('email.layout.unsubscribe'), url: p.unsubscribeUrl } },
  }, opts);
}
