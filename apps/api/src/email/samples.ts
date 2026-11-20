// made up content for the dev preview of every email (GET /v1/dev/emails). nothing here comes
// from a database or reaches anyone.

import { SAMPLE_IMAGES } from '@custock/db';
import { formatMoney } from '@custock/core';
import { translator, type AppLocale } from '@custock/i18n';
import type { RenderedEmail } from './layout';
import { backInStockEmail, changeCodeEmail, emailChangedEmail, inviteEmail, joinConfirmEmail, orderEmail, otpEmail, ownerInviteEmail, postEmail, type EmailKind, type OrderMailEvent } from './messages';
import { passwordChangedEmail, passwordResetEmail } from './account';

const image = (key: string): string | null => SAMPLE_IMAGES[key] ?? null;

const TEXT: Record<AppLocale, {
  name: string; inviter: string; product: string; shop: string;
  postTitle: string; postBody: string; oil: string; honey: string; tea: string;
}> = {
  en: {
    name: 'Anna', inviter: 'Eleni Papadopoulou', product: 'Thyme honey 450 g', shop: 'Lemoni Kifisia',
    postTitle: 'Olive oil week: 20% off',
    postBody: 'The new harvest from Laconia is in. Until Sunday every olive oil is 20% off, in all three of our shops.\n\nCome taste it at the counter, we open a fresh tin every morning.',
    oil: 'Extra virgin olive oil 500 ml', honey: 'Thyme honey 450 g', tea: 'Mountain tea',
  },
  el: {
    name: 'Άννα', inviter: 'Ελένη Παπαδοπούλου', product: 'Θυμαρίσιο μέλι 450g', shop: 'Lemoni Κηφισιά',
    postTitle: 'Εβδομάδα ελαιολάδου: -20%',
    postBody: 'Ήρθε η νέα σοδειά από τη Λακωνία. Μέχρι την Κυριακή όλα τα ελαιόλαδα έχουν 20% έκπτωση, και στα τρία μας καταστήματα.\n\nΕλάτε να το δοκιμάσετε στον πάγκο, ανοίγουμε φρέσκο τενεκέ κάθε πρωί.',
    oil: 'Εξαιρετικό παρθένο ελαιόλαδο 500ml', honey: 'Θυμαρίσιο μέλι 450g', tea: 'Τσάι του βουνού',
  },
  ru: {
    name: 'Анна', inviter: 'Елена Пападопулу', product: 'Тимьяновый мёд 450 г', shop: 'Lemoni Кифисия',
    postTitle: 'Неделя оливкового масла: скидка 20%',
    postBody: 'Пришёл новый урожай из Лаконии. До воскресенья на всё оливковое масло скидка 20% во всех трёх магазинах.\n\nПриходите попробовать, каждое утро мы открываем свежую банку.',
    oil: 'Оливковое масло extra virgin 500 мл', honey: 'Тимьяновый мёд 450 г', tea: 'Горный чай',
  },
};

// one email of each kind in a language, with the web address the links point at
export function sampleEmail(kind: EmailKind, locale: AppLocale, web: string, opts: { forceDark?: boolean } = {}): RenderedEmail {
  const x = TEXT[locale];
  const role = translator(locale, 'common')('role.staff');
  switch (kind) {
    case 'otp':
      return otpEmail(locale, { code: '482913' }, opts);
    case 'changeCode':
      return changeCodeEmail(locale, { code: '730561' }, opts);
    case 'emailChanged':
      return emailChangedEmail(locale, { email: 'a***@example.com' }, opts);
    case 'joinConfirm':
      return joinConfirmEmail(locale, { name: x.name, scope: x.shop, org: 'Lemoni', url: `${web}/confirm/sample-token` }, opts);
    case 'invite':
      return inviteEmail(locale, { inviter: x.inviter, org: 'Lemoni', role, scope: x.shop, url: `${web}/invite/sample-token` }, opts);
    case 'passwordReset':
      return passwordResetEmail(locale, { email: 'eleni@example.com', url: `${web}/admin/reset/sample-reset-token` }, opts);
    case 'passwordChanged':
      return passwordChangedEmail(locale, { email: 'eleni@example.com', url: `${web}/admin/forgot` }, opts);
    case 'ownerInvite':
      return ownerInviteEmail(locale, { org: 'Lemoni', url: `${web}/invite/sample-owner-token` }, opts);
    case 'backInStock':
      return backInStockEmail(locale, { shop: x.shop, org: 'Lemoni', product: x.product, url: `${web}/s/lemoni/p/sample`, imageUrl: image('p-thyme-honey'), price: formatMoney(1290, 'EUR', locale) }, opts);
    case 'orderReceived':
    case 'orderQuote':
    case 'orderConfirmed':
    case 'orderReady':
    case 'orderDeclined':
    case 'orderCancelled':
    case 'orderExpired': {
      const event = (kind.slice(5, 6).toLowerCase() + kind.slice(6)) as OrderMailEvent;
      const priced = event !== 'received';
      const money = (m: number) => formatMoney(m, 'EUR', locale);
      return orderEmail(locale, {
        event, org: 'Lemoni', shop: x.shop, logoUrl: image('s-kifisia'), number: 1042, priced, url: `${web}/s/lemoni/orders/sample`,
        total: priced ? money(4590) : null, reason: event === 'declined' || event === 'cancelled' ? x.postTitle : null, message: event === 'quote' ? x.postBody.split('\n')[0]! : null,
        until: event === 'quote' ? '22 November, 18:00' : null, address: event === 'ready' ? 'Kassavetis 12, Kifisia' : null,
        lines: [
          { name: x.oil, imageUrl: image('p-olive-oil'), qty: '10', total: priced ? money(3290) : null },
          { name: x.honey, imageUrl: image('p-thyme-honey'), qty: '2', total: priced ? money(1300) : null },
        ],
      }, opts);
    }
    case 'post':
      return postEmail(locale, {
        sender: x.shop, org: 'Lemoni', senderLogo: image('s-kifisia'), kind: 'offer', title: x.postTitle, body: x.postBody, coverUrl: image('post-offer'), url: `${web}/s/lemoni?post=sample`,
        products: [
          { name: x.oil, url: `${web}/s/lemoni/p/oil`, imageUrl: image('p-olive-oil'), priceMinor: 1290, offerPriceMinor: 1030, wasMinor: 1190 },
          { name: x.honey, url: `${web}/s/lemoni/p/honey`, imageUrl: image('p-thyme-honey'), priceMinor: 1290, offerPriceMinor: null, wasMinor: null },
          { name: x.tea, url: `${web}/s/lemoni/p/tea`, imageUrl: image('p-mountain-tea'), priceMinor: 450, offerPriceMinor: 360, wasMinor: 450 },
        ],
        currency: 'EUR', timezone: 'Europe/Athens', validUntil: Date.UTC(2026, 10, 30, 20, 0, 0), unsubscribeUrl: `${web}/unsubscribe/sample-token`,
      }, opts);
  }
}
