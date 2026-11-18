import { LOCALES, translator } from '@custock/i18n';
import { colors } from '@custock/tokens';

// the page the service worker shows when there is no connection and no saved copy of the page.
// it is kept in the cache, so it carries everything inline: styles, the three languages, the
// language pick (the cookie, then the browser), the appearance picked on this device and a try
// again button.
export const dynamic = 'force-static';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function GET() {
  const blocks = LOCALES.map((l) => {
    const t = translator(l, 'web');
    return `<section lang="${l}" hidden><h1>${esc(t('pwa.offlineTitle'))}</h1><p>${esc(t('pwa.offlineBody'))}</p><button type="button" onclick="location.reload()">${esc(t('common:action.retry'))}</button></section>`;
  }).join('');
  const L = colors.light, D = colors.dark;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><title>Custock</title><style>
:root{--shelf:${L.shelf};--ink:${L.ink};--ink2:${L.ink2};--accent:${L.accentFill};--fill:${L.fill}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--shelf:${D.shelf};--ink:${D.ink};--ink2:${D.ink2};--accent:${D.accentFill};--fill:${D.fill}}}
:root[data-theme=dark]{color-scheme:dark;--shelf:${D.shelf};--ink:${D.ink};--ink2:${D.ink2};--accent:${D.accentFill};--fill:${D.fill}}:root[data-theme=light]{color-scheme:light}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--shelf);color:var(--ink);font:17px/22px -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;padding:24px calc(24px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(24px + env(safe-area-inset-left))}
section{max-width:340px;text-align:center}.mark{width:56px;height:56px;margin:0 auto 20px;border-radius:50%;background:var(--fill);display:grid;place-items:center;color:var(--ink2)}
h1{font-size:22px;line-height:28px;margin:0 0 8px;font-weight:700}p{margin:0 0 24px;color:var(--ink2)}
button{font:inherit;font-weight:600;min-height:50px;padding:0 28px;border:0;border-radius:14px;background:var(--accent);color:#fff;cursor:pointer}
</style></head><body><div><div class="mark" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 9.5a13 13 0 0 1 18 0M6.2 13a8.5 8.5 0 0 1 11.6 0M9.4 16.4a4 4 0 0 1 5.2 0"/><path d="M4 4l16 16"/><circle cx="12" cy="19.5" r=".6" fill="currentColor"/></svg></div>${blocks}</div>
<script>(function(){try{var a=localStorage.getItem('custock.appearance');if(a==='light'||a==='dark')document.documentElement.setAttribute('data-theme',a)}catch(e){}})();(function(){var c=(document.cookie.match(/(?:^|; )locale=([a-z]{2})/)||[])[1];var n=(navigator.language||'en').slice(0,2);var pick=[c,n,'en'].find(function(x){return x&&document.querySelector('section[lang="'+x+'"]')});var s=document.querySelector('section[lang="'+pick+'"]');s.hidden=false;document.documentElement.lang=pick;})();</script></body></html>`;
  // no outside content and no user data on this page, so its few inline lines may run
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'Content-Security-Policy': csp } });
}
