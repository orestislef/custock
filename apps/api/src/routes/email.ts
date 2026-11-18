// what emails need from us: the Custock mark and the heading font, served from /email for every
// mail client (public, long cache). in dev also a preview of every template in every language.

import type { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, type AppLocale } from '@custock/i18n';
import type { AppEnv } from '../types';
import { cfgOf } from '../lib/context';
import { notFound } from '../lib/problem';
import { esc } from '../email/layout';
import { EMAIL_KINDS, type EmailKind } from '../email/messages';
import { sampleEmail } from '../email/samples';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'email', 'assets');
const FILES: Record<string, string> = {
  'mark.png': 'image/png',
  'commissioner-latin.woff2': 'font/woff2',
  'commissioner-greek.woff2': 'font/woff2',
  'commissioner-cyrillic.woff2': 'font/woff2',
};
const cache = new Map<string, Buffer>();

export function emailRoutes(app: Hono<AppEnv>) {
  // a fixed list of files, never a path from the request
  app.get('/email/:file', (c) => {
    const file = c.req.param('file');
    const type = FILES[file];
    if (!type) throw notFound();
    let buf = cache.get(file);
    if (!buf) {
      buf = readFileSync(join(ASSETS, file));
      cache.set(file, buf);
    }
    c.header('Content-Type', type);
    c.header('Cache-Control', 'public, max-age=604800');
    c.header('X-Content-Type-Options', 'nosniff');
    // fonts load across origins in mail clients that are web views
    c.header('Access-Control-Allow-Origin', '*');
    return c.body(new Uint8Array(buf));
  });

  // dev only (the /v1/dev guard), made up content, no sign in needed to look
  app.get('/v1/dev/emails', (c) => {
    const rows = EMAIL_KINDS.map((k) => {
      const links = (LOCALES as readonly AppLocale[])
        .map((l) => `${l}: <a href="emails/${k}?locale=${l}">light</a> <a href="emails/${k}?locale=${l}&amp;scheme=dark">dark</a> <a href="emails/${k}?locale=${l}&amp;format=text">text</a>`)
        .join(' &nbsp; ');
      return `<li><b>${esc(k)}</b><br>${links}</li>`;
    }).join('\n');
    return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Custock emails</title>
<body style="font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#16171B;background:#F3F3F0">
<h1 style="font-size:28px">Every email</h1><p>Made up content, in each language, light and dark. Nothing here is sent.</p>
<ul style="padding-left:20px">${rows}</ul></body>`);
  });

  app.get('/v1/dev/emails/:kind', (c) => {
    const kind = c.req.param('kind') as EmailKind;
    if (!EMAIL_KINDS.includes(kind)) throw notFound();
    const q = c.req.query('locale');
    const locale: AppLocale = (LOCALES as readonly string[]).includes(q ?? '') ? (q as AppLocale) : 'en';
    const mail = sampleEmail(kind, locale, cfgOf(c).publicWebUrl.replace(/\/$/, ''), { forceDark: c.req.query('scheme') === 'dark' });
    if (c.req.query('format') === 'text') return c.text(`Subject: ${mail.subject}\n\n${mail.text}`);
    return c.html(mail.html);
  });
}
