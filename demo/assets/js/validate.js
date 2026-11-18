/* the same input rules as the real app (packages/core/src/validate.ts), in plain js for the demo.
   window.CV.money('9,90') gives { ok: true, value: 990 } or { ok: false, error: 'invalid' }. */
(function () {
  'use strict';
  const SPACES = /[\s   ']/g;
  const ok = (value) => ({ ok: true, value: value });
  const fail = (error) => ({ ok: false, error: error });

  function validGroups(s, mark) {
    const parts = s.split(mark);
    if (parts.length === 1) return true;
    return /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p));
  }

  // "9,90", "9.90", "1.234,56", "1 234,56" and "1,234.56" all work. "9,,90", letters, a lone mark or
  // too many decimals do not
  function decimal(input, decimals, scale, max) {
    let s = String(input || '').trim().replace(/−/g, '-');
    if (!s) return fail('empty');
    if (s.charAt(0) === '-') return fail('negative');
    s = s.replace(SPACES, '');
    if (!/^[\d.,]+$/.test(s)) return fail('invalid');
    if (/[.,]{2,}/.test(s) || /^[.,]$/.test(s) || /[.,]$/.test(s)) return fail('invalid');
    const commas = (s.match(/,/g) || []).length;
    const dots = (s.match(/\./g) || []).length;
    let whole = s;
    let frac = '';
    if (commas && dots) {
      const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
      const grp = dec === ',' ? '.' : ',';
      const at = s.lastIndexOf(dec);
      whole = s.slice(0, at);
      frac = s.slice(at + 1);
      if (frac.indexOf(grp) >= 0 || whole.indexOf(dec) >= 0 || !validGroups(whole, grp)) return fail('invalid');
      whole = whole.split(grp).join('');
    } else if (commas + dots === 1) {
      const mark = commas ? ',' : '.';
      const ab = s.split(mark);
      if (ab[1].length <= decimals || ab[1].length !== 3 || !ab[0]) { whole = ab[0] || '0'; frac = ab[1]; } else whole = ab[0] + ab[1];
    } else if (commas + dots > 1) {
      const mark = commas ? ',' : '.';
      if (!validGroups(s, mark)) return fail('invalid');
      whole = s.split(mark).join('');
    }
    if (frac.length > decimals) return fail(decimals === 0 ? 'wholeNumber' : 'tooManyDecimals');
    if (whole.length > 15) return fail('tooLarge');
    const pad = (frac + '000').slice(0, decimals) || '0';
    const value = Number(whole) * scale + Number(pad) * (scale / Math.pow(10, decimals));
    if (!Number.isSafeInteger(value) || value > max) return fail('tooLarge');
    return ok(value);
  }

  const EMAIL_LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
  const EMAIL_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  function emailProblem(input) {
    const s = String(input || '').trim().toLowerCase();
    if (!s) return 'empty';
    if (s.length > 254) return 'tooLong';
    if (/\s/.test(s)) return 'spaces';
    const at = s.split('@');
    if (at.length !== 2) return 'invalid';
    if (!at[0] || at[0].length > 64 || !EMAIL_LOCAL.test(at[0])) return 'invalid';
    const labels = at[1].split('.');
    if (labels.length < 2 || !labels.every((l) => EMAIL_LABEL.test(l))) return 'invalid';
    if (!/^([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels[labels.length - 1])) return 'invalid';
    return null;
  }

  function line(input, max) {
    const v = String(input || '').replace(/[\u0000-\u001F\u007F-\u009F​-‍⁠﻿]/g, ' ').replace(/\s+/g, ' ').trim();
    return v.length > max ? v.slice(0, max) : v;
  }

  function formatMoney(minor, lang) {
    const tag = lang === 'el' ? 'el-GR' : lang === 'ru' ? 'ru-RU' : 'en-GB';
    return new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
  }

  window.CV = {
    money: (s) => decimal(s, 2, 100, 100000000),
    qty: (s, uom) => (uom === 'piece' || !uom ? decimal(s, 0, 1, 100000000) : decimal(s, 3, 1000, 100000000)),
    emailProblem: emailProblem,
    normalizeEmail: (s) => String(s || '').trim().toLowerCase(),
    line: line,
    formatMoney: formatMoney,
  };
})();
