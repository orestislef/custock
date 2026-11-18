/* field check messages, the same wording as the real app (common.json field.*). merged into window.I18N. */
(function () {
  'use strict';
  const ADD = {
    en: {
      'field.money': 'Type a price like 9.90.', 'field.tooManyDecimals': 'Prices have two decimals at most.', 'field.negative': 'It cannot be below zero.',
      'field.tooLarge': 'That is more than allowed.', 'field.email': 'Check the email, for example name@example.com.', 'field.spaces': 'An email has no spaces.',
      'field.empty': 'Fill this in.'
    },
    el: {
      'field.money': 'Γράψτε μια τιμή όπως 9,90.', 'field.tooManyDecimals': 'Οι τιμές έχουν το πολύ δύο δεκαδικά.', 'field.negative': 'Δεν μπορεί να είναι κάτω από το μηδέν.',
      'field.tooLarge': 'Είναι περισσότερο από όσο επιτρέπεται.', 'field.email': 'Ελέγξτε το email, για παράδειγμα name@example.com.', 'field.spaces': 'Ένα email δεν έχει κενά.',
      'field.empty': 'Συμπληρώστε το.'
    },
    ru: {
      'field.money': 'Введите цену, например 9,90.', 'field.tooManyDecimals': 'У цены не больше двух знаков после запятой.', 'field.negative': 'Не может быть меньше нуля.',
      'field.tooLarge': 'Больше, чем можно.', 'field.email': 'Проверьте email, например name@example.com.', 'field.spaces': 'В email нет пробелов.',
      'field.empty': 'Заполните это поле.'
    }
  };
  ['en', 'el', 'ru'].forEach((l) => Object.assign(window.I18N[l], ADD[l]));
})();
