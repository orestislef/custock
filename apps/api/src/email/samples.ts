// made up content for the dev preview of every email (GET /v1/dev/emails). nothing here comes
// from a database or reaches anyone.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMoney } from '@custock/core';
import { translator, type AppLocale } from '@custock/i18n';
import type { RenderedEmail } from './layout';
import { backInStockEmail, changeCodeEmail, emailChangedEmail, inviteEmail, joinConfirmEmail, otpEmail, ownerInviteEmail, postEmail, type EmailKind } from './messages';

let images: Record<string, string> | null = null;
function image(key: string): string | null {
  if (!images) {
    images = {};
    const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'demo', 'assets', 'js', 'images.js');
    if (existsSync(file)) for (const m of readFileSync(file, 'utf8').matchAll(/"([\w-]+)":\s*"([^"]+)"/g)) images[m[1]!] = m[2]!;
  }
  return images[key] ?? null;
}

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
      return joinConfirmEmail(locale, { name: x.name, scope: x.shop, url: `${web}/confirm/sample-token` }, opts);
    case 'invite':
      return inviteEmail(locale, { inviter: x.inviter, org: 'Lemoni', role, scope: x.shop, url: `${web}/invite/sample-token` }, opts);
    case 'ownerInvite':
      return ownerInviteEmail(locale, { org: 'Lemoni', url: `${web}/invite/sample-owner-token` }, opts);
    case 'backInStock':
      return backInStockEmail(locale, { shop: x.shop, product: x.product, url: `${web}/s/lemoni/p/sample`, imageUrl: image('p-thyme-honey'), price: formatMoney(1290, 'EUR', locale) }, opts);
    case 'post':
      return postEmail(locale, {
        sender: x.shop, kind: 'offer', title: x.postTitle, body: x.postBody, coverUrl: image('post-offer'), url: `${web}/s/lemoni?post=sample`,
        products: [
          { name: x.oil, url: `${web}/s/lemoni/p/oil`, imageUrl: image('p-olive-oil'), priceMinor: 1290, offerPriceMinor: 1030, wasMinor: 1190 },
          { name: x.honey, url: `${web}/s/lemoni/p/honey`, imageUrl: image('p-thyme-honey'), priceMinor: 1290, offerPriceMinor: null, wasMinor: null },
          { name: x.tea, url: `${web}/s/lemoni/p/tea`, imageUrl: image('p-mountain-tea'), priceMinor: 450, offerPriceMinor: 360, wasMinor: 450 },
        ],
        currency: 'EUR', timezone: 'Europe/Athens', validUntil: Date.UTC(2026, 10, 30, 20, 0, 0), unsubscribeUrl: `${web}/unsubscribe/sample-token`,
      }, opts);
  }
}
