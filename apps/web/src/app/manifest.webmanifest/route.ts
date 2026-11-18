import { colors } from '@custock/tokens';
import { translator } from '@custock/i18n';
import { getLocale } from '@/lib/i18n-server';

// the staff app on the home screen: stock, scanning, customers and posts
export async function GET() {
  const locale = await getLocale();
  const t = translator(locale, 'web');
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return Response.json(
    {
      id: `${base}/admin`,
      name: 'Custock',
      short_name: 'Custock',
      description: t('pwa.staffDescription'),
      lang: locale,
      dir: 'ltr',
      start_url: `${base}/admin`,
      scope: `${base}/admin`,
      display: 'standalone',
      background_color: colors.light.shelf,
      theme_color: colors.light.shelf,
      categories: ['business', 'productivity'],
      icons: [
        { src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `${base}/icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [
        { name: t('pwa.shortcutScan'), url: `${base}/admin/scan`, icons: [{ src: `${base}/icons/icon-192.png`, sizes: '192x192' }] },
        { name: t('pwa.shortcutStock'), url: `${base}/admin/stock`, icons: [{ src: `${base}/icons/icon-192.png`, sizes: '192x192' }] },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } },
  );
}
