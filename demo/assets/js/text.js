/* search that works in greek, greeklish, russian and english.
   the real app does the same on the server, see thinking/11-languages. */
(function () {
  'use strict';
  const GR = { 'α': 'a', 'β': 'v', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'τ': 't', 'υ': 'y', 'φ': 'f', 'χ': 'h', 'ψ': 'ps', 'ω': 'o' };
  const RU = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya' };

  // lowercase, drop accents (tonos, dialytika, the dots of ё, the breve of й), final sigma becomes sigma
  function base(s) {
    return String(s || '').replace(/ /g, ' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ').trim();
  }
  function translit(s) {
    let x = base(s);
    x = x.replace(/ου/g, 'ou').replace(/αι/g, 'ai').replace(/ει/g, 'ei').replace(/οι/g, 'oi')
      .replace(/μπ/g, 'mp').replace(/ντ/g, 'nt').replace(/γκ/g, 'gk').replace(/γγ/g, 'ng')
      .replace(/αυ/g, 'av').replace(/ευ/g, 'ev');
    return x.replace(/[α-ω]/g, (c) => GR[c] || c).replace(/[а-я]/g, (c) => (RU[c] !== undefined ? RU[c] : c));
  }
  // greeklish is typed many ways: χ as h, x or ch, θ as th or 8, ου as ou or u. fold them together.
  function fold(latin) {
    return latin.replace(/8/g, 'th').replace(/th/g, 't').replace(/ph/g, 'f').replace(/ch/g, 'h').replace(/ks/g, 'h').replace(/x/g, 'h')
      .replace(/ou/g, 'u').replace(/ai/g, 'e').replace(/ei|oi|y/g, 'i').replace(/w/g, 'o')
      .replace(/mp/g, 'b').replace(/nt/g, 'd').replace(/gk|gg/g, 'g')
      .replace(/(.)\1+/g, '$1');
  }
  function index(parts) {
    const raw = parts.filter(Boolean).join(' | ');
    const b = base(raw);
    const t = translit(raw);
    return { b: b, t: t, f: fold(t) };
  }
  function match(idx, q) {
    const qb = base(q);
    if (!qb) return true;
    if (idx.b.includes(qb) || idx.t.includes(qb)) return true;
    const qt = translit(qb);
    if (idx.t.includes(qt)) return true;
    return idx.f.includes(fold(qt));
  }
  window.CSText = { base: base, translit: translit, fold: fold, index: index, match: match };
})();
