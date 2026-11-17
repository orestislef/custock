// search normalisation from thinking/11-languages.md.
// sqlite lower() and LIKE only fold ascii, so keys are built here and stored in search_key.
// a key holds the folded native text plus a latin phonetic form, so "meli" finds "Μέλι",
// "kafes" finds "καφές" and "мед" finds "мёд". й folds to и, ё folds to е.

const COMBINING = /[̀-ͯ]/g;

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const GREEK: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm',
  ν: 'n', ξ: 'ks', ο: 'o', π: 'p', ρ: 'r', σ: 's', τ: 't', υ: 'i', φ: 'f', χ: 'h', ψ: 'ps', ω: 'o',
};

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'iu', я: 'ia', і: 'i', ї: 'i', є: 'e',
};

// greek digraphs first, so ου reads as u and μπ as b
const GREEK_DIGRAPHS: [RegExp, string][] = [
  [/ου/g, 'u'], [/αι/g, 'e'], [/ει/g, 'i'], [/οι/g, 'i'], [/υι/g, 'i'],
  [/αυ/g, 'av'], [/ευ/g, 'ev'], [/μπ/g, 'b'], [/ντ/g, 'd'], [/γκ/g, 'g'], [/γγ/g, 'ng'], [/τσ/g, 'ts'], [/τζ/g, 'tz'],
];

export function transliterate(normalized: string): string {
  let s = normalized;
  for (const [re, to] of GREEK_DIGRAPHS) s = s.replace(re, to);
  let out = '';
  for (const ch of s) out += GREEK[ch] ?? CYRILLIC[ch] ?? ch;
  return out;
}

// a loose latin form that hides greeklish and english spelling habits
export function phonetic(latin: string): string {
  return latin
    .replace(/ou/g, 'u')
    .replace(/ei|oi|y/g, 'i')
    .replace(/ai/g, 'e')
    .replace(/w/g, 'o')
    .replace(/ph/g, 'f')
    .replace(/ch|kh/g, 'h')
    .replace(/ks/g, 'x')
    .replace(/mp/g, 'b')
    .replace(/nt/g, 'd')
    .replace(/gk|gg/g, 'g')
    .replace(/ck|c|q/g, 'k')
    .replace(/(.)\1+/g, '$1');
}

function latinForm(normalizedToken: string): string {
  return phonetic(transliterate(normalizedToken));
}

// the stored key: native tokens plus latin phonetic tokens, unique, space separated
export function searchKey(...parts: (string | null | undefined)[]): string {
  const tokens = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const t of normalize(part).split(' ')) {
      if (!t) continue;
      tokens.add(t);
      tokens.add(latinForm(t));
    }
  }
  return [...tokens].join(' ');
}

// the forms of each query token that may appear in a key. every token must match one of its forms.
export function queryTokens(query: string): string[][] {
  return normalize(query)
    .split(' ')
    .filter(Boolean)
    .map((t) => [...new Set([t, latinForm(t)])]);
}

export function matches(key: string, query: string): boolean {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  return tokens.every((forms) => forms.some((f) => key.includes(f)));
}

// sql helper: a WHERE fragment and params for search_key LIKE matching
export function searchSql(column: string, query: string): { sql: string; params: string[] } {
  const tokens = queryTokens(query);
  if (!tokens.length) return { sql: '1=1', params: [] };
  const parts: string[] = [];
  const params: string[] = [];
  for (const forms of tokens) {
    parts.push('(' + forms.map(() => `${column} LIKE ?`).join(' OR ') + ')');
    for (const f of forms) params.push(`%${f.replace(/[%_]/g, '')}%`);
  }
  return { sql: parts.join(' AND '), params };
}
