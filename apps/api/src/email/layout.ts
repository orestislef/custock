// one html layout for every email, so they all look like the app: the shelf grey around a white
// rounded card, the Custock mark on top, pomegranate buttons, Commissioner for headings.
// email safe on purpose: tables, inline styles, 600 px wide at most, a plain text twin for every
// message, a dark block for Apple Mail and Outlook.com, no tracking pixels and no scripts.

import type { AppLocale } from '@custock/i18n';

let assetBase = 'http://localhost:8787';

// the api's public address (CUSTOCK_API_URL): the mark and the fonts are served from /email
export function setEmailAssetBase(base: string | undefined) {
  if (base) assetBase = base.replace(/\/$/, '');
}
export const emailAssetBase = () => assetBase;

export const C = {
  shelf: '#F3F3F0',
  surface: '#FFFFFF',
  ink: '#16171B',
  ink2: '#5E6068',
  line: '#E3E3DE',
  accent: '#B0234F',
  accentTint: '#F9E6EC',
  dark: { shelf: '#0F0F12', surface: '#1A1A1F', elevated: '#232329', ink: '#F2F1EE', ink2: '#A3A3AD', line: '#2E2E35', accent: '#FF6B8E', accentFill: '#C42A58', accentTint: '#3A1622' },
} as const;

const UI = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY = `Commissioner, -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
const MONO = "'SF Mono', ui-monospace, Menlo, Consolas, 'Roboto Mono', monospace";

export interface EmailProduct {
  name: string;
  url: string | null;
  imageUrl: string | null;
  // already formatted, in the reader's language and the shop's currency
  price: string | null;
  offerPrice: string | null;
  // the legal line under an offer: the lowest price of the last 30 days
  was: string | null;
}

export interface EmailContent {
  locale: AppLocale;
  subject: string;
  preheader: string;
  // the business above the heading, for mail a shop sends
  eyebrow?: string | null;
  // the business's logo, shown small beside that name when it has one
  eyebrowLogo?: string | null;
  // mail a business sends its customers: its logo on top instead of the Custock mark, its name
  // there when it has no logo. Custock moves to the "Sent with Custock" footer line
  brand?: { name: string; logoUrl: string | null } | null;
  heading: string;
  // paragraphs, plain text. single new lines stay as line breaks
  paragraphs: string[];
  code?: string | null;
  cover?: { url: string; alt: string } | null;
  products?: { title: string; items: EmailProduct[] } | null;
  extraLine?: string | null;
  button?: { label: string; url: string } | null;
  note?: string | null;
  // shown under the button so the link still works when the button does not
  fallback?: { label: string; url: string } | null;
  footer: { lines: string[]; unsubscribe?: { label: string; url: string } | null };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// only web links make it into an email
export function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const para = (s: string) => esc(s).replace(/\r?\n/g, '<br>');

function fontFaces(): string {
  const face = (file: string, range: string) =>
    `@font-face{font-family:'Commissioner';font-style:normal;font-weight:600;font-display:swap;src:url('${assetBase}/email/${file}') format('woff2');unicode-range:${range};}`;
  return [
    face('commissioner-latin.woff2', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212,U+FEFF,U+FFFD'),
    face('commissioner-greek.woff2', 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF'),
    face('commissioner-cyrillic.woff2', 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'),
  ].join('\n');
}

// the dark appearance, for clients that ask (Apple Mail, iOS Mail) and Outlook.com's own markers.
// forceDark turns it on for previews.
function styles(forceDark: boolean): string {
  const d = C.dark;
  const rules = `
  .bg { background-color: ${d.shelf} !important; }
  .card { background-color: ${d.surface} !important; }
  .ink { color: ${d.ink} !important; }
  .ink2 { color: ${d.ink2} !important; }
  .line { border-color: ${d.line} !important; }
  .codebox { background-color: ${d.elevated} !important; }
  .btn { background-color: ${d.accentFill} !important; }
  .accent { color: ${d.accent} !important; }
  .link { color: ${d.accent} !important; }
  .thumb { background-color: ${d.elevated} !important; }`;
  const ogsc = `
  [data-ogsc] .ink { color: ${d.ink} !important; }
  [data-ogsc] .ink2 { color: ${d.ink2} !important; }
  [data-ogsc] .accent, [data-ogsc] .link { color: ${d.accent} !important; }
  [data-ogsb] .bg { background-color: ${d.shelf} !important; }
  [data-ogsb] .card { background-color: ${d.surface} !important; }
  [data-ogsb] .codebox { background-color: ${d.elevated} !important; }`;
  return `
${fontFaces()}
body { margin: 0 !important; padding: 0 !important; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
table { border-collapse: collapse; mso-table-lspace: 0; mso-table-rspace: 0; }
img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
.code { -webkit-user-select: all; user-select: all; }
@media (max-width: 620px) {
  .outer { padding: 24px 12px 32px !important; }
  .pad { padding: 28px 22px !important; }
  .h1 { font-size: 26px !important; line-height: 32px !important; }
  .code { font-size: 32px !important; letter-spacing: 8px !important; }
}
${forceDark ? rules : `@media (prefers-color-scheme: dark) {${rules}\n}`}
${ogsc}
`;
}

function button(b: { label: string; url: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;">
<tr><td class="btn" align="center" bgcolor="${C.accent}" style="background-color:${C.accent};border-radius:12px;">
<a href="${esc(b.url)}" target="_blank" style="display:block;height:50px;line-height:50px;padding:0 20px;font-family:${UI};font-size:17px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">${esc(b.label)}</a>
</td></tr></table>`;
}

function codeBox(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;">
<tr><td class="codebox" align="center" style="background-color:${C.shelf};border-radius:14px;padding:20px 12px;">
<span class="code ink" style="font-family:${MONO};font-size:38px;line-height:44px;font-weight:600;letter-spacing:10px;color:${C.ink};padding-left:10px;-webkit-user-select:all;user-select:all;">${esc(code)}</span>
</td></tr></table>`;
}

function productRows(p: NonNullable<EmailContent['products']>): string {
  const rows = p.items
    .map((it) => {
      const url = safeUrl(it.url);
      const img = safeUrl(it.imageUrl);
      const open = (inner: string, style = '') => (url ? `<a href="${esc(url)}" target="_blank" style="text-decoration:none;${style}">${inner}</a>` : inner);
      const thumb = img
        ? open(`<img src="${esc(img)}" width="64" height="64" alt="${esc(it.name)}" class="thumb" style="display:block;width:64px;height:64px;border-radius:12px;object-fit:cover;background-color:${C.shelf};">`)
        : `<div class="thumb" style="width:64px;height:64px;border-radius:12px;background-color:${C.shelf};"></div>`;
      const price = it.offerPrice
        ? `<span class="accent" style="color:${C.accent};font-weight:600;">${esc(it.offerPrice)}</span>`
        : it.price
          ? `<span class="ink2" style="color:${C.ink2};">${esc(it.price)}</span>`
          : '';
      const was = it.was ? `<div class="ink2" style="font-family:${UI};font-size:12px;line-height:16px;color:${C.ink2};margin-top:2px;">${esc(it.was)}</div>` : '';
      return `<tr><td class="line" style="padding:12px 0;border-top:1px solid ${C.line};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="64" valign="top" style="width:64px;padding-right:14px;">${thumb}</td>
<td valign="middle" style="font-family:${UI};">
${open(`<span class="ink" style="color:${C.ink};font-size:16px;line-height:21px;font-weight:600;">${esc(it.name)}</span>`)}
${price ? `<div style="font-size:15px;line-height:20px;margin-top:2px;">${price}</div>` : ''}${was}
</td></tr></table></td></tr>`;
    })
    .join('\n');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;">
${p.title ? `<tr><td class="ink2" style="font-family:${UI};font-size:13px;line-height:18px;color:${C.ink2};padding:0 0 8px;">${esc(p.title)}</td></tr>` : ''}
${rows}
</table>`;
}

export function renderEmail(c: EmailContent, opts: { forceDark?: boolean } = {}): RenderedEmail {
  const mark = `${assetBase}/email/mark.png`;
  const cover = c.cover && safeUrl(c.cover.url);
  const btn = c.button && safeUrl(c.button.url) ? { label: c.button.label, url: safeUrl(c.button.url)! } : null;
  const fallback = c.fallback && safeUrl(c.fallback.url) ? { label: c.fallback.label, url: safeUrl(c.fallback.url)! } : null;
  const unsub = c.footer.unsubscribe && safeUrl(c.footer.unsubscribe.url) ? { label: c.footer.unsubscribe.label, url: safeUrl(c.footer.unsubscribe.url)! } : null;
  // the preheader, then invisible padding so the body does not leak into the inbox preview
  const spacer = '&#847;&zwnj;&nbsp;'.repeat(80);

  const brandLogo = c.brand?.logoUrl ? safeUrl(c.brand.logoUrl) : null;
  const top = c.brand
    ? brandLogo
      ? `<img src="${esc(brandLogo)}" width="48" height="48" alt="${esc(c.brand.name)}" style="display:block;width:48px;height:48px;border:0;border-radius:11px;object-fit:contain;background-color:#FFFFFF;">`
      : `<p class="ink" style="margin:0;font-family:${DISPLAY};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.2px;color:${C.ink};">${esc(c.brand.name)}</p>`
    : `<img src="${esc(mark)}" width="48" height="48" alt="Custock" style="display:block;width:48px;height:48px;border:0;border-radius:11px;">`;
  const body = [
    // with the business on top, the line above the heading is its name (or shop) without the logo again
    c.eyebrow ? eyebrowLine(c.eyebrow, !c.brand && c.eyebrowLogo ? safeUrl(c.eyebrowLogo) : null) : '',
    `<h1 class="ink h1" style="margin:0 0 12px;font-family:${DISPLAY};font-size:28px;line-height:34px;font-weight:600;letter-spacing:-0.3px;color:${C.ink};">${esc(c.heading)}</h1>`,
    ...c.paragraphs.filter(Boolean).map((p) => `<p class="ink" style="margin:0 0 16px;font-family:${UI};font-size:17px;line-height:25px;color:${C.ink};">${para(p)}</p>`),
    c.code ? codeBox(c.code) : '',
    c.products && c.products.items.length ? productRows(c.products) : '',
    c.extraLine ? `<p class="ink2" style="margin:0 0 16px;font-family:${UI};font-size:15px;line-height:21px;color:${C.ink2};">${esc(c.extraLine)}</p>` : '',
    btn ? button(btn) : '',
    c.note ? `<p class="ink2" style="margin:20px 0 0;font-family:${UI};font-size:14px;line-height:20px;color:${C.ink2};">${para(c.note)}</p>` : '',
    fallback
      ? `<p class="ink2" style="margin:16px 0 0;font-family:${UI};font-size:13px;line-height:19px;color:${C.ink2};">${esc(fallback.label)}<br><a class="link" href="${esc(fallback.url)}" target="_blank" style="color:${C.accent};text-decoration:underline;word-break:break-all;">${esc(fallback.url)}</a></p>`
      : '',
  ].filter(Boolean).join('\n');

  const footer = [
    ...c.footer.lines.map((l) => esc(l)),
    unsub ? `<a class="link" href="${esc(unsub.url)}" target="_blank" style="color:${C.ink2};text-decoration:underline;">${esc(unsub.label)}</a>` : '',
  ].filter(Boolean).join('<br>');

  const html = `<!doctype html>
<html lang="${c.locale}" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(c.subject)}</title>
<!--[if mso]><style>body, table, td, a, p, h1 { font-family: Arial, sans-serif !important; }</style><![endif]-->
<style>${styles(!!opts.forceDark)}</style>
</head>
<body class="bg" style="margin:0;padding:0;background-color:${opts.forceDark ? C.dark.shelf : C.shelf};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.shelf};">${esc(c.preheader)}${spacer}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${C.shelf}" style="background-color:${C.shelf};">
<tr><td align="center" class="outer" style="padding:32px 16px 40px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">
<tr><td align="center" style="padding:0 0 20px;">${top}</td></tr>
<tr><td class="card" bgcolor="${C.surface}" style="background-color:${C.surface};border-radius:20px;overflow:hidden;">
${cover ? `<img src="${esc(cover)}" width="600" alt="${esc(c.cover!.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:20px 20px 0 0;">` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="pad" style="padding:36px 32px 32px;">
${body}
</td></tr></table>
</td></tr>
<tr><td class="ink2" align="center" style="padding:24px 24px 0;font-family:${UI};font-size:13px;line-height:19px;color:${C.ink2};">${footer}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;

  // the plain text twin, same order as the html
  const text: string[] = [];
  if (c.eyebrow) text.push(c.eyebrow);
  text.push(c.heading, '');
  for (const p of c.paragraphs.filter(Boolean)) text.push(p, '');
  if (c.code) text.push(`    ${c.code}`, '');
  if (c.products && c.products.items.length) {
    if (c.products.title) text.push(c.products.title);
    for (const it of c.products.items) {
      const price = it.offerPrice ?? it.price;
      text.push(`- ${it.name}${price ? `: ${price}` : ''}${it.was ? ` (${it.was})` : ''}${safeUrl(it.url) ? `\n  ${safeUrl(it.url)}` : ''}`);
    }
    text.push('');
  }
  if (c.extraLine) text.push(c.extraLine, '');
  if (btn) text.push(`${btn.label}: ${btn.url}`, '');
  if (c.note) text.push(c.note, '');
  text.push('--', ...c.footer.lines);
  if (unsub) text.push(`${unsub.label}: ${unsub.url}`);
  return { subject: c.subject, html, text: text.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' };
}

// the sending business above the heading: its logo (24 px, rounded) and name on one line
function eyebrowLine(name: string, logo: string | null): string {
  const text = `<span class="ink2" style="font-family:${UI};font-size:13px;line-height:18px;font-weight:600;color:${C.ink2};">${esc(name)}</span>`;
  if (!logo) return `<p class="ink2" style="margin:0 0 6px;font-family:${UI};font-size:13px;line-height:18px;font-weight:600;color:${C.ink2};">${esc(name)}</p>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;border-collapse:collapse;"><tr>`
    + `<td style="padding:0 8px 0 0;vertical-align:middle;"><img src="${esc(logo)}" width="24" height="24" alt="" style="display:block;width:24px;height:24px;border:0;border-radius:6px;object-fit:contain;"></td>`
    + `<td style="vertical-align:middle;">${text}</td></tr></table>`;
}
