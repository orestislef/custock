// every email the api sends, one builder each. texts come from the server namespace in the
// reader's language (en, el, ru), the look from layout.ts.

import { formatMoney, intlLocale } from '@custock/core';
import { pickLocale, translator, type AppLocale } from '@custock/i18n';
import { renderEmail, type EmailProduct, type RenderedEmail } from './layout';

export type EmailKind = 'otp' | 'joinConfirm' | 'invite' | 'ownerInvite' | 'changeCode' | 'emailChanged' | 'post' | 'backInStock' | 'passwordReset' | 'passwordChanged'
  | 'orderReceived' | 'orderQuote' | 'orderConfirmed' | 'orderReady' | 'orderDeclined' | 'orderCancelled' | 'orderExpired';
export const EMAIL_KINDS: readonly EmailKind[] = [
  'otp', 'joinConfirm', 'invite', 'ownerInvite', 'changeCode', 'emailChanged', 'post', 'backInStock', 'passwordReset', 'passwordChanged',
  'orderReceived', 'orderQuote', 'orderConfirmed', 'orderReady', 'orderDeclined', 'orderCancelled', 'orderExpired',
];

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

// revertUrl: the one click way back for the old address (7 days)
export function emailChangedEmail(locale: Locale, p: { email: string; revertUrl?: string | null }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.emailChanged.subject'), preheader: t('email.emailChanged.preheader', p), heading: t('email.emailChanged.heading'),
    paragraphs: [t('email.emailChanged.lead', p)],
    ...(p.revertUrl
      ? { button: { label: t('email.emailChanged.button'), url: p.revertUrl }, note: t('email.emailChanged.noteRevert'), fallback: { label: t('email.layout.linkFallback'), url: p.revertUrl } }
      : { note: t('email.emailChanged.note') }),
    footer: system(l, t),
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

export function joinConfirmEmail(locale: Locale, p: { name: string; scope: string; url: string; logoUrl?: string | null; org?: string }, opts?: { forceDark?: boolean }): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.joinConfirm.subject', p), preheader: t('email.joinConfirm.preheader'), eyebrow: p.scope, brand: { name: p.org ?? p.scope, logoUrl: p.logoUrl ?? null }, heading: t('email.joinConfirm.heading'),
    paragraphs: [t('email.joinConfirm.lead', p)], button: { label: t('email.joinConfirm.button'), url: p.url }, note: t('email.joinConfirm.note'),
    fallback: { label: t('email.layout.linkFallback'), url: p.url }, footer: business(t, p.scope),
  }, opts);
}

export function backInStockEmail(
  locale: Locale,
  p: { shop: string; product: string; url: string | null; imageUrl?: string | null; price?: string | null; logoUrl?: string | null; org?: string },
  opts?: { forceDark?: boolean },
): RenderedEmail {
  const { l, t } = tr(locale);
  return renderEmail({
    locale: l, subject: t('email.backInStock.subject', p), preheader: t('email.backInStock.preheader'), eyebrow: p.shop, brand: { name: p.org ?? p.shop, logoUrl: p.logoUrl ?? null }, heading: t('email.backInStock.heading', p),
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
    org?: string; // "Lemoni", the name under a missing logo
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
    brand: { name: p.org ?? p.sender, logoUrl: p.senderLogo ?? null },
    heading: p.title,
    paragraphs,
    cover: p.coverUrl ? { url: p.coverUrl, alt: p.title } : null,
    products: items.length ? { title: t('email.layout.inThisPost'), items } : null,
    extraLine: p.kind === 'offer' ? until : null,
    button: p.url ? { label: t(p.kind === 'offer' ? 'email.post.buttonOffer' : 'email.post.buttonNews'), url: p.url } : null,
    footer: { lines: [t('email.layout.followReason', { scope: p.sender }), t('email.layout.sentWith')], unsubscribe: { label: t('email.layout.unsubscribe'), url: p.unsubscribeUrl } },
  }, opts);
}

// ---------------------------------------------------------------- orders

export type OrderMailEvent = 'received' | 'quote' | 'confirmed' | 'ready' | 'declined' | 'cancelled' | 'expired';

export interface OrderMailLine {
  name: string;
  imageUrl: string | null;
  // "10" or "1,5 kg", already in the reader's language
  qty: string;
  // the line total, formatted, when known
  total: string | null;
}

// one builder for every step of an order the customer hears about by email. the shop's look, its
// logo on top, the lines with their totals when known, and a button to the order in its app
export function orderEmail(
  locale: Locale,
  p: {
    event: OrderMailEvent;
    org: string;
    shop: string;
    logoUrl?: string | null;
    number: number;
    lines: OrderMailLine[];
    // formatted, null while the price is not known
    total: string | null;
    // received: the order went in at the shown prices
    priced?: boolean;
    url: string;
    reason?: string | null;
    message?: string | null;
    // formatted date the price holds until
    until?: string | null;
    address?: string | null;
  },
  opts?: { forceDark?: boolean },
): RenderedEmail {
  const { l, t } = tr(locale);
  const k = `email.order.${p.event}`;
  const params = { number: p.number, shop: p.shop, total: p.total ?? '', reason: p.reason ?? '', until: p.until ?? '', address: p.address ?? '' };
  const lead = p.event === 'received' ? t(p.priced ? `${k}.leadPriced` : `${k}.leadQuote`, params) : t(`${k}.lead`, params);
  const paragraphs = [lead];
  if (p.event === 'quote' && p.message) paragraphs.push(t('email.order.shopWrote', { message: p.message }));
  if ((p.event === 'declined' || p.event === 'cancelled') && p.reason) paragraphs.push(t('email.order.shopWrote', { message: p.reason }));
  if (p.event === 'ready' && p.address) paragraphs.push(p.address);
  const items: EmailProduct[] = p.lines.map((x) => ({
    name: t('email.order.lineName', { qty: x.qty, name: x.name }),
    url: null,
    imageUrl: x.imageUrl,
    price: x.total,
    offerPrice: null,
    was: null,
  }));
  const extra = [
    p.total ? t('email.order.total', { total: p.total }) : null,
    p.event === 'quote' && p.until ? t('email.order.until', { until: p.until }) : null,
  ].filter(Boolean).join(' · ');
  return renderEmail({
    locale: l,
    subject: t(`${k}.subject`, params),
    preheader: t(`${k}.preheader`, params),
    eyebrow: p.shop,
    brand: { name: p.org, logoUrl: p.logoUrl ?? null },
    heading: t(`${k}.heading`, params),
    paragraphs,
    products: items.length ? { title: t('email.order.lines', { number: p.number }), items } : null,
    extraLine: extra || null,
    button: { label: t(p.event === 'quote' ? 'email.order.answer' : 'email.order.see'), url: p.url },
    note: t('email.order.note', { shop: p.shop }),
    fallback: { label: t('email.layout.linkFallback'), url: p.url },
    footer: business(t, p.shop),
  }, opts);
}
