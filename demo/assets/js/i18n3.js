/* strings from the design review pass. merged into window.I18N, sentence case, see i18n.js. */
(function () {
  'use strict';
  const ADD = {
    en: {
      'tag.regular': 'Regulars', 'tag.vip': 'VIP', 'tag.oliveOilClub': 'Olive oil club', 'tag.tasting': 'Tasting guests', 'tag.wholesale': 'Wholesale', 'tag.gifts': 'Gift buyers',
      'cmp.tagged': 'Only people tagged', 'aud.tagged': 'Only {tags}: {n} of {of}',
      'home.hero': { one: 'person is waiting for something to come back', other: 'people are waiting for something to come back' },
      'home.hero.sub': 'Receive it and they hear right away',
      'a11y.scanned': { one: '{n} item scanned', other: '{n} items scanned' }, 'a11y.moreactions': 'More actions',
      'stock.more': 'Stock', 'stock.more.count': 'Count what is on the shelves', 'stock.more.tr': 'Send stock to another shop', 'stock.showall': 'Show all products',
      'cmp.kind': 'Kind', 'cmp.discard.t': 'Discard this post?', 'cmp.discard.b': 'What you wrote will be lost.', 'cmp.discard': 'Discard', 'cmp.keep': 'Keep editing',
      'c.feed.all': 'All', 'c.feed.offers': 'Offers', 'c.notify.stop': 'Stop telling me',
      'rank.between': 'Above {below}, below {above}', 'rank.above': 'Above {below}', 'rank.below': 'Below {above}', 'rank.top': 'Top level',
      'grant.rank': 'At or above your level.', 'mng.rank': 'They are at or above your level. Only someone above them can change this.',
      're.rankwhy': 'This role is at or above your level. You can look, not change.', 're.rankline': '{text}', 're.rank': 'Level', 're.rank.note': 'It stops below your own level.'
    },
    el: {
      'tag.regular': 'Τακτικοί', 'tag.vip': 'VIP', 'tag.oliveOilClub': 'Λέσχη ελαιολάδου', 'tag.tasting': 'Καλεσμένοι γευσιγνωσίας', 'tag.wholesale': 'Χονδρική', 'tag.gifts': 'Αγορές δώρων',
      'cmp.tagged': 'Μόνο με ετικέτα', 'aud.tagged': 'Μόνο {tags}: {n} από {of}',
      'home.hero': { one: 'άτομο περιμένει να ξαναέρθει κάτι', other: 'άτομα περιμένουν να ξαναέρθει κάτι' },
      'home.hero.sub': 'Κάνε παραλαβή και θα το μάθουν αμέσως',
      'a11y.scanned': { one: 'Σαρώθηκε {n} τεμάχιο', other: 'Σαρώθηκαν {n} τεμάχια' }, 'a11y.moreactions': 'Περισσότερες ενέργειες',
      'stock.more': 'Απόθεμα', 'stock.more.count': 'Μέτρησε ό,τι υπάρχει στα ράφια', 'stock.more.tr': 'Στείλε απόθεμα σε άλλο κατάστημα', 'stock.showall': 'Όλα τα προϊόντα',
      'cmp.kind': 'Είδος', 'cmp.discard.t': 'Να απορριφθεί η ανάρτηση;', 'cmp.discard.b': 'Ό,τι έγραψες θα χαθεί.', 'cmp.discard': 'Απόρριψη', 'cmp.keep': 'Συνέχεια επεξεργασίας',
      'c.feed.all': 'Όλα', 'c.feed.offers': 'Προσφορές', 'c.notify.stop': 'Σταμάτα την ειδοποίηση',
      'rank.between': 'Πάνω από {below}, κάτω από {above}', 'rank.above': 'Πάνω από {below}', 'rank.below': 'Κάτω από {above}', 'rank.top': 'Ανώτερο επίπεδο',
      'grant.rank': 'Στο ίδιο ή σε υψηλότερο επίπεδο από σένα.', 'mng.rank': 'Είναι στο ίδιο ή σε υψηλότερο επίπεδο από σένα. Το αλλάζει μόνο κάποιος πάνω του.',
      're.rankwhy': 'Αυτός ο ρόλος είναι στο ίδιο ή σε υψηλότερο επίπεδο από σένα. Βλέπεις, δεν αλλάζεις.', 're.rankline': '{text}', 're.rank': 'Επίπεδο', 're.rank.note': 'Σταματά κάτω από το δικό σου επίπεδο.'
    },
    ru: {
      'tag.regular': 'Постоянные', 'tag.vip': 'VIP', 'tag.oliveOilClub': 'Клуб оливкового масла', 'tag.tasting': 'Гости дегустаций', 'tag.wholesale': 'Опт', 'tag.gifts': 'Покупают подарки',
      'cmp.tagged': 'Только с меткой', 'aud.tagged': 'Только {tags}: {n} из {of}',
      'home.hero': { one: 'человек ждёт, когда товар вернётся', few: 'человека ждут, когда товар вернётся', many: 'человек ждут, когда товар вернётся', other: 'человека ждут, когда товар вернётся' },
      'home.hero.sub': 'Примите товар, и они сразу узнают',
      'a11y.scanned': { one: 'Отсканирован {n} товар', few: 'Отсканировано {n} товара', many: 'Отсканировано {n} товаров', other: 'Отсканировано {n} товара' }, 'a11y.moreactions': 'Другие действия',
      'stock.more': 'Остатки', 'stock.more.count': 'Пересчитать то, что на полках', 'stock.more.tr': 'Отправить товар в другой магазин', 'stock.showall': 'Показать все товары',
      'cmp.kind': 'Тип', 'cmp.discard.t': 'Удалить черновик?', 'cmp.discard.b': 'Написанное пропадёт.', 'cmp.discard': 'Удалить', 'cmp.keep': 'Продолжить',
      'c.feed.all': 'Все', 'c.feed.offers': 'Акции', 'c.notify.stop': 'Больше не сообщать',
      'rank.between': 'Выше роли «{below}», ниже роли «{above}»', 'rank.above': 'Выше роли «{below}»', 'rank.below': 'Ниже роли «{above}»', 'rank.top': 'Высший уровень',
      'grant.rank': 'На вашем уровне или выше.', 'mng.rank': 'Этот человек на вашем уровне или выше. Изменить может только тот, кто выше.',
      're.rankwhy': 'Эта роль на вашем уровне или выше. Смотреть можно, менять нельзя.', 're.rankline': '{text}', 're.rank': 'Уровень', 're.rank.note': 'Останавливается ниже вашего уровня.'
    }
  };
  ['en', 'el', 'ru'].forEach((l) => Object.assign(window.I18N[l], ADD[l]));
})();
