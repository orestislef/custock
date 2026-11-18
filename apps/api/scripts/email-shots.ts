// screenshots of every email at phone width, light and dark, from the dev preview.
// run: pnpm --filter @custock/api email-shots   (needs the playwright chromium, nothing is sent)
// writes apps/api/screenshots/email/<kind>-<locale>-<scheme>.jpg

import { serve } from '@hono/node-server';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { migrate, openDb } from '@custock/db';
import { createApp } from '../src/app';
import { EMAIL_KINDS } from '../src/email/messages';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots', 'email');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const db = openDb(':memory:');
migrate(db);
const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
  let s: ReturnType<typeof serve>;
  // the port is known once listening, the app reads its own address for the mark and fonts
  const app = { fetch: (req: Request) => handler!.fetch(req) };
  let handler: { fetch: (req: Request) => Response | Promise<Response> } | null = null;
  s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
    handler = createApp({ db, dev: true, jwtSecret: 'screenshots-only-secret-long-enough', publicWebUrl: 'https://orestislef.gr/custock', apiPublicUrl: `http://127.0.0.1:${info.port}`, corsOrigins: [], rateLimit: false });
    resolve(s);
  });
});
const port = (server.address() as { port: number }).port;

const shots: { kind: string; locale: string; scheme: 'light' | 'dark' }[] = [];
for (const kind of EMAIL_KINDS) for (const scheme of ['light', 'dark'] as const) shots.push({ kind, locale: 'en', scheme });
shots.push({ kind: 'post', locale: 'el', scheme: 'light' }, { kind: 'otp', locale: 'ru', scheme: 'dark' }, { kind: 'joinConfirm', locale: 'el', scheme: 'dark' });

const browser = await chromium.launch();
for (const scheme of ['light', 'dark'] as const) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  for (const s of shots.filter((x) => x.scheme === scheme)) {
    const url = `http://127.0.0.1:${port}/v1/dev/emails/${s.kind}?locale=${s.locale}${scheme === 'dark' ? '&scheme=dark' : ''}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => page.waitForTimeout(2000));
    await page.evaluate('document.fonts.ready');
    await page.screenshot({ path: join(out, `${s.kind}-${s.locale}-${scheme}.jpg`), fullPage: true, type: 'jpeg', quality: 62 });
  }
  await page.close();
}
await browser.close();
server.close();

const files = readdirSync(out);
const total = files.reduce((n, f) => n + statSync(join(out, f)).size, 0);
console.log(`${files.length} screenshots, ${(total / 1024).toFixed(0)} kB in ${out}`);
